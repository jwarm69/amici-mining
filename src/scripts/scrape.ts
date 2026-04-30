/* eslint-disable no-console */
import { upsertBusiness, logScrapeRun, type BusinessCategory } from "../lib/db";
import { AMICI_ZONE, gridDensityAware, isInAmiciZone, polygonBounds } from "../lib/geo";
import {
  searchNearby,
  searchText,
  classifyTypes,
  scrapeEmailFromSite,
  flattenTypes,
  SEARCH_INCLUDED_TYPES,
  NICHE_TEXT_QUERIES,
} from "../lib/places";
import { scoreBusiness } from "../lib/scoring";

const COST_PER_CALL = 0.032;
const SAFETY_CAP_USD = 50; // Refuses to run if estimated cost > this. Free tier = $200/mo.

async function main() {
  const groupsArg = process.argv.find((a) => a.startsWith("--groups="));
  const skipEmails = process.argv.includes("--no-emails");
  const skipNiche = process.argv.includes("--no-niche");
  const dryRun = process.argv.includes("--dry-run");
  const force = process.argv.includes("--force");

  const apiKey = process.env.GOOGLE_PLACES_API_KEY;
  if (!dryRun && !apiKey) {
    console.error("GOOGLE_PLACES_API_KEY is not set.");
    process.exit(1);
  }
  if (!dryRun && !process.env.TURSO_DATABASE_URL) {
    console.error("TURSO_DATABASE_URL is not set.");
    process.exit(1);
  }

  const groups: string[] = groupsArg
    ? groupsArg.replace("--groups=", "").split(",").map((s) => s.trim()).filter(Boolean)
    : Object.keys(SEARCH_INCLUDED_TYPES);

  const types = flattenTypes(groups);
  const grid = gridDensityAware(AMICI_ZONE);
  const bounds = polygonBounds(AMICI_ZONE);
  const nearbyCallsPlanned = grid.length * types.length;
  const textCallsPlanned = skipNiche ? 0 : NICHE_TEXT_QUERIES.length;
  const totalCalls = nearbyCallsPlanned + textCallsPlanned;
  const estCost = totalCalls * COST_PER_CALL;

  console.log("=== SCRAPE PLAN ===");
  console.log(`  Groups: ${groups.join(", ")}`);
  console.log(`  Types (per-type queries): ${types.length} — ${types.join(", ")}`);
  console.log(`  Density-aware grid cells: ${grid.length}`);
  console.log(`  Niche text queries: ${textCallsPlanned}${skipNiche ? " (skipped)" : ""}`);
  console.log(`  Nearby calls: ${grid.length} × ${types.length} = ${nearbyCallsPlanned}`);
  console.log(`  Total Places API calls: ${totalCalls}`);
  console.log(`  Estimated paid price: $${estCost.toFixed(2)} (offset by $200/mo free Maps credit)`);
  console.log(`  Free credit covers: ${Math.floor(200 / estCost)} full scrapes/month`);
  console.log("===================");

  if (dryRun) {
    console.log("\n[--dry-run] Exiting without making API calls.");
    return;
  }

  if (estCost > SAFETY_CAP_USD && !force) {
    console.error(
      `\nABORT: estimated cost $${estCost.toFixed(2)} exceeds safety cap $${SAFETY_CAP_USD}. ` +
        `Re-run with --force to override.`
    );
    process.exit(1);
  }

  if (!apiKey) {
    // Already exited above for non-dry-run; this satisfies the type checker.
    return;
  }

  const runId = crypto.randomUUID();
  await logScrapeRun({
    id: runId,
    categories: groups,
    total_found: 0,
    total_inserted: 0,
    total_skipped: 0,
    cost_cents: 0,
    status: "running",
  });

  const seenPlaceIds = new Set<string>();
  let totalFound = 0;
  let totalInserted = 0;
  let totalSkipped = 0;
  let callsMade = 0;

  async function processPlace(
    place: { id: string; name: string; primaryType?: string; types?: string[]; formattedAddress?: string; location?: { latitude: number; longitude: number }; rating?: number; userRatingCount?: number; websiteUri?: string; nationalPhoneNumber?: string; businessStatus?: string },
    overrideCategory?: string
  ) {
    if (seenPlaceIds.has(place.id)) return false;
    seenPlaceIds.add(place.id);
    totalFound++;

    const lat = place.location?.latitude ?? null;
    const lng = place.location?.longitude ?? null;
    if (!lat || !lng || !isInAmiciZone(lat, lng)) {
      totalSkipped++;
      return false;
    }
    if (place.businessStatus && place.businessStatus !== "OPERATIONAL") {
      totalSkipped++;
      return false;
    }

    let category = (overrideCategory ?? classifyTypes(place.types, place.primaryType)) as BusinessCategory;
    // If classifyTypes confidently picks a non-other category, prefer it over the override
    // (e.g. if Google clearly tags a result as `restaurant`, don't force it into yacht_services).
    if (overrideCategory) {
      const auto = classifyTypes(place.types, place.primaryType);
      if (auto !== "other" && auto !== overrideCategory) category = auto as BusinessCategory;
    }

    let email: string | null = null;
    if (!skipEmails && place.websiteUri) {
      try {
        email = await scrapeEmailFromSite(place.websiteUri);
      } catch {
        email = null;
      }
    }

    const partial = {
      name: place.name,
      category,
      address: place.formattedAddress ?? null,
      lat,
      lng,
      website: place.websiteUri ?? null,
      email,
      phone: place.nationalPhoneNumber ?? null,
      google_place_id: place.id,
      google_rating: place.rating ?? null,
      google_reviews: place.userRatingCount ?? null,
      source: "google_places",
      source_url: place.websiteUri ?? null,
    };
    const fit = scoreBusiness(partial);
    await upsertBusiness({ ...partial, fit_score: fit.score, fit_reason: fit.reason });
    totalInserted++;
    return true;
  }

  try {
    // ─── Pass 1: per-type searchNearby across density-aware grid ───
    for (const type of types) {
      console.log(`\n→ ${type}`);
      let typeNew = 0;
      for (let i = 0; i < grid.length; i++) {
        const cell = grid[i];
        const places = await searchNearby({
          apiKey,
          lat: cell.lat,
          lng: cell.lng,
          radiusMeters: cell.radius,
          includedTypes: [type],
        });
        callsMade++;
        for (const p of places) {
          if (await processPlace(p)) typeNew++;
        }
      }
      console.log(`  +${typeNew} new (cumulative: ${totalInserted})`);
    }

    // ─── Pass 2: niche searchText queries ───
    if (!skipNiche) {
      console.log(`\n→ niche text queries`);
      for (const niche of NICHE_TEXT_QUERIES) {
        try {
          const places = await searchText({ apiKey, query: niche.query, bounds });
          callsMade++;
          let nicheNew = 0;
          for (const p of places) {
            if (await processPlace(p, niche.expectedCategory)) nicheNew++;
          }
          console.log(`  ${niche.query.padEnd(35)} +${nicheNew}`);
        } catch (err) {
          console.log(`  ${niche.query.padEnd(35)} ERROR: ${err instanceof Error ? err.message : err}`);
        }
      }
    }

    const costCents = Math.round(callsMade * COST_PER_CALL * 100);
    await logScrapeRun({
      id: runId,
      categories: groups,
      total_found: totalFound,
      total_inserted: totalInserted,
      total_skipped: totalSkipped,
      cost_cents: costCents,
      status: "complete",
    });
    console.log("\n=== DONE ===");
    console.log(`Found: ${totalFound}`);
    console.log(`Inserted/updated: ${totalInserted}`);
    console.log(`Skipped (out of zone or closed): ${totalSkipped}`);
    console.log(`Calls made: ${callsMade}`);
    console.log(`Estimated paid cost: $${(callsMade * COST_PER_CALL).toFixed(2)} (covered by free tier)`);
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    await logScrapeRun({
      id: runId,
      categories: groups,
      total_found: totalFound,
      total_inserted: totalInserted,
      total_skipped: totalSkipped,
      cost_cents: Math.round(callsMade * COST_PER_CALL * 100),
      status: "failed",
      error: msg,
    });
    console.error("FAILED:", msg);
    process.exit(1);
  }
}

main();
