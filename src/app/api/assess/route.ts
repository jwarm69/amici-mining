import { NextRequest, NextResponse } from "next/server";
import { getBusiness, upsertAssessment } from "@/lib/db";
import { fetchSiteSignals, judgeWithClaude, combineScore, computePitchPriority } from "@/lib/web-quality";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";
export const maxDuration = 60;

export async function POST(req: NextRequest) {
  const { business_id } = await req.json();
  if (!business_id) return NextResponse.json({ error: "business_id required" }, { status: 400 });

  const business = await getBusiness(business_id);
  if (!business) return NextResponse.json({ error: "business not found" }, { status: 404 });

  if (!business.website) {
    const a = await upsertAssessment({
      business_id, website_url: null,
      reachable: false, https: false, response_ms: null, has_viewport: false,
      copyright_year: null, tech_stack: null, is_placeholder: false,
      quality_score: 0,
      pitch_priority: computePitchPriority(business.fit_score, 0, business.category),
      issues_json: JSON.stringify(["No website on file"]),
      pitch_summary: "No web presence — clean slate to build something simple and effective.",
      jack_status: "assessed", jack_notes: "", jack_last_contacted: null,
      assessed_at: new Date().toISOString(),
    });
    return NextResponse.json({ assessment: a });
  }

  const signals = await fetchSiteSignals(business.website);
  const { verdict } = await judgeWithClaude({
    business_name: business.name, category: business.category,
    website_url: business.website, signals,
  });
  const finalScore = combineScore(signals, verdict);
  const priority = computePitchPriority(business.fit_score, finalScore, business.category);

  const assessment = await upsertAssessment({
    business_id,
    website_url: business.website,
    reachable: signals.reachable,
    https: signals.https,
    response_ms: signals.response_ms,
    has_viewport: signals.has_viewport,
    copyright_year: signals.copyright_year,
    tech_stack: signals.tech_stack,
    is_placeholder: signals.is_placeholder,
    quality_score: finalScore,
    pitch_priority: priority,
    issues_json: JSON.stringify(verdict.issues),
    pitch_summary: verdict.pitch_summary,
    jack_status: "assessed",
    jack_notes: "",
    jack_last_contacted: null,
    assessed_at: new Date().toISOString(),
  });

  return NextResponse.json({ assessment });
}
