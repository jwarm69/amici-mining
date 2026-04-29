import { NextRequest, NextResponse } from "next/server";
import { createDraft, getBusiness } from "@/lib/db";
import { draftOutreachEmail } from "@/lib/claude";
import { scoreBusiness } from "@/lib/scoring";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";
export const maxDuration = 60;

export async function POST(req: NextRequest) {
  const { business_id } = await req.json();
  if (!business_id) {
    return NextResponse.json({ error: "business_id is required" }, { status: 400 });
  }

  const business = await getBusiness(business_id);
  if (!business) return NextResponse.json({ error: "business not found" }, { status: 404 });

  const fit = scoreBusiness(business);
  const drafted = await draftOutreachEmail(business, fit.suggested_offer);

  const saved = await createDraft({
    business_id,
    subject: drafted.subject,
    body: drafted.body,
    offer_angle: drafted.offer_angle,
  });

  return NextResponse.json({ draft: saved });
}
