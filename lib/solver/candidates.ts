import { bbox, grid, haversineKm } from "../geo";
import type { LatLng } from "../types";

export const COARSE_N = 9;
export const FINE_N = 7;
const V_MAX_KMH = 80; // optimistic road speed used only for lower bounds

export function coarseCandidates(pts: LatLng[]): LatLng[] {
  return grid(bbox(pts), COARSE_N);
}

/** Fine grid: one coarse cell in each direction around the winner, at a quarter of the step. */
export function fineCandidates(pts: LatLng[], around: LatLng): LatLng[] {
  const b = bbox(pts);
  const dla = (b.la2 - b.la1) / (COARSE_N - 1);
  const dlo = (b.lo2 - b.lo1) / (COARSE_N - 1);
  return grid(
    { la1: around.lat - dla, la2: around.lat + dla, lo1: around.lon - dlo, lo2: around.lon + dlo },
    FINE_N,
  );
}

/**
 * Drop candidates whose straight-line lower bound on the worst commute is already far above the
 * best achievable lower bound. Cheap, and removes the corners of the grid before any API call.
 */
export function prune(pts: LatLng[], cands: LatLng[], slack = 1.6): LatLng[] {
  const lb = cands.map((c) => Math.max(...pts.map((p) => haversineKm(p, c))) / V_MAX_KMH);
  const bestLb = Math.min(...lb);
  return cands.filter((_, i) => lb[i] <= bestLb * slack + 0.05);
}
