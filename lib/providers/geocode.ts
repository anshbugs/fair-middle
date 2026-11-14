import type { Cache } from "../cache/types";
import type { LatLng } from "../types";

export type GeocodeHit = LatLng & { label: string };

const UA = process.env.APP_USER_AGENT ?? "fair-middle/0.1 (meet-in-the-middle by travel time)";

export async function geocode(q: string, cache: Cache): Promise<GeocodeHit | null> {
  const norm = q.trim().toLowerCase().replace(/\s+/g, " ");
  if (!norm) return null;
  const key = `geo:${norm}`;
  const hit = await cache.get<GeocodeHit | null>(key);
  if (hit !== undefined) return hit;
  type Row = { lat: string; lon: string; display_name: string };
  const r = await fetch(`https://nominatim.openstreetmap.org/search?format=json&limit=1&q=${encodeURIComponent(norm)}`, {
    headers: { "User-Agent": UA }, signal: AbortSignal.timeout(8000),
  });
  if (!r.ok) throw new Error(`Geocoder returned ${r.status}`);
  const j = (await r.json()) as Row[];
  const out = j.length ? { lat: +j[0].lat, lon: +j[0].lon, label: j[0].display_name.split(",").slice(0, 3).join(",") } : null;
  await cache.set(key, out, 30 * 24 * 3600);
  return out;
}
