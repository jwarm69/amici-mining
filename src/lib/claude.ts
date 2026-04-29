import Anthropic from "@anthropic-ai/sdk";
import type { Business } from "./db";
import { labelForCategory } from "./scoring";

let _client: Anthropic | null = null;

function getClient(): Anthropic {
  if (!_client) {
    const apiKey = process.env.ANTHROPIC_API_KEY;
    if (!apiKey) throw new Error("ANTHROPIC_API_KEY is not set");
    _client = new Anthropic({ apiKey });
  }
  return _client;
}

const AMICI_BRAND = `You are writing on behalf of Amici Market, a beloved family-owned Italian market and prepared-foods kitchen in Palm Beach, Florida. Maurizio Ciminella is the owner. The market is famous locally for:
- Hand-made pastas, sauces, and prepared dinners (lasagna, eggplant parm, chicken Milanese)
- Catering platters: antipasti, sandwich/panini boards, salad spreads, dessert trays
- Yacht and event provisioning — Amici regularly stocks Rybovich-area boats
- Quality you'd expect in a small Italian village. Italian-speaking staff. Real ingredients.

Voice: warm, confident, *un-corporate*. Italian-American hospitality. Concrete and specific — never markety. Never use phrases like "we'd love to partner" or "synergies" or "value-add". Never use exclamation points. Short sentences. Sound like a trusted neighborhood Italian shop saying hello, not a SaaS company.`;

export interface DraftEmailResult {
  subject: string;
  body: string;
  offer_angle: string;
}

export async function draftOutreachEmail(business: Business, suggestedOffer: string): Promise<DraftEmailResult> {
  const client = getClient();
  const categoryLabel = labelForCategory(business.category);

  const prompt = `Write a short cold-outreach email from Amici Market to this business:

BUSINESS: ${business.name}
CATEGORY: ${categoryLabel}
ADDRESS: ${business.address || "(unknown)"}
WEBSITE: ${business.website || "(unknown)"}
KNOWN CONTACT: ${business.contact_person || "(unknown — address generically to the office)"}
SUGGESTED CATERING ANGLE: ${suggestedOffer}
NOTES: ${business.notes || "(none)"}

Constraints:
- Subject line ≤ 8 words, no clickbait, no emojis
- Body ≤ 110 words, 2-3 short paragraphs max
- Open with something specific to *this* business — don't write a generic opener that could go to anyone
- One concrete offer (the suggested catering angle, made specific)
- Soft close: "happy to drop off a sample tray" or similar — no aggressive CTA
- Sign as Maurizio Ciminella, Amici Market
- Phone: (561) 832-0201, address: 155 N County Rd, Palm Beach, FL

Respond in this JSON format ONLY (no other text):
{"subject": "...", "body": "...", "offer_angle": "<one sentence describing the angle>"}`;

  const response = await client.messages.create({
    model: "claude-sonnet-4-20250514",
    max_tokens: 1024,
    temperature: 0.6,
    system: AMICI_BRAND,
    messages: [{ role: "user", content: prompt }],
  });

  const block = response.content[0];
  if (block.type !== "text") {
    throw new Error("Claude returned non-text response");
  }

  // Strip markdown fences if present
  const cleaned = block.text.replace(/^```(?:json)?\s*/i, "").replace(/```\s*$/i, "").trim();

  try {
    const parsed = JSON.parse(cleaned);
    return {
      subject: String(parsed.subject || "Amici Market"),
      body: String(parsed.body || ""),
      offer_angle: String(parsed.offer_angle || suggestedOffer),
    };
  } catch (err) {
    throw new Error(`Failed to parse Claude response as JSON: ${err}\nRaw: ${block.text}`);
  }
}
