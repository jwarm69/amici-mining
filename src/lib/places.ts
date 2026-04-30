// Google Places API (New) wrapper. Uses the v1 REST endpoints.
// Pricing (as of late 2025):
//   - searchNearby: ~$32 / 1000 calls
//   - place details (full):  ~$17 / 1000 calls
// Fields are restricted to keep cost in the cheaper SKU tiers where possible.

const PLACES_BASE = "https://places.googleapis.com/v1";

export interface PlacesNearbyResult {
  id: string; // Google place ID
  name: string;
  displayName?: { text: string };
  primaryType?: string;
  types?: string[];
  formattedAddress?: string;
  location?: { latitude: number; longitude: number };
  rating?: number;
  userRatingCount?: number;
  websiteUri?: string;
  internationalPhoneNumber?: string;
  nationalPhoneNumber?: string;
  businessStatus?: string;
}

// Google Places "type" → our internal category. The first match wins; order matters.
// See: https://developers.google.com/maps/documentation/places/web-service/place-types
export const TYPE_TO_CATEGORY: Array<[string, string]> = [
  ["marina", "marina"],
  ["boat_rental", "yacht_services"],
  ["boat_dealer", "yacht_services"],
  ["lawyer", "law_firm"],
  ["accounting", "accounting"],
  ["financial_consultant", "wealth_management"],
  ["real_estate_agency", "real_estate"],
  ["doctor", "medical"],
  ["dentist", "medical"],
  ["spa", "wellness"],
  ["beauty_salon", "salon_beauty"],
  ["hair_salon", "salon_beauty"],
  ["nail_salon", "salon_beauty"],
  ["jewelry_store", "luxury_retail"],
  ["clothing_store", "luxury_retail"],
  ["art_gallery", "luxury_retail"],
  ["furniture_store", "interior_design"],
  ["home_goods_store", "interior_design"],
  ["gym", "fitness"],
  ["fitness_center", "fitness"],
  ["yoga_studio", "fitness"],
  ["lodging", "hotel"],
  ["restaurant", "restaurant"],
];

export function classifyTypes(types: string[] | undefined, primaryType?: string): string {
  const all = [primaryType, ...(types || [])].filter(Boolean) as string[];
  for (const [gType, cat] of TYPE_TO_CATEGORY) {
    if (all.includes(gType)) return cat;
  }
  return "other";
}

// "Included types" grouped for human-friendly CLI filtering (`--groups=marine`).
// Internally, the scraper queries ONE TYPE PER CALL — so each type below gets its own
// 20-result slot per grid cell. This avoids losing density in cells where multiple
// types overlap (e.g. a downtown cell with 15 lawyers + 12 accountants).
export const SEARCH_INCLUDED_TYPES: Record<string, string[]> = {
  professional: ["lawyer", "accounting", "real_estate_agency", "financial_consultant"],
  marine: ["marina", "boat_rental", "boat_dealer"],
  medical_wellness: ["doctor", "dentist", "spa"],
  beauty: ["beauty_salon", "hair_salon", "nail_salon"],
  retail_luxury: ["jewelry_store", "art_gallery", "furniture_store", "home_goods_store"],
  fitness: ["gym", "yoga_studio"],
  hospitality: ["lodging"],
};

export function flattenTypes(groups: string[]): string[] {
  const out = new Set<string>();
  for (const g of groups) {
    const types = SEARCH_INCLUDED_TYPES[g];
    if (!types) continue;
    for (const t of types) out.add(t);
  }
  return Array.from(out);
}

// Niche text queries for categories Google's type taxonomy misses or misclassifies.
// Each runs ONE searchText call bounded to the polygon — returns up to 20 results.
// expectedCategory overrides classifyTypes() so e.g. "yacht broker" goes to yacht_services
// even though Google may tag it as real_estate_agency or just establishment.
export const NICHE_TEXT_QUERIES: Array<{ query: string; expectedCategory: string }> = [
  { query: "yacht broker palm beach", expectedCategory: "yacht_services" },
  { query: "yacht management palm beach", expectedCategory: "yacht_services" },
  { query: "boat charter palm beach", expectedCategory: "yacht_services" },
  { query: "interior designer palm beach", expectedCategory: "interior_design" },
  { query: "concierge medicine palm beach", expectedCategory: "medical" },
  { query: "plastic surgeon palm beach", expectedCategory: "medical" },
  { query: "med spa palm beach", expectedCategory: "wellness" },
  { query: "wealth management palm beach", expectedCategory: "wealth_management" },
  { query: "family office palm beach", expectedCategory: "wealth_management" },
  { query: "private equity firm palm beach", expectedCategory: "wealth_management" },
];

export interface SearchOptions {
  apiKey: string;
  lat: number;
  lng: number;
  radiusMeters: number;
  includedTypes: string[];
  maxResults?: number; // 1-20
}

