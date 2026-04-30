/* eslint-disable no-console */
import { listBusinesses, upsertAssessment, getAssessment } from "../lib/db";
import { fetchSiteSignals, judgeWithClaude, combineScore, computePitchPriority, usageToCost, type UsageRecord } from "../lib/web-quality";

const DEFAULT_MAX_COST = 6.0; // hard ceiling — set per user budget

async function main() {
  if (!process.env.TURSO_DATABASE_URL) {
    console.error("TURSO_DATABASE_URL is not set.");
    process.exit(1);
  }
  const skipLlm = process.argv.includes("--no-llm");
  const onlyMissing = process.argv.includes("--only-missing");
  if (!process.env.ANTHROPIC_API_KEY && !skipLlm) {
    console.error("ANTHROPIC_API_KEY is not set. Re-run with --no-llm to skip LLM judgment.");
    process.exit(1);
  }

  const maxCostArg = process.argv.find((a) => a.startsWith("--max-cost="));
  const maxCost = maxCostArg ? parseFloat(maxCostArg.replace("--max-cost=", "")) : DEFAULT_MAX_COST;
  const topNArg = process.argv.find((a) => a.startsWith("--top-n="));
  const topN = topNArg ? parseInt(topNArg.replace("--top-n=", "")) : null;
  const minFitArg = process.argv.find((a) => a.startsWith("--min-fit="));
  const minFit = minFitArg ? parseInt(minFitArg.replace("--min-fit=", "")) : 0;

  let businesses = await listBusinesses();
  // Sort by fit_score so we assess most valuable prospects FIRST — if budget runs out,
  // we have full LLM coverage on the businesses that matter most for outreach.
  businesses.sort((a, b) => b.fit_score - a.fit_score);

  if (minFit > 0) businesses = businesses.filter((b) => b.fit_score >= minFit);
  if (topN) businesses = businesses.slice(0, topN);

  console.log(`Assessing ${businesses.length} businesses${onlyMissing ? " (only missing)" : ""}`);
  if (!skipLlm) {
    console.log(`Budget cap: $${maxCost.toFixed(2)} (will stop early if exceeded)`);
    console.log("Sorted by fit_score DESC — highest-value prospects first\n");
  }

  let assessed = 0, skipped = 0, errored = 0, stoppedEarly = false;
  const totalUsage: UsageRecord = {
    input_tokens: 0, output_tokens: 0, cache_creation_input_tokens: 0, cache_read_input_tokens: 0,
  };

  for (const b of businesses) {
    if (onlyMissing) {
      const existing = await getAssessment(b.id);
      if (existing) { skipped++; continue; }
    }

    // Budget check BEFORE the call — bail if the next call could push us over
    const currentCost = usageToCost(totalUsage);
    if (!skipLlm && currentCost >= maxCost) {
      stoppedEarly = true;
      console.log(`\n*** BUDGET CAP HIT at $${currentCost.toFixed(4)} / $${maxCost.toFixed(2)} — stopping ***`);
      break;
    }

    process.stdout.write(`  ${b.name.padEnd(40, " ").slice(0, 40)} `);

    if (!b.website) {
      await upsertAssessment({
        business_id: b.id,
        website_url: null,
        reachable: false, https: false, response_ms: null, has_viewport: false,
        copyright_year: null, tech_stack: null, is_placeholder: false,
        quality_score: 0,
        pitch_priority: computePitchPriority(b.fit_score, 0, b.category),
        issues_json: JSON.stringify(["No website on file — they have zero web presence"]),
        pitch_summary: "They don't have a website at all. For a business of their caliber in Palm Beach, that's a real gap — even a one-page site would help them show up on Google.",
        jack_status: "assessed", jack_notes: "", jack_last_contacted: null,
        assessed_at: new Date().toISOString(),
      });
      console.log("no website (priority " + computePitchPriority(b.fit_score, 0, b.category) + ")");
      assessed++;
      continue;
    }

    try {
      const signals = await fetchSiteSignals(b.website);
      let verdict: { quality_score: number; issues: string[]; pitch_summary: string };

      if (skipLlm) {
        const issues: string[] = [];
        if (!signals.reachable) issues.push("Site is unreachable");
        if (signals.is_placeholder) issues.push("Looks like a placeholder/parked page");
        if (!signals.https) issues.push("Not on HTTPS");
        if (!signals.has_viewport) issues.push("No mobile viewport meta tag — likely broken on phones");
        if (signals.response_ms && signals.response_ms > 3000) issues.push(`Slow load (${signals.response_ms}ms)`);
        const yr = signals.copyright_year;
        if (yr && new Date().getFullYear() - yr >= 3) issues.push(`Copyright still says ${yr}`);
        verdict = { quality_score: 50, issues, pitch_summary: "" };
      } else {
        const result = await judgeWithClaude({
          business_name: b.name, category: b.category,
          website_url: b.website, signals,
        });
        verdict = result.verdict;
        // Accumulate usage
        totalUsage.input_tokens += result.usage.input_tokens;
        totalUsage.output_tokens += result.usage.output_tokens;
        totalUsage.cache_creation_input_tokens += result.usage.cache_creation_input_tokens;
        totalUsage.cache_read_input_tokens += result.usage.cache_read_input_tokens;
      }

      const finalScore = skipLlm ? verdict.quality_score : combineScore(signals, verdict);
      const priority = computePitchPriority(b.fit_score, finalScore, b.category);

      await upsertAssessment({
        business_id: b.id,
        website_url: b.website,
        reachable: signals.reachable, https: signals.https,
        response_ms: signals.response_ms, has_viewport: signals.has_viewport,
        copyright_year: signals.copyright_year, tech_stack: signals.tech_stack,
        is_placeholder: signals.is_placeholder, quality_score: finalScore,
        pitch_priority: priority,
        issues_json: JSON.stringify(verdict.issues),
        pitch_summary: verdict.pitch_summary,
        jack_status: "assessed", jack_notes: "", jack_last_contacted: null,
        assessed_at: new Date().toISOString(),
      });

      const costSoFar = usageToCost(totalUsage);
      console.log(`q=${finalScore} pri=${priority} ${signals.tech_stack ? "(" + signals.tech_stack.slice(0, 18) + ")" : ""} ${skipLlm ? "" : `[$${costSoFar.toFixed(4)}]`}`);
      assessed++;
    } catch (err) {
      console.log(`ERROR: ${err instanceof Error ? err.message : err}`);
      errored++;
    }
  }

  const finalCost = usageToCost(totalUsage);
  console.log(`\n=== DONE ===`);
  console.log(`Assessed: ${assessed}`);
  console.log(`Skipped: ${skipped}`);
  console.log(`Errored: ${errored}`);
  if (!skipLlm) {
    console.log(`Total LLM cost: $${finalCost.toFixed(4)}`);
    console.log(`  Input tokens: ${totalUsage.input_tokens.toLocaleString()}`);
    console.log(`  Cache creation: ${totalUsage.cache_creation_input_tokens.toLocaleString()}`);
    console.log(`  Cache reads: ${totalUsage.cache_read_input_tokens.toLocaleString()} (saved ~$${((totalUsage.cache_read_input_tokens * (3.0 - 0.3)) / 1_000_000).toFixed(4)})`);
    console.log(`  Output tokens: ${totalUsage.output_tokens.toLocaleString()}`);
    if (stoppedEarly) {
      console.log(`\nBudget hit. Re-run with --only-missing to continue (and bump --max-cost if you want).`);
    }
  }
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
