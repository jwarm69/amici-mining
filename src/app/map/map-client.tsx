"use client";

import dynamic from "next/dynamic";
import type { Business } from "@/lib/db";

const Map = dynamic(() => import("./map-impl"), {
  ssr: false,
  loading: () => (
    <div className="h-[70vh] grid place-items-center text-[var(--color-muted)]">Loading map…</div>
  ),
});

export function MapClient({ businesses }: { businesses: Business[] }) {
  return (
    <div className="space-y-3">
      <div className="text-sm text-[var(--color-muted)]">
        {businesses.length} prospects in the Amici target zone (Rybovich → Forest Hill, east of Olive)
      </div>
      <div className="rounded-lg border border-[var(--color-border)] bg-[var(--color-card)] overflow-hidden h-[70vh]">
        <Map businesses={businesses} />
      </div>
    </div>
  );
}
