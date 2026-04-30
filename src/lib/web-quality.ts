import Anthropic from "@anthropic-ai/sdk";

export interface ProgrammaticSignals {
  reachable: boolean;
  status_code: number | null;
  https: boolean;
  response_ms: number | null;
  has_viewport: boolean;
  copyright_year: number | null;
  tech_stack: string | null;
  is_placeholder: boolean;
  raw_html_excerpt: string;
  page_title: string | null;
}

const PLACEHOLDER_PATTERNS = [
  /coming soon/i,
  /under construction/i,
  /this domain is for sale/i,
  /parked free/i,
  /godaddy.*temporary/i,
];

function detectTech(html: string, headers: Headers): string | null {
  // Order matters — most specific first.
  if (/wp-content|wp-includes|wordpress/i.test(html)) {
    const m = html.match(/<meta name="generator" content="WordPress ([\d.]+)/i);
    return m ? `WordPress ${m[1]}` : "WordPress";
  }
  if (/cdn\.shopify\.com/i.test(html) || headers.get("x-shopify-stage")) return "Shopify";
  if (/squarespace.com\/(?:universal|static)/i.test(html) || /Squarespace/i.test(html)) return "Squarespace";
  if (/wixstatic\.com|_wixCIDX/i.test(html)) return "Wix";
  if (/webflow\.com|w-mod|wf-/i.test(html)) return "Webflow";
  if (/_next\/|__NEXT_DATA__/i.test(html)) return "Next.js";
  if (/gatsby-/i.test(html) || /__GATSBY/i.test(html)) return "Gatsby";
  if (/<meta name="generator" content="([^"]+)"/i.test(html)) {
    const m = html.match(/<meta name="generator" content="([^"]+)"/i);
    return m ? m[1] : null;
  }
  return null;
}

function detectCopyrightYear(html: string): number | null {
  // Look for ©/Copyright followed by a year. Pick the LATEST year found
  // (handles "© 2018-2024" by grabbing 2024).
  const matches = Array.from(html.matchAll(/(?:©|&copy;|copyright)\s*(?:\d{4}\s*[-–—]\s*)?(\d{4})/gi));
  if (matches.length === 0) return null;
  const years = matches.map((m) => parseInt(m[1])).filter((y) => y >= 2000 && y <= new Date().getFullYear() + 1);
  return years.length ? Math.max(...years) : null;
}

// Chrome-like headers to avoid bot detection (Cloudflare, AWS WAF, etc.). Many real-world
// business sites silently 403 our bot UA, then come back as "unreachable" and inflate our
// pitch_priority list with false positives. Spoofing a real browser UA is standard practice
// for this kind of "is this site alive" check.
const BROWSER_HEADERS = {
  "User-Agent": "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/127.0.0.0 Safari/537.36",
  "Accept": "text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8",
  "Accept-Language": "en-US,en;q=0.9",
  "Accept-Encoding": "gzip, deflate, br",
  "Cache-Control": "no-cache",
  "Sec-Fetch-Dest": "document",
  "Sec-Fetch-Mode": "navigate",
  "Sec-Fetch-Site": "none",
  "Upgrade-Insecure-Requests": "1",
};

