import type { LatLng, Mode } from "../../types";

export type MatrixOpts = { mode: Mode; departAt?: Date };

export type MatrixResult = {
  /** durations[originIndex][destIndex] in seconds; null when unreachable */
  durations: (number | null)[][];
  /** destinations snapped to the network, with a road name when the provider knows it */
  snapped: (LatLng & { name?: string })[];
};

export interface TravelTimeProvider {
  readonly name: string;
  /** Maximum origins + destinations the provider accepts in one call; the caller chunks above it. */
  readonly maxCoords: number;
  matrix(origins: LatLng[], dests: LatLng[], opts: MatrixOpts): Promise<MatrixResult>;
}

/** Split destinations so each call stays within the provider's coordinate budget. */
export async function chunkedMatrix(
  p: TravelTimeProvider,
  call: (o: LatLng[], d: LatLng[]) => Promise<MatrixResult>,
  origins: LatLng[],
  dests: LatLng[],
): Promise<MatrixResult> {
  const per = Math.max(1, p.maxCoords - origins.length);
  if (dests.length <= per) return call(origins, dests);
  const durations: (number | null)[][] = origins.map(() => []);
  const snapped: MatrixResult["snapped"] = [];
  for (let i = 0; i < dests.length; i += per) {
    const r = await call(origins, dests.slice(i, i + per));
    r.durations.forEach((row, j) => durations[j].push(...row));
    snapped.push(...r.snapped);
  }
  return { durations, snapped };
}
