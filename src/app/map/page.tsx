import { listBusinesses } from "@/lib/db";
import { MapClient } from "./map-client";

export const dynamic = "force-dynamic";

export default async function MapPage() {
  if (!process.env.TURSO_DATABASE_URL) {
    return <div className="p-4">TURSO_DATABASE_URL not set.</div>;
  }
  const businesses = await listBusinesses();
  return <MapClient businesses={businesses} />;
}