export interface SearchTextOptions {
  apiKey: string;
  query: string;
  // High/low corners of a rectangle bounding the polygon.
  // searchText accepts a rectangular locationRestriction (not arbitrary polygons).
  bounds: { low: { lat: number; lng: number }; high: { lat: number; lng: number } };
  maxResults?: number;
}

export async function searchText(opts: SearchTextOptions): Promise<PlacesNearbyResult[]> {
  const { apiKey, query, bounds, maxResults = 20 } = opts;
  const fieldMask = [
    "places.id",
    "places.displayName",
    "places.primaryType",
    "places.types",
    "places.formattedAddress",
    "places.location",
    "places.rating",
    "places.userRatingCount",
    "places.websiteUri",
    "places.nationalPhoneNumber",
    "places.businessStatus",
  ].join(",");

  const res = await fetch(`${PLACES_BASE}/places:searchText`, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      "X-Goog-Api-Key": apiKey,
      "X-Goog-FieldMask": fieldMask,
    },
    body: JSON.stringify({
      textQuery: query,
      pageSize: maxResults,
      locationRestriction: {
        rectangle: {
          low: { latitude: bounds.low.lat, longitude: bounds.low.lng },
          high: { latitude: bounds.high.lat, longitude: bounds.high.lng },
        },
      },
    }),
  });

  if (!res.ok) {
    const text = await res.text();
    throw new Error(`Google Places searchText failed: ${res.status} ${text}`);
  }

  const json = await res.json();
  return (json.places || []).map((p: PlacesNearbyResult) => ({
    ...p,
    name: p.displayName?.text || p.id,
  }));
}

export async function searchNearby(opts: SearchOptions): Promise<PlacesNearbyResult[]> {
  const { apiKey, lat, lng, radiusMeters, includedTypes, maxResults = 20 } = opts;
  const fieldMask = [
    "places.id",
    "places.displayName",
    "places.primaryType",
    "places.types",
    "places.formattedAddress",
    "places.location",
    "places.rating",
    "places.userRatingCount",
    "places.websiteUri",
    "places.nationalPhoneNumber",
    "places.businessStatus",
  ].join(",");

  const res = await fetch(`${PLACES_BASE}/places:searchNearby`, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      "X-Goog-Api-Key": apiKey,
      "X-Goog-FieldMask": fieldMask,
    },
    body: JSON.stringify({
      includedTypes,
      maxResultCount: maxResults,
      locationRestriction: {
        circle: {
          center: { latitude: lat, longitude: lng },
          radius: radiusMeters,
        },
      },
    }),
  });

  if (!res.ok) {
    const text = await res.text();
    throw new Error(`Google Places searchNearby failed: ${res.status} ${text}`);
  }

  const json = await res.json();
  const places: PlacesNearbyResult[] = (json.places || []).map((p: PlacesNearbyResult) => ({
    ...p,
    name: p.displayName?.text || p.id,
  }));
  return places;
}

// Best-effort email scrape: fetch the website root + a few obvious paths,
// regex out mailto: links + email-shaped strings. We deliberately don't follow
// random links — keeps it fast and avoids bot-detection escalation.
export async function scrapeEmailFromSite(websiteUrl: string): Promise<string | null> {
  if (!websiteUrl) return null;
  let base: URL;
  try {
    base = new URL(websiteUrl);
  } catch {
    return null;
  }
  const paths = ["", "/contact", "/contact-us", "/about", "/about-us"];
  const seen = new Set<string>();
  const re = /([a-zA-Z0-9._%+-]+@[a-zA-Z0-9.-]+\.[a-zA-Z]{2,})/g;
  for (const p of paths) {
    try {
      const url = new URL(p, base).toString();
      const res = await fetch(url, {
        signal: AbortSignal.timeout(8000),
        headers: { "User-Agent": "AmiciMiningBot/1.0 (+https://amici-mining.local)" },
      });
      if (!res.ok) continue;
      const html = await res.text();
      const matches = html.match(re) || [];
      for (const m of matches) {
        const lower = m.toLowerCase();
        if (lower.endsWith(".png") || lower.endsWith(".jpg") || lower.endsWith(".gif")) continue;
        if (lower.includes("@sentry") || lower.includes("@example") || lower.includes("@wixpress")) continue;
        seen.add(lower);
      }
      if (seen.size > 0) break; // first hit wins
    } catch {
      // ignore — try next path
    }
  }
  if (seen.size === 0) return null;
  // Prefer info@/contact@/hello@ over generic webmaster@
  const sorted = Array.from(seen).sort((a, b) => {
    const score = (e: string) => {
      if (/^(info|contact|hello|sales|catering|events)@/.test(e)) return 0;
      if (/^(office|admin|reception)@/.test(e)) return 1;
      return 2;
    };
    return score(a) - score(b);
  });
  return sorted[0];
}
