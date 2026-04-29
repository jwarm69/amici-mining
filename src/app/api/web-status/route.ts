import { NextRequest, NextResponse } from "next/server";
import { updateAssessment } from "@/lib/db";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function PATCH(req: NextRequest) {
  const { business_id, ...updates } = await req.json();
  if (!business_id) return NextResponse.json({ error: "business_id required" }, { status: 400 });
  const updated = await updateAssessment(business_id, updates);
  return NextResponse.json({ assessment: updated });
}
