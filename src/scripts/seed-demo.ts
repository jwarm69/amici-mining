/* eslint-disable no-console */
// Optional fallback if user wants to demo the UI before the Google API key is wired up.
// Inserts ~10 plausible businesses in the Amici zone.
import { upsertBusiness } from "../lib/db";
import { scoreBusiness } from "../lib/scoring";

async function main() {
  if (!process.env.TURSO_DATABASE_URL) {
    console.error("TURSO_DATABASE_URL is not set.");
    process.exit(1);
  }
  console.log("Seeding demo businesses…");
  const SEED = [
    { name: "Rybovich Marina", category: "marina" as const, address: "4200 N Flagler Dr, West Palm Beach, FL 33407", lat: 26.7710, lng: -80.0470, website: "https://rybovich.com", phone: "(561) 844-1800", rating: 4.5, reviews: 88 },
    { name: "Searcy Denney Scarola Barnhart & Shipley", category: "law_firm" as const, address: "2139 Palm Beach Lakes Blvd, West Palm Beach, FL 33409", lat: 26.7100, lng: -80.0750, website: "https://searcylaw.com", phone: "(561) 686-6300", rating: 4.7, reviews: 120 },
    { name: "Steven Caras Real Estate", category: "real_estate" as const, address: "319 Clematis St, West Palm Beach, FL 33401", lat: 26.7140, lng: -80.0530, website: "https://carasrealestate.com", phone: "(561) 832-5000", rating: 4.8, reviews: 45 },
    { name: "Kaufman Lynn Construction (WPB office)", category: "office" as const, address: "777 S Flagler Dr, West Palm Beach, FL 33401", lat: 26.7000, lng: -80.0510, website: "https://kaufmanlynn.com", phone: "(561) 367-1500", rating: 4.6, reviews: 32 },
    { name: "Fern Forsyth Interior Design", category: "interior_design" as const, address: "211 Bradley Pl, Palm Beach, FL 33480", lat: 26.7080, lng: -80.0450, website: "https://fernforsyth.com", phone: "(561) 832-1200", rating: 4.9, reviews: 22 },
    { name: "Bilotta Plastic Surgery", category: "medical" as const, address: "1411 N Flagler Dr, West Palm Beach, FL 33401", lat: 26.7280, lng: -80.0510, website: "https://bilottamd.com", phone: "(561) 655-3110", rating: 4.7, reviews: 58 },
    { name: "Echo Salon Palm Beach", category: "salon_beauty" as const, address: "256 Worth Ave, Palm Beach, FL 33480", lat: 26.7010, lng: -80.0420, website: "https://echosalonpb.com", phone: "(561) 833-3326", rating: 4.6, reviews: 70 },
    { name: "Greenleaf Diamonds", category: "luxury_retail" as const, address: "238 Worth Ave, Palm Beach, FL 33480", lat: 26.7010, lng: -80.0421, website: "https://greenleafdiamonds.com", phone: "(561) 655-5850", rating: 4.9, reviews: 48 },
    { name: "Pilates Of Palm Beach", category: "fitness" as const, address: "237 S County Rd, Palm Beach, FL 33480", lat: 26.7060, lng: -80.0430, phone: "(561) 833-2200", rating: 4.8, reviews: 35 },
    { name: "The Breakers Concierge", category: "hotel" as const, address: "1 S County Rd, Palm Beach, FL 33480", lat: 26.7165, lng: -80.0382, website: "https://thebreakers.com", phone: "(561) 655-6611", rating: 4.8, reviews: 4200 },
  ];

  for (const seed of SEED) {
    const fit = scoreBusiness({
      name: seed.name,
      category: seed.category,
      google_rating: seed.rating ?? null,
      google_reviews: seed.reviews ?? null,
      website: seed.website ?? null,
      address: seed.address,
    });
    await upsertBusiness({
      name: seed.name,
      category: seed.category,
      address: seed.address,
      lat: seed.lat,
      lng: seed.lng,
      website: seed.website ?? null,
      phone: seed.phone ?? null,
      google_rating: seed.rating ?? null,
      google_reviews: seed.reviews ?? null,
      source: "demo_seed",
      fit_score: fit.score,
      fit_reason: fit.reason,
    });
    console.log(`  ✓ ${seed.name} (fit ${fit.score})`);
  }
  console.log(`\nSeeded ${SEED.length} demo businesses.`);
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
