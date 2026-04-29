import Anthropic from "@anthropic-ai/sdk";
import type { Business, WebAssessment } from "./db";
import { labelForCategory } from "./scoring";

const WARMAN_BRAND = `You are writing on behalf of Jack Warman of Warman Consulting — an independent web builder based in Palm Beach, Florida.

What Jack does:
- Builds modern, fast websites for Palm Beach businesses
- Fixed-price, 2-week turnaround
- The kind of site that matches the quality of the business's actual work
- Knows Palm Beach inside out (local, not a remote agency)

Voice rules:
- Direct, founder-energy, friendly. Brief.
- Compliments specifically before any critique — never opens with what's wrong
- Never uses "I'd love to", "synergies", "value-add", "growth hack", "leverage"
- No exclamation points
- Doesn't oversell. Lets concrete specifics do the work
- Sounds like a local builder who actually looked at the site, not a marketing email
- Sign as "Jack Warman, Warman Consulting"`;

let _client: Anthropic | null = null;
function client(): Anthropic {
  if (!_client) {
    const apiKey = process.env.ANTHROPIC_API_KEY;
    if (!apiKey) throw new Error("ANTHROPIC_API_KEY is not set");
    _client = new Anthropic({ apiKey });
  }
  return _client;
}

export interface PitchResult {
  subject: string;
  body: string;
  teardown: string;
}

export async function draftPitchEmail(business: Business, assessment: WebAssessment): Promise<PitchResult> {
  const issues: string[] = JSON.parse(assessment.issues_json || "[]");
  const categoryLabel = labelForCategory(business.category);

  const prompt = `Write a short cold-outreach email from Jack Warman to this Palm Beach business about their website.

BUSINESS: ${business.name}
CATEGORY: ${categoryLabel}
WEBSITE: ${assessment.website_url || business.website || "(none)"}
CURRENT SITE QUALITY SCORE (0-100): ${assessment.quality_score}
TECH STACK DETECTED: ${assessment.tech_stack || "unknown"}
SPECIFIC ISSUES YOU NOTICED:
${issues.map((i, idx) => `  ${idx + 1}. ${i}`).join("\n") || "  (none specific)"}

ROUGH PITCH SUMMARY (use as inspiration, don't copy):
${assessment.pitch_summary || "(none)"}

Write TWO things:

1. EMAIL — cold outreach, ≤120 words, structured as:
   - Subject line ≤8 words
   - Open with one specific compliment about their business or their site (something positive, not generic — pick from the category or business name if needed)
   - One concrete thing you'd improve, in plain language (not jargon, not a long list)
   - Mention fixed-price + 2-week turnaround ONCE
   - Soft close: offer to send a one-page teardown / few quick wins. No pressure.
   - Sign "— Jack Warman, Warman Consulting"

2. TEARDOWN — a 4-6 bullet list of specific concrete improvements you'd make. Plain English. Mix of "easy wins" and "biggest impact". This is what Jack would actually deliver if they reply asking "tell me more". Reference real issues from the list above.

Respond ONLY with this JSON:
{"subject": "...", "body": "...", "teardown": "- bullet 1\\n- bullet 2\\n..."}`;

  const response = await client().messages.create({
    model: "claude-sonnet-4-20250514",
    max_tokens: 1500,
    temperature: 0.6,
    system: WARMAN_BRAND,
    messages: [{ role: "user", content: prompt }],
  });

  const block = response.content[0];
  if (block.type !== "text") throw new Error("Claude returned non-text");
  const cleaned = block.text.replace(/^```(?:json)?\s*/i, "").replace(/```\s*$/i, "").trim();

  try {
    const parsed = JSON.parse(cleaned);
    return {
      subject: String(parsed.subject || "Quick note on your site"),
      body: String(parsed.body || ""),
      teardown: String(parsed.teardown || ""),
    };
  } catch (err) {
    throw new Error(`Failed to parse pitch JSON: ${err}\nRaw: ${block.text}`);
  }
}
