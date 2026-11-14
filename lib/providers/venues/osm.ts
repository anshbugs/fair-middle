import { haversineKm } from "../../geo";
import type { LatLng, Venue } from "../../types";
import { VENUE_KINDS, type VenueProvider } from "./types";

const UA = process.env.APP_USER_AGENT ?? "fair-middle/0.1 (meet-in-the-middle by travel time)";

async function getJson<T>(url: string, timeoutMs: number): Promise<T> {
  const r = await fetch(url, { headers: { "User-Agent": UA, Accept: "application/json" }, signal: AbortSignal.timeout(timeoutMs) });
  if (!r.ok) throw new Error(`HTTP ${r.status}`);
  return (await r.json()) as T;
}

/** Overpass: best coverage, but public servers are often at capacity. */
export class OverpassVenues implements VenueProvider {
  readonly name = "overpass";
  constructor(private base = process.env.OVERPASS_URL ?? "https://overpass-api.de/api/interpreter") {}
  async near(pt: LatLng, radiusM: number, limit: number): Promise<Venue[]> {
    const re = `^(${VENUE_KINDS.join("|")})$`;
    const q = `[out:json][timeout:8];(node(around:${radiusM},${pt.lat},${pt.lon})["amenity"~"${re}"]["name"];way(around:${radiusM},${pt.lat},${pt.lon})["amenity"~"${re}"]["name"];);out center ${limit * 2};`;
    type El = { lat?: number; lon?: number; center?: { lat: number; lon: number }; tags: { name: string; amenity: string } };
    const j = await getJson<{ elements: El[] }>(`${this.base}?data=${encodeURIComponent(q)}`, 9000);
    return j.elements
      .map((e) => ({ name: e.tags.name, kind: e.tags.amenity.replace("_", " "), lat: e.lat ?? e.center?.lat, lon: e.lon ?? e.center?.lon }))
      .filter((v): v is Venue => v.lat != null && v.lon != null);
  }
}

/** Nominatim bounded search: reliable, limited to 1 request per second. */
export class NominatimVenues implements VenueProvider {
  readonly name = "nominatim";
  async near(pt: LatLng, radiusM: number, limit: number): Promise<Venue[]> {
    const d = radiusM / 111000;
    const box = `${pt.lon - d},${pt.lat + d},${pt.lon + d},${pt.lat - d}`;
    const out: Venue[] = [];
    for (const kind of ["cafe", "restaurant"]) {
      type Row = { lat: string; lon: string; name?: string; display_name: string; type: string };
      const j = await getJson<Row[]>(`https://nominatim.openstreetmap.org/search?q=${kind}&format=json&viewbox=${box}&bounded=1&limit=${Math.min(limit, 40)}`, 8000);
      j.forEach((x) => out.push({ name: x.name || x.display_name.split(",")[0], kind: x.type.replace("_", " "), lat: +x.lat, lon: +x.lon }));
      await new Promise((r) => setTimeout(r, 1100));
    }
    return out;
  }
}

/** Photon (komoot): fast, relevance-ranked, so results are distance-filtered here. */
export class PhotonVenues implements VenueProvider {
  readonly name = "photon";
  async near(pt: LatLng, radiusM: number, limit: number): Promise<Venue[]> {
    const out: Venue[] = [];
    for (const kind of ["cafe", "restaurant"]) {
      type F = { properties: { name?: string }; geometry: { coordinates: [number, number] } };
      const j = await getJson<{ features: F[] }>(`https://photon.komoot.io/api/?q=${kind}&lat=${pt.lat}&lon=${pt.lon}&limit=${limit}&osm_tag=amenity:${kind}`, 8000);
      j.features.forEach((f) => {
        const v = { name: f.properties.name ?? "", kind, lon: f.geometry.coordinates[0], lat: f.geometry.coordinates[1] };
        if (v.name && haversineKm(v, pt) * 1000 <= radiusM * 2) out.push(v);
      });
    }
    return out;
  }
}

/** Tries each provider in order; first non-empty answer wins. */
export class VenueChain implements VenueProvider {
  readonly name: string;
  constructor(private providers: VenueProvider[]) { this.name = providers.map((p) => p.name).join(">"); }
  async near(pt: LatLng, radiusM: number, limit: number): Promise<Venue[]> {
    for (const p of this.providers) {
      try {
        const v = await p.near(pt, radiusM, limit);
        if (v.length) return dedupe(v).slice(0, limit);
      } catch { /* next provider */ }
    }
    return [];
  }
}

function dedupe(vs: Venue[]): Venue[] {
  const seen = new Set<string>();
  return vs.filter((v) => { const k = `${v.name.toLowerCase()}|${v.lat.toFixed(3)}|${v.lon.toFixed(3)}`; if (seen.has(k)) return false; seen.add(k); return true; });
}
