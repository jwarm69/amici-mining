import { NextRequest, NextResponse } from "next/server";
import { upsertBusiness, logScrapeRun } from "@/lib/db";
import { AMICI_ZONE, gridForPolygon, isInAmiciZone } from "@/lib/geo";
import { searchNearby, classifyTypes, scrapeEmailFromSite, SEARCH_INCLUDED_TYPES } from "@/lib/places";
import { scoreBusiness } from "@/lib/scoring";
import type { BusinessCategory } from "@/lib/db";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";
export const maxDuration = 300;

export async function POST(req: NextRequest) {
  const apiKey = process.env.GOOGLE_PLACES_API_KEY;
  if (!apiKey) {
    return NextResponse.json({ error: "GOOGLE_PLACES_API_KEY not set" }, { status: 500 });
  }

  const body = await req.json().catch(() => ({}));
  const groups: string[] = body.groups || Object.keys(SEARCH_INCLUDED_TYPES);
  const enrichEmails: boolean = body.enrich_emails ?? true;

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

  try {
    const grid = gridForPolygon(AMICI_ZONE);
    const seenPlaceIds = new Set<string>();
    let totalFound = 0;
    let totalInserted = 0;
    let totalSkipped = 0;
    let nearbyCalls = 0;

    for (const group of groups) {
      const includedTypes = SEARCH_INCLUDED_TYPES[group];
      if (!includedTypes) continue;

      for (const cell of grid) {
        const places = await searchNearby({
          apiKey,
          lat: cell.lat,
          lng: cell.lng,
          radiusMeters: cell.radius,
          includedTypes,
        });
        nearbyCalls++;

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
          if (enrichEmails && place.websiteUri) {
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
        }
      }
    }

    // Cost: ~$32/1000 nearby calls = 3.2¢ per call
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

    return NextResponse.json({
      run_id: runId,
      total_found: totalFound,
      total_inserted: totalInserted,
      total_skipped: totalSkipped,
      nearby_calls: nearbyCalls,
      cost_cents: costCents,
    });
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    await logScrapeRun({
      id: runId,
      categories: groups,
      total_found: 0,
      total_inserted: 0,
      total_skipped: 0,
      cost_cents: 0,
      status: "failed",
      error: msg,
    });
    return NextResponse.json({ error: msg }, { status: 500 });
  }
}
