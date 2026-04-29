"use client";

import { MapContainer, TileLayer, CircleMarker, Popup, Polygon } from "react-leaflet";
import type { Business } from "@/lib/db";
import { AMICI_ZONE, AMICI_ZONE_CENTER } from "@/lib/geo";
import { colorForCategory, labelForCategory } from "@/lib/scoring";

export default function Map({ businesses }: { businesses: Business[] }) {
  return (
    <MapContainer
      center={AMICI_ZONE_CENTER}
      zoom={14}
      style={{ height: "100%", width: "100%" }}
      scrollWheelZoom
    >
      <TileLayer
        url="https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png"
        attribution='&copy; <a href="https://openstreetmap.org">OpenStreetMap</a>'
      />
      <Polygon
        positions={AMICI_ZONE}
        pathOptions={{ color: "#8B2E20", weight: 2, fillOpacity: 0.04, dashArray: "4 4" }}
      />
      {businesses
        .filter((b) => b.lat != null && b.lng != null)
        .map((b) => (
          <CircleMarker
            key={b.id}
            center={[b.lat as number, b.lng as number]}
            radius={Math.max(5, Math.min(14, b.fit_score / 7))}
            pathOptions={{
              color: colorForCategory(b.category),
              fillColor: colorForCategory(b.category),
              fillOpacity: 0.7,
              weight: 1,
            }}
          >
            <Popup>
              <div className="text-xs">
                <div className="font-semibold text-sm">{b.name}</div>
                <div className="text-gray-500">{labelForCategory(b.category)} · fit {b.fit_score}</div>
                {b.address && <div className="mt-1">{b.address}</div>}
                {b.website && (
                  <a
                    href={b.website}
                    target="_blank"
                    rel="noreferrer"
                    className="block mt-1 text-blue-600 underline truncate"
                  >
                    {b.website.replace(/^https?:\/\//, "")}
                  </a>
                )}
                {b.phone && <div>{b.phone}</div>}
              </div>
            </Popup>
          </CircleMarker>
        ))}
    </MapContainer>
  );
}
