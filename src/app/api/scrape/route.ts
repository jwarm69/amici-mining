import { NextRequest, NextResponse } from "next/server";
import { upsertBusiness, logScrapeRun, type BusinessCategory } from "@/lib/db";
import { AMICI_ZONE, gridDensityAware, isInAmiciZone, polygonBounds } from "@/lib/geo";
import {
  searchNearby,
  searchText,
  classifyTypes,
  scrapeEmailFromSite,
  flattenTypes,
  SEARCH_INCLUDED_TYPES,
  NICHE_TEXT_QUERIES,
} from "@/lib/places";
import { scoreBusiness } from "@/lib/scoring";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";
// Vercel Hobby caps at 300s (5min). A full ~750-call scrape needs ~10min, so it can't run
// here — use the CLI instead (`npm run scrape`). This route is fine for small targeted runs
// like `--groups=hospitality` (~37 calls, finishes in <1min).
export const maxDuration = 300;

const COST_PER_CALL = 0.032;

export async function POST(req: NextRequest) {
  const apiKey = process.env.GOOGLE_PLACES_API_KEY;
  if (!apiKey) return NextResponse.json({ error: "GOOGLE_PLACES_API_KEY not set" }, { status: 500 });

  const body = await req.json().catch(() => ({}));
  const groups: string[] = body.groups || Object.keys(SEARCH_INCLUDED_TYPES);
  const enrichEmails: boolean = body.enrich_emails ?? true;
  const skipNiche: boolean = body.skip_niche ?? false;
  const dryRun: boolean = body.dry_run ?? false;

  const types = flattenTypes(groups);
  const grid = gridDensityAware(AMICI_ZONE);
  const bounds = polygonBounds(AMICI_ZONE);
  const totalCalls = grid.length * types.length + (skipNiche ? 0 : NICHE_TEXT_QUERIES.length);
  const estCost = totalCalls * COST_PER_CALL;

  if (dryRun) {
    return NextResponse.json({
      plan: {
        groups,
        types,
        grid_cells: grid.length,
        nearby_calls: grid.length * types.length,
        niche_calls: skipNiche ? 0 : NICHE_TEXT_QUERIES.length,
        total_calls: totalCalls,
        estimated_cost_usd: estCost,
        free_credit_remaining_full_scrapes: Math.floor(200 / estCost),
      },
    });
  }

  const runId = crypto.randomUUID();
  await logScrapeRun({
    id: runId, categories: groups, total_found: 0, total_inserted: 0, total_skipped: 0,
    cost_cents: 0, status: "running",
  });

  const seenPlaceIds = new Set<string>();
  let totalFound = 0, totalInserted = 0, totalSkipped = 0, callsMade = 0;

  async function processPlace(
    place: { id: string; name: string; primaryType?: string; types?: string[]; formattedAddress?: string; location?: { latitude: number; longitude: number }; rating?: number; userRatingCount?: number; websiteUri?: string; nationalPhoneNumber?: string; businessStatus?: string },
    overrideCategory?: string
  ) {
    if (seenPlaceIds.has(place.id)) return;
    seenPlaceIds.add(place.id);
    totalFound++;

    const lat = place.location?.latitude ?? null;
    const lng = place.location?.longitude ?? null;
    if (!lat || !lng || !isInAmiciZone(lat, lng)) { totalSkipped++; return; }
    if (place.businessStatus && place.businessStatus !== "OPERATIONAL") { totalSkipped++; return; }

    let category = (overrideCategory ?? classifyTypes(place.types, place.primaryType)) as BusinessCategory;
    if (overrideCategory) {
      const auto = classifyTypes(place.types, place.primaryType);
      if (auto !== "other" && auto !== overrideCategory) category = auto as BusinessCategory;
    }

    let email: string | null = null;
    if (enrichEmails && place.websiteUri) {
      try { email = await scrapeEmailFromSite(place.websiteUri); } catch { email = null; }
    }

    const partial = {
      name: place.name, category, address: place.formattedAddress ?? null,
      lat, lng, website: place.websiteUri ?? null, email,
      phone: place.nationalPhoneNumber ?? null, google_place_id: place.id,
      google_rating: place.rating ?? null, google_reviews: place.userRatingCount ?? null,
      source: "google_places", source_url: place.websiteUri ?? null,
    };
    const fit = scoreBusiness(partial);
    await upsertBusiness({ ...partial, fit_score: fit.score, fit_reason: fit.reason });
    totalInserted++;
  }

  try {
    for (const type of types) {
      for (const cell of grid) {
        const places = await searchNearby({
          apiKey, lat: cell.lat, lng: cell.lng, radiusMeters: cell.radius, includedTypes: [type],
        });
        callsMade++;
        for (const p of places) await processPlace(p);
      }
    }
    if (!skipNiche) {
      for (const niche of NICHE_TEXT_QUERIES) {
        try {
          const places = await searchText({ apiKey, query: niche.query, bounds });
          callsMade++;
          for (const p of places) await processPlace(p, niche.expectedCategory);
        } catch { /* one bad query shouldn't kill the run */ }
      }
    }

    const costCents = Math.round(callsMade * COST_PER_CALL * 100);
    await logScrapeRun({
      id: runId, categories: groups,
      total_found: totalFound, total_inserted: totalInserted, total_skipped: totalSkipped,
      cost_cents: costCents, status: "complete",
    });
    return NextResponse.json({
      run_id: runId,
      total_found: totalFound,
      total_inserted: totalInserted,
      total_skipped: totalSkipped,
      calls_made: callsMade,
      cost_cents: costCents,
    });
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    await logScrapeRun({
      id: runId, categories: groups,
      total_found: totalFound, total_inserted: totalInserted, total_skipped: totalSkipped,
      cost_cents: Math.round(callsMade * COST_PER_CALL * 100), status: "failed", error: msg,
    });
    return NextResponse.json({ error: msg }, { status: 500 });
  }
}
