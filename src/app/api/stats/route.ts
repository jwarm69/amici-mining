import { NextResponse } from "next/server";
import { stats } from "@/lib/db";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function GET() {
  const data = await stats();
  return NextResponse.json(data);
}
