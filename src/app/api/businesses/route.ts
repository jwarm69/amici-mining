import { NextRequest, NextResponse } from "next/server";
import { listBusinesses, upsertBusiness, type BusinessCategory, type BusinessStatus } from "@/lib/db";
import { scoreBusiness } from "@/lib/scoring";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function GET(req: NextRequest) {
  const searchParams = req.nextUrl.searchParams;
  const category = searchParams.get("category") as BusinessCategory | null;
  const status = searchParams.get("status") as BusinessStatus | null;
  const minFit = searchParams.get("minFit");

  const businesses = await listBusinesses({
    category: category || undefined,
    status: status || undefined,
    minFit: minFit ? parseInt(minFit, 10) : undefined,
  });

  return NextResponse.json({ businesses });
}

export async function POST(req: NextRequest) {
  const body = await req.json();
  if (!body.name) {
    return NextResponse.json({ error: "name is required" }, { status: 400 });
  }
  // Auto-score if not provided
  if (body.fit_score === undefined && body.category) {
    const fit = scoreBusiness(body);
    body.fit_score = fit.score;
    body.fit_reason = fit.reason;
  }
  const created = await upsertBusiness(body);
  return NextResponse.json({ business: created });
}
