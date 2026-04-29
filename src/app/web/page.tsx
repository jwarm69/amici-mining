import { listBusinessesWithAssessments } from "@/lib/db";
import { WebClient } from "./web-client";

export const dynamic = "force-dynamic";

export default async function WebPage() {
  if (!process.env.TURSO_DATABASE_URL) {
    return <div className="p-4">TURSO_DATABASE_URL not set.</div>;
  }
  const rows = await listBusinessesWithAssessments();
  return <WebClient initialRows={rows} />;
}
