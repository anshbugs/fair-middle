import stationsJson from "./data/delhi-metro-stations.json";
import { haversineKm } from "./geo";
import type { LatLng, MetroInfo } from "./types";

export type Station = { name: string; lat: number; lon: number };

/**
 * City packs: one static station list per city for now. Phase 5 turns this into a config
 * keyed by the group's bounding box.
 */
const STATIONS: Station[] = (stationsJson as { stations: Station[] }).stations;

export function stations(): Station[] {
  return STATIONS;
}

export function nearestStation(pt: LatLng): MetroInfo | undefined {
  let best: MetroInfo | undefined;
  for (const s of STATIONS) {
    const d = haversineKm(pt, s) * 1000;
    if (!best || d < best.distM) best = { name: s.name, distM: Math.round(d) };
  }
  return best;
}

/** Stations within `radiusKm` of a point, nearest first. */
export function stationsNear(pt: LatLng, radiusKm: number, limit = 30): Station[] {
  return STATIONS.map((s) => ({ s, d: haversineKm(pt, s) }))
    .filter((x) => x.d <= radiusKm)
    .sort((a, b) => a.d - b.d)
    .slice(0, limit)
    .map((x) => x.s);
}
