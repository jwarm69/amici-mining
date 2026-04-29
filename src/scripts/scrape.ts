/* eslint-disable no-console */
import { upsertBusiness, logScrapeRun, type BusinessCategory } from "../lib/db";
import { AMICI_ZONE, gridForPolygon, isInAmiciZone } from "../lib/geo";
import { searchNearby, classifyTypes, scrapeEmailFromSite, SEARCH_INCLUDED_TYPES } from "../lib/places";
import { scoreBusiness } from "../lib/scoring";

async function main() {
  const apiKey = process.env.GOOGLE_PLACES_API_KEY;
  if (!apiKey) {
    console.error("GOOGLE_PLACES_API_KEY is not set.");
    process.exit(1);
  }
  if (!process.env.TURSO_DATABASE_URL) {
    console.error("TURSO_DATABASE_URL is not set.");
    process.exit(1);
  }

  // Read --groups arg, default to all
  const groupsArg = process.argv.find((a) => a.startsWith("--groups="));
  const skipEmails = process.argv.includes("--no-emails");
  const groups: string[] = groupsArg
    ? groupsArg.replace("--groups=", "").split(",").map((s) => s.trim()).filter(Boolean)
    : Object.keys(SEARCH_INCLUDED_TYPES);

  const grid = gridForPolygon(AMICI_ZONE);
  console.log(`Scraping groups: ${groups.join(", ")}`);
  console.log(`Grid cells: ${grid.length}`);
  console.log(`Total nearby calls: ${grid.length * groups.length}`);
  console.log(`Estimated cost: $${((grid.length * groups.length * 0.032)).toFixed(2)}`);
  console.log("---");

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
  let nearbyCalls = 0;

  try {
    for (const group of groups) {
      const includedTypes = SEARCH_INCLUDED_TYPES[group];
      if (!includedTypes) {
        console.warn(`Unknown group: ${group} — skipping`);
        continue;
      }
      console.log(`\n→ ${group} (${includedTypes.join(", ")})`);

      for (let i = 0; i < grid.length; i++) {
        const cell = grid[i];
        process.stdout.write(`  cell ${i + 1}/${grid.length}…`);
        const places = await searchNearby({
          apiKey,
          lat: cell.lat,
          lng: cell.lng,
          radiusMeters: cell.radius,
          includedTypes,
        });
        nearbyCalls++;

        let cellNew = 0;
        for (const place of places) {
          if (seenPlaceIds.has(place.id)) continue;
          seenPlaceIds.add(place.id);
          totalFound++;

          const lat = place.location?.latitude ?? null;
          const lng = place.location?.longitude ?? null;
          if (!lat || !lng || !isInAmiciZone(lat, lng)) {
            totalSkipped++;
            continue;
          }
          if (place.businessStatus && place.businessStatus !== "OPERATIONAL") {
            totalSkipped++;
            continue;
          }

          const category = classifyTypes(place.types, place.primaryType) as BusinessCategory;
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
          await upsertBusiness({
            ...partial,
            fit_score: fit.score,
            fit_reason: fit.reason,
          });
          totalInserted++;
          cellNew++;
        }
        process.stdout.write(` +${cellNew}\n`);
      }
    }

    const costCents = Math.round(nearbyCalls * 3.2);
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
    console.log(`Nearby calls: ${nearbyCalls}`);
    console.log(`Estimated cost: $${(costCents / 100).toFixed(2)}`);
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    await logScrapeRun({
      id: runId,
      categories: groups,
      total_found: totalFound,
      total_inserted: totalInserted,
      total_skipped: totalSkipped,
      cost_cents: Math.round(nearbyCalls * 3.2),
      status: "failed",
      error: msg,
    });
    console.error("FAILED:", msg);
    process.exit(1);
  }
}

main();