export async function fetchSiteSignals(websiteUrl: string): Promise<ProgrammaticSignals> {
  const empty: ProgrammaticSignals = {
    reachable: false,
    status_code: null,
    https: false,
    response_ms: null,
    has_viewport: false,
    copyright_year: null,
    tech_stack: null,
    is_placeholder: false,
    raw_html_excerpt: "",
    page_title: null,
  };

  let url: URL;
  try {
    url = new URL(websiteUrl);
  } catch {
    return empty;
  }

  const start = Date.now();
  let res: Response | null = null;
  // Retry once on network/abort errors. Many sites are flaky; one retry catches transient
  // failures without doubling our latency budget on dead sites.
  for (let attempt = 0; attempt < 2; attempt++) {
    try {
      res = await fetch(url.toString(), {
        signal: AbortSignal.timeout(15000),
        redirect: "follow",
        headers: BROWSER_HEADERS,
      });
      break;
    } catch {
      if (attempt === 1) return { ...empty, reachable: false };
    }
  }
  if (!res) return { ...empty, reachable: false };

  try {
    const elapsed = Date.now() - start;
    const html = await res.text();
    const finalUrl = new URL(res.url);

    const titleMatch = html.match(/<title[^>]*>([^<]+)<\/title>/i);
    const tech = detectTech(html, res.headers);
    const isPlaceholder = PLACEHOLDER_PATTERNS.some((p) => p.test(html.slice(0, 4000)));

    return {
      reachable: res.ok,
      status_code: res.status,
      https: finalUrl.protocol === "https:",
      response_ms: elapsed,
      has_viewport: /<meta[^>]+name=["']viewport["']/i.test(html),
      copyright_year: detectCopyrightYear(html),
      tech_stack: tech,
      is_placeholder: isPlaceholder,
      // Trim HTML aggressively — strip script bodies which dominate size and provide no
      // signal to the LLM. Keep the head + visible body shell.
      raw_html_excerpt: html
        .replace(/<script[\s\S]*?<\/script>/gi, "")
        .replace(/<style[\s\S]*?<\/style>/gi, "")
        .replace(/<svg[\s\S]*?<\/svg>/gi, "")
        .replace(/\s+/g, " ")
        .slice(0, 6000),
      page_title: titleMatch ? titleMatch[1].trim() : null,
    };
  } catch {
    return { ...empty, reachable: false };
  }
}

export interface QualityVerdict {
  quality_score: number; // 0-100
  issues: string[]; // 1-5 specific, concrete issues
  pitch_summary: string; // 2-3 sentence rebuild pitch in Jack's voice
}

const ASSESSOR_SYSTEM = `You are a sharp, honest web-design critic helping Jack Warman (Warman Consulting) evaluate Palm Beach business websites for rebuild opportunities.

Your job: rate the site 0-100 on overall quality, list 1-5 SPECIFIC issues you can see in the HTML, and write a 2-3 sentence pitch summary Jack could use.

Score guide:
- 0-20: no website, broken, or "coming soon" placeholder
- 21-40: outdated, ugly, mobile-broken, or clearly DIY-Wix-with-stock-photos
- 41-60: functional but dated, weak conversion, missing modern basics
- 61-80: decent, modern-ish, minor issues
- 81-100: genuinely well-built, high-quality, nothing to fix

Issue style: concrete and visible. "Hero image is generic stock photo of a handshake" not "branding could be better". "No clear booking CTA above the fold" not "could improve UX".

Pitch style: warm, specific, NOT salesy. Mentions a concrete fix, not a generic offer. Sounds like a local builder who actually looked at the site, not a marketing email.`;

let _client: Anthropic | null = null;
function client(): Anthropic {
  if (!_client) {
    const apiKey = process.env.ANTHROPIC_API_KEY;
    if (!apiKey) throw new Error("ANTHROPIC_API_KEY is not set");
    _client = new Anthropic({ apiKey });
  }
  return _client;
}

export interface UsageRecord {
  input_tokens: number;
  output_tokens: number;
  cache_creation_input_tokens: number;
  cache_read_input_tokens: number;
}

// Sonnet 4.5 pricing per 1M tokens
const SONNET_PRICE = {
  input: 3.0,
  cache_creation: 3.75, // 25% premium on first cache write
  cache_read: 0.30,     // 10% of input price
  output: 15.0,
};

export function usageToCost(u: UsageRecord): number {
  return (
    (u.input_tokens * SONNET_PRICE.input) / 1_000_000 +
    (u.cache_creation_input_tokens * SONNET_PRICE.cache_creation) / 1_000_000 +
    (u.cache_read_input_tokens * SONNET_PRICE.cache_read) / 1_000_000 +
    (u.output_tokens * SONNET_PRICE.output) / 1_000_000
  );
}

export async function judgeWithClaude(params: {
  business_name: string;
  category: string;
  website_url: string;
  signals: ProgrammaticSignals;
}): Promise<{ verdict: QualityVerdict; usage: UsageRecord }> {
  const { business_name, category, website_url, signals } = params;

  if (!signals.reachable) {
    return {
      verdict: {
        quality_score: 5,
        issues: ["Website unreachable / broken at the URL on file"],
        pitch_summary: `Their site at ${website_url} doesn't load — that's the kind of thing that quietly costs them business. Worth flagging.`,
      },
      usage: { input_tokens: 0, output_tokens: 0, cache_creation_input_tokens: 0, cache_read_input_tokens: 0 },
    };
  }
  if (signals.is_placeholder) {
    return {
      verdict: {
        quality_score: 10,
        issues: ['Site is a "coming soon" / parked placeholder'],
        pitch_summary: "They're paying for a domain but have nothing on it. Quick win to put up a real one-page site with their info and an inquiry form.",
      },
      usage: { input_tokens: 0, output_tokens: 0, cache_creation_input_tokens: 0, cache_read_input_tokens: 0 },
    };
  }

  const prompt = `Evaluate this website for a Palm Beach business.

Business: ${business_name}
Category: ${category}
Website: ${website_url}

Programmatic signals:
- HTTPS: ${signals.https}
- Response time: ${signals.response_ms}ms
- Mobile viewport meta: ${signals.has_viewport}
- Copyright year detected: ${signals.copyright_year ?? "none"}
- Tech stack: ${signals.tech_stack ?? "unknown"}
- Page title: ${signals.page_title ?? "(none)"}

HTML excerpt (script/style stripped, ~6KB):
\`\`\`
${signals.raw_html_excerpt}
\`\`\`

Respond ONLY with this JSON (no other text):
{"quality_score": <0-100 integer>, "issues": ["...", "..."], "pitch_summary": "..."}`;

  const response = await client().messages.create({
    model: "claude-sonnet-4-20250514",
    max_tokens: 800,
    temperature: 0.4,
    // Cache the system prompt — it's identical across all assessor calls.
    // First call writes the cache (25% premium); subsequent calls within 5min read at 10%.
    system: [{ type: "text", text: ASSESSOR_SYSTEM, cache_control: { type: "ephemeral" } }],
    messages: [{ role: "user", content: prompt }],
  });

  const usage: UsageRecord = {
    input_tokens: response.usage.input_tokens || 0,
    output_tokens: response.usage.output_tokens || 0,
    cache_creation_input_tokens: response.usage.cache_creation_input_tokens || 0,
    cache_read_input_tokens: response.usage.cache_read_input_tokens || 0,
  };

  const block = response.content[0];
  if (block.type !== "text") throw new Error("Claude returned non-text");
  const cleaned = block.text.replace(/^```(?:json)?\s*/i, "").replace(/```\s*$/i, "").trim();
  try {
    const parsed = JSON.parse(cleaned);
    return {
      verdict: {
        quality_score: Math.max(0, Math.min(100, parseInt(parsed.quality_score) || 0)),
        issues: Array.isArray(parsed.issues) ? parsed.issues.slice(0, 5).map(String) : [],
        pitch_summary: String(parsed.pitch_summary || ""),
      },
      usage,
    };
  } catch (err) {
    throw new Error(`Failed to parse Claude verdict: ${err}\nRaw: ${block.text}`);
  }
}

// Combine programmatic adjustments with the Claude verdict for a final score.
// Programmatic gets ~30% weight (objective signals) — Claude gets 70% (qualitative judgment).
export function combineScore(signals: ProgrammaticSignals, verdict: QualityVerdict): number {
  let prog = 50;
  if (!signals.reachable) prog = 0;
  else if (signals.is_placeholder) prog = 10;
  else {
    if (signals.https) prog += 15; else prog -= 15;
    if (signals.has_viewport) prog += 10; else prog -= 15;
    if (signals.response_ms != null) {
      if (signals.response_ms > 5000) prog -= 15;
      else if (signals.response_ms > 2500) prog -= 5;
      else if (signals.response_ms < 800) prog += 5;
    }
    const currentYear = new Date().getFullYear();
    if (signals.copyright_year != null) {
      const age = currentYear - signals.copyright_year;
      if (age <= 1) prog += 5;
      else if (age >= 4) prog -= 12;
    }
    if (signals.tech_stack) {
      // Modern platforms slightly bumped, dated stacks penalized
      if (/Next|Webflow|Shopify|Astro/i.test(signals.tech_stack)) prog += 5;
      if (/WordPress [3-4]\.|FrontPage|Joomla/i.test(signals.tech_stack)) prog -= 10;
    }
  }
  prog = Math.max(0, Math.min(100, prog));
  return Math.round(prog * 0.3 + verdict.quality_score * 0.7);
}

// pitch_priority = how worth pitching, 0-100.
// Combines: how good a CUSTOMER they'd be (catering_fit_score is a decent wealth proxy)
// with how BAD their site is (lower quality_score = more upside).
// Both businesses have to be real (catering_fit > 0); skip restaurants (Amici competitors).
export function computePitchPriority(cateringFit: number, quality: number, category: string): number {
  if (category === "restaurant") return 0;
  if (cateringFit < 20) return 0; // not a real prospect
  // Wealth proxy clamp: don't penalize too hard for low fit, since web work isn't catering
  const wealthProxy = Math.min(100, cateringFit + 20);
  const upside = 100 - quality;
  return Math.round((wealthProxy / 100) * upside);
}
