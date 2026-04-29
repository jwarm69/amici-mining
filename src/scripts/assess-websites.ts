/* eslint-disable no-console */
import { listBusinesses, upsertAssessment, getAssessment } from "../lib/db";
import { fetchSiteSignals, judgeWithClaude, combineScore, computePitchPriority } from "../lib/web-quality";

async function main() {
  if (!process.env.TURSO_DATABASE_URL) {
    console.error("TURSO_DATABASE_URL is not set.");
    process.exit(1);
  }
  const skipLlm = process.argv.includes("--no-llm");
  const onlyMissing = process.argv.includes("--only-missing");
  if (!process.env.ANTHROPIC_API_KEY && !skipLlm) {
    console.error("ANTHROPIC_API_KEY is not set. Re-run with --no-llm to skip LLM judgment, or set the key.");
    process.exit(1);
  }

  const businesses = await listBusinesses();
  console.log(`Assessing ${businesses.length} businesses${onlyMissing ? " (only missing)" : ""}…\n`);

  let assessed = 0, skipped = 0, errored = 0;

  for (const b of businesses) {
    if (onlyMissing) {
      const existing = await getAssessment(b.id);
      if (existing) { skipped++; continue; }
    }

    process.stdout.write(`  ${b.name.padEnd(40, " ").slice(0, 40)} `);

    if (!b.website) {
      // No website at all — record that fact, give max pitch priority for category
      await upsertAssessment({
        business_id: b.id,
        website_url: null,
        reachable: false,
        https: false,
        response_ms: null,
        has_viewport: false,
        copyright_year: null,
        tech_stack: null,
        is_placeholder: false,
        quality_score: 0,
        pitch_priority: computePitchPriority(b.fit_score, 0, b.category),
        issues_json: JSON.stringify(["No website on file — they have zero web presence"]),
        pitch_summary: "They don't have a website at all. For a business of their caliber in Palm Beach, that's a real gap — even a one-page site would help them show up on Google.",
        jack_status: "assessed",
        jack_notes: "",
        jack_last_contacted: null,
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
        // Programmatic-only fallback: use signals directly
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
        verdict = await judgeWithClaude({
          business_name: b.name, category: b.category,
          website_url: b.website, signals,
        });
      }

      const finalScore = skipLlm ? verdict.quality_score : combineScore(signals, verdict);
      const priority = computePitchPriority(b.fit_score, finalScore, b.category);

      await upsertAssessment({
        business_id: b.id,
        website_url: b.website,
        reachable: signals.reachable,
        https: signals.https,
        response_ms: signals.response_ms,
        has_viewport: signals.has_viewport,
        copyright_year: signals.copyright_year,
        tech_stack: signals.tech_stack,
        is_placeholder: signals.is_placeholder,
        quality_score: finalScore,
        pitch_priority: priority,
        issues_json: JSON.stringify(verdict.issues),
        pitch_summary: verdict.pitch_summary,
        jack_status: "assessed",
        jack_notes: "",
        jack_last_contacted: null,
        assessed_at: new Date().toISOString(),
      });
      console.log(`q=${finalScore} priority=${priority} (${signals.tech_stack || "?"}, ${signals.response_ms ?? "?"}ms)`);
      assessed++;
    } catch (err) {
      console.log(`ERROR: ${err instanceof Error ? err.message : err}`);
      errored++;
    }
  }

  console.log(`\n=== DONE ===\nAssessed: ${assessed}\nSkipped: ${skipped}\nErrored: ${errored}`);
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
