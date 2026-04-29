import { NextRequest, NextResponse } from "next/server";
import { deleteBusiness, getBusiness, updateBusiness } from "@/lib/db";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function GET(_req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const business = await getBusiness(id);
  if (!business) return NextResponse.json({ error: "not found" }, { status: 404 });
  return NextResponse.json({ business });
}

export async function PATCH(req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const updates = await req.json();
  const updated = await updateBusiness(id, updates);
  return NextResponse.json({ business: updated });
}

export async function DELETE(_req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  await deleteBusiness(id);
  return NextResponse.json({ ok: true });
}
