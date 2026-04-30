import type { Business, BusinessCategory } from "./db";

// Rule-based catering fit scoring. 0-100. Higher = better target for Amici catering.
// Designed to be *explainable* — every point comes from a stated reason.

const CATEGORY_BASE: Record<BusinessCategory, number> = {
  // Strongest fits — wealthy, frequent entertaining, regular office lunches
  marina: 75,
  yacht_services: 75,
  wealth_management: 70,
  law_firm: 65,
  real_estate: 55,
  accounting: 50,
  // Medical: dermatology/plastic surgery/concierge often cater
  medical: 55,
  wellness: 45,
  // Luxury retail: events, gifting
  luxury_retail: 50,
  interior_design: 55,
  salon_beauty: 35,
  // Fitness: smaller offices but loyal pickups
  fitness: 30,
  // Property nodes: high upside, fewer in dataset
  property_management: 60,
  condo_association: 65,
  hotel: 60,
  // Restaurants are competitors, not targets
  restaurant: 5,
  office: 40,
  other: 20,
};

const OFFER_BY_CATEGORY: Record<BusinessCategory, string> = {
  marina: "yacht provisions / charter platters / dockside entertaining",
  yacht_services: "yacht provisions / charter platters",
  wealth_management: "client lunch catering / quarterly review platters",
  law_firm: "office lunch catering / partner meeting platters",
  real_estate: "open house spreads / closing-gift platters",
  accounting: "office lunch catering / tax-season team meals",
  medical: "staff lunch / patient appreciation gifts",
  wellness: "staff lunch / event platters",
  luxury_retail: "client event catering / gift baskets",
  interior_design: "client unveiling events / project-completion gifts",
  salon_beauty: "client appreciation / open-house events",
  fitness: "post-class spreads / member appreciation",
  property_management: "tenant events / building amenity catering",
  condo_association: "resident events / board meeting catering",
  hotel: "concierge gift program / amenity partnerships",
  restaurant: "—",
  office: "office lunch catering / team events",
  other: "general catering / event platters",
};

export interface FitResult {
  score: number;
  reason: string;
  suggested_offer: string;
}

export function scoreBusiness(b: Pick<Business, "category" | "name" | "google_rating" | "google_reviews" | "website" | "address">): FitResult {
  const reasons: string[] = [];
  let score = CATEGORY_BASE[b.category as BusinessCategory] ?? 20;

  // Reputation signal — businesses with reviews are real and active
  if (b.google_reviews && b.google_reviews >= 50) {
    score += 10;
    reasons.push(`${b.google_reviews}+ reviews (active)`);
  } else if (b.google_reviews && b.google_reviews >= 10) {
    score += 5;
    reasons.push(`${b.google_reviews} reviews`);
  }

  if (b.google_rating && b.google_rating >= 4.5) {
    score += 5;
    reasons.push(`${b.google_rating}★ rating`);
  } else if (b.google_rating && b.google_rating >= 4.0) {
    score += 2;
  }

  // Has a website → easier to find a contact
  if (b.website) {
    score += 5;
    reasons.push("website available");
  } else {
    score -= 5;
    reasons.push("no website");
  }

  // Name heuristics — phrases that suggest catering buyers
  const name = b.name.toLowerCase();
  if (/(palm beach|breakers|worth ave|rybovich|the 400|the 700)/i.test(name)) {
    score += 5;
    reasons.push("premium PB address");
  }
  if (/(group|partners|llp|p\.a\.|llc)/i.test(name) && b.category === "law_firm") {
    score += 3;
    reasons.push("multi-partner firm");
  }

  // Cap
  score = Math.max(0, Math.min(100, score));

  const categoryLabel = labelForCategory(b.category as BusinessCategory);
  const reason = `${categoryLabel}${reasons.length ? ` — ${reasons.slice(0, 3).join(", ")}` : ""}`;
  const suggested_offer = OFFER_BY_CATEGORY[b.category as BusinessCategory] || OFFER_BY_CATEGORY.other;

  return { score, reason, suggested_offer };
}

export function labelForCategory(c: BusinessCategory): string {
  const map: Record<BusinessCategory, string> = {
    marina: "Marina",
    yacht_services: "Yacht services",
    law_firm: "Law firm",
    wealth_management: "Wealth management",
    real_estate: "Real estate",
    accounting: "Accounting",
    medical: "Medical",
    wellness: "Wellness",
    luxury_retail: "Luxury retail",
    interior_design: "Interior design",
    salon_beauty: "Salon / beauty",
    fitness: "Fitness studio",
    property_management: "Property management",
    condo_association: "Condo association",
    hotel: "Hotel",
    restaurant: "Restaurant",
    office: "Office",
    other: "Other",
  };
  return map[c] || c;
}

// Names that aren't actually viable customers for catering OR web rebuilds —
// government services, courts, public infrastructure, one-off events, etc.
// Matched as substring (case-insensitive) on the business name.
const EXCLUSION_PATTERNS: RegExp[] = [
  /\b(court|courthouse|clerk of)\b/i,
  /\bcomptroller\b/i,
  /\b(department of|division of|bureau of)\b/i,
  /\b(public dock|public marina|public works)\b/i,
  /\b(sheriff|police|fire dept|fire department|fire station)\b/i,
  /\b(boat show|yacht show|trade show|expo|conference center)\b/i,
  /\b(post office|usps|dmv)\b/i,
  /\bschool district\b/i,
  /\b(library|public library)\b/i,
  /\bhealth care district\b/i, // government org, not a hospital
  /\b(city hall|town hall|municipal)\b/i,
  /\b(parking garage|parking lot)\b/i,
  /\b(homeless|food pantry)\b/i,
];

// True if the business name matches any exclusion pattern. Such businesses should be
// dropped from outreach pipelines (status=dead, fit_score=0) — they aren't real customers.
export function isExcludedName(name: string): boolean {
  return EXCLUSION_PATTERNS.some((p) => p.test(name));
}

export function colorForCategory(c: BusinessCategory): string {
  const map: Record<BusinessCategory, string> = {
    marina: "#1E88E5",
    yacht_services: "#42A5F5",
    law_firm: "#5E35B1",
    wealth_management: "#3949AB",
    real_estate: "#00897B",
    accounting: "#00ACC1",
    medical: "#E53935",
    wellness: "#F4511E",
    luxury_retail: "#D81B60",
    interior_design: "#8E24AA",
    salon_beauty: "#EC407A",
    fitness: "#43A047",
    property_management: "#6D4C41",
    condo_association: "#5D4037",
    hotel: "#FB8C00",
    restaurant: "#9E9E9E",
    office: "#607D8B",
    other: "#757575",
  };
  return map[c] || "#757575";
}
