import { NextRequest, NextResponse } from "next/server";
import { createPitchDraft, getAssessment, getBusiness, updateAssessment } from "@/lib/db";
import { draftPitchEmail } from "@/lib/web-pitch";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";
export const maxDuration = 60;

export async function POST(req: NextRequest) {
  const { business_id } = await req.json();
  if (!business_id) return NextResponse.json({ error: "business_id required" }, { status: 400 });

  const [business, assessment] = await Promise.all([
    getBusiness(business_id),
    getAssessment(business_id),
  ]);
  if (!business) return NextResponse.json({ error: "business not found" }, { status: 404 });
  if (!assessment) return NextResponse.json({ error: "no assessment yet — run /api/assess first" }, { status: 400 });

  const drafted = await draftPitchEmail(business, assessment);
  const saved = await createPitchDraft({
    business_id,
    subject: drafted.subject,
    body: drafted.body,
    teardown: drafted.teardown,
  });
  await updateAssessment(business_id, { jack_status: "pitch_drafted" });

  return NextResponse.json({ draft: saved });
}
