// Amici target zone: Rybovich Marina (north) → Forest Hill Blvd (south),
// east of Olive Ave (west bound), Intracoastal (east bound).
// Coordinates approximated from West Palm Beach street grid.
//
// Polygon is ordered clockwise starting NW. Last point should NOT repeat the first
// (we close it implicitly in pointInPolygon).
export const AMICI_ZONE: [number, number][] = [
  [26.7720, -80.0560], // NW: Rybovich area at Olive Ave
  [26.7720, -80.0440], // NE: Rybovich Marina shoreline (Intracoastal)
  [26.6760, -80.0410], // SE: Forest Hill Blvd at Intracoastal
  [26.6760, -80.0560], // SW: Forest Hill at Olive Ave
];

export const AMICI_ZONE_CENTER: [number, number] = [26.7240, -80.0490];

// Ray-casting point-in-polygon. Polygon vertices are [lat, lng].
export function pointInPolygon(point: [number, number], polygon: [number, number][]): boolean {
  const [lat, lng] = point;
  let inside = false;
  for (let i = 0, j = polygon.length - 1; i < polygon.length; j = i++) {
    const [latI, lngI] = polygon[i];
    const [latJ, lngJ] = polygon[j];
    const intersect =
      (lngI > lng) !== (lngJ > lng) &&
      lat < ((latJ - latI) * (lng - lngI)) / (lngJ - lngI) + latI;
    if (intersect) inside = !inside;
  }
  return inside;
}

// Generate a hex-grid of search circles covering the polygon's bounding box.
// Google Places Nearby Search has a 50km radius limit but degrades after ~5km.
// We use 600m circles spaced 900m apart so circles overlap and we don't miss
// businesses on the boundary between two cells.
export function gridForPolygon(
  polygon: [number, number][],
  radiusMeters = 600,
  stepMeters = 900
): { lat: number; lng: number; radius: number }[] {
  const lats = polygon.map((p) => p[0]);
  const lngs = polygon.map((p) => p[1]);
  const minLat = Math.min(...lats);
  const maxLat = Math.max(...lats);
  const minLng = Math.min(...lngs);
  const maxLng = Math.max(...lngs);

  // ~111,320m per degree of latitude. Longitude varies with cos(lat).
  const metersPerDegLat = 111320;
  const centerLat = (minLat + maxLat) / 2;
  const metersPerDegLng = 111320 * Math.cos((centerLat * Math.PI) / 180);

  const stepLat = stepMeters / metersPerDegLat;
  const stepLng = stepMeters / metersPerDegLng;

  const cells: { lat: number; lng: number; radius: number }[] = [];
  for (let lat = minLat; lat <= maxLat; lat += stepLat) {
    for (let lng = minLng; lng <= maxLng; lng += stepLng) {
      // Only emit the cell if its center is inside the polygon, OR within one step
      // of the polygon edge (so we don't drop businesses near the boundary).
      if (
        pointInPolygon([lat, lng], polygon) ||
        pointInPolygon([lat + stepLat / 2, lng], polygon) ||
        pointInPolygon([lat - stepLat / 2, lng], polygon) ||
        pointInPolygon([lat, lng + stepLng / 2], polygon) ||
        pointInPolygon([lat, lng - stepLng / 2], polygon)
      ) {
        cells.push({ lat, lng, radius: radiusMeters });
      }
    }
  }
  return cells;
}

export function isInAmiciZone(lat: number, lng: number): boolean {
  return pointInPolygon([lat, lng], AMICI_ZONE);
}

// Rectangular bounding box of the polygon, used by searchText (which doesn't accept polygons).
export function polygonBounds(polygon: [number, number][]): {
  low: { lat: number; lng: number };
  high: { lat: number; lng: number };
} {
  const lats = polygon.map((p) => p[0]);
  const lngs = polygon.map((p) => p[1]);
  return {
    low: { lat: Math.min(...lats), lng: Math.min(...lngs) },
    high: { lat: Math.max(...lats), lng: Math.max(...lngs) },
  };
}

// Density-aware grid: smaller cells south of `densityLatBoundary` (downtown WPB / Worth Ave),
// larger cells north (Rybovich / Northwood / residential). Per-type calls + smaller cells in
// dense areas means we don't lose results to the 20/call cap.
//
// For the Amici zone, 26.7100 sits roughly at the line where downtown/Worth Ave density gives
// way to lower-density Northwood/SoSo. Tune if the zone changes.
export function gridDensityAware(
  polygon: [number, number][],
  densityLatBoundary = 26.7100,
): { lat: number; lng: number; radius: number }[] {
  const lats = polygon.map((p) => p[0]);
  const lngs = polygon.map((p) => p[1]);
  const minLat = Math.min(...lats);
  const maxLat = Math.max(...lats);
  const minLng = Math.min(...lngs);
  const maxLng = Math.max(...lngs);
  const metersPerDegLat = 111320;
  const centerLat = (minLat + maxLat) / 2;
  const metersPerDegLng = 111320 * Math.cos((centerLat * Math.PI) / 180);

  const cells: { lat: number; lng: number; radius: number }[] = [];
  const bands: Array<{ from: number; to: number; step: number; radius: number }> = [
    // South: downtown WPB + Worth Ave / Palm Beach (high density)
    { from: minLat, to: Math.min(densityLatBoundary, maxLat), step: 600, radius: 400 },
    // North: Northwood / Rybovich (lower density)
    { from: Math.min(densityLatBoundary, maxLat), to: maxLat, step: 900, radius: 600 },
  ];

  for (const band of bands) {
    if (band.from >= band.to) continue;
    const stepLat = band.step / metersPerDegLat;
    const stepLng = band.step / metersPerDegLng;
    for (let lat = band.from; lat <= band.to; lat += stepLat) {
      for (let lng = minLng; lng <= maxLng; lng += stepLng) {
        if (
          pointInPolygon([lat, lng], polygon) ||
          pointInPolygon([lat + stepLat / 2, lng], polygon) ||
          pointInPolygon([lat - stepLat / 2, lng], polygon) ||
          pointInPolygon([lat, lng + stepLng / 2], polygon) ||
          pointInPolygon([lat, lng - stepLng / 2], polygon)
        ) {
          cells.push({ lat, lng, radius: band.radius });
        }
      }
    }
  }
  return cells;
}
