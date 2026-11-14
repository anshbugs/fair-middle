import type { LatLng } from "./types";

const R = 6371; // km

export function haversineKm(a: LatLng, b: LatLng): number {
  const dLat = ((b.lat - a.lat) * Math.PI) / 180;
  const dLon = ((b.lon - a.lon) * Math.PI) / 180;
  const x =
    Math.sin(dLat / 2) ** 2 +
    Math.cos((a.lat * Math.PI) / 180) * Math.cos((b.lat * Math.PI) / 180) * Math.sin(dLon / 2) ** 2;
  return 2 * R * Math.asin(Math.sqrt(x));
}

export type BBox = { la1: number; la2: number; lo1: number; lo2: number };

/** Bounding box of the points, padded, with a minimum span so tight groups still get a grid. */
export function bbox(pts: LatLng[], pad = 0.25, minSpan = 0.06): BBox {
  const lats = pts.map((p) => p.lat);
  const lons = pts.map((p) => p.lon);
  const la1 = Math.min(...lats), la2 = Math.max(...lats);
  const lo1 = Math.min(...lons), lo2 = Math.max(...lons);
  const dla = Math.max(la2 - la1, minSpan);
  const dlo = Math.max(lo2 - lo1, minSpan);
  const cla = (la1 + la2) / 2, clo = (lo1 + lo2) / 2;
  return {
    la1: cla - (dla / 2) * (1 + pad),
    la2: cla + (dla / 2) * (1 + pad),
    lo1: clo - (dlo / 2) * (1 + pad),
    lo2: clo + (dlo / 2) * (1 + pad),
  };
}

export function grid(b: BBox, n: number): LatLng[] {
  const out: LatLng[] = [];
  for (let i = 0; i < n; i++)
    for (let j = 0; j < n; j++)
      out.push({
        lat: b.la1 + ((b.la2 - b.la1) * i) / (n - 1),
        lon: b.lo1 + ((b.lo2 - b.lo1) * j) / (n - 1),
      });
  return out;
}

export function centroid(pts: LatLng[]): LatLng {
  return {
    lat: pts.reduce((s, p) => s + p.lat, 0) / pts.length,
    lon: pts.reduce((s, p) => s + p.lon, 0) / pts.length,
  };
}

/** Round to ~11 m so nearby requests share cache keys. */
export function roundKey(p: LatLng, decimals = 4): string {
  return `${p.lat.toFixed(decimals)},${p.lon.toFixed(decimals)}`;
}
