import { centroid, haversineKm } from "../geo";
import { nearestStation, stationsNear } from "../metro";
import type { TravelTimeProvider, MatrixResult } from "../providers/travelTime/types";
import type { VenueProvider } from "../providers/venues/types";
import type {
  Constraints, HeatCell, InspectResult, LatLng, Participant, RankedVenue, Score, SolveOptions, SolveResult,
} from "../types";
import { coarseCandidates, fineCandidates, prune } from "./candidates";
import { argbest, better, scoreColumn } from "./objective";

export type SolveDeps = { travel: TravelTimeProvider; venues: VenueProvider };

export class SolveError extends Error {}

type Snapped = LatLng & { name?: string };

/**
 * Participants may travel by different modes, so the matrix is assembled per mode group and the
 * rows are put back in participant order.
 */
async function matrixByMode(travel: TravelTimeProvider, people: Participant[], dests: LatLng[], departAt?: Date) {
  const rows: (number | null)[][] = new Array(people.length);
  let snapped: MatrixResult["snapped"] | undefined;
  let elements = 0;
  const groups = new Map<string, number[]>();
  people.forEach((p, i) => groups.set(p.mode, [...(groups.get(p.mode) ?? []), i]));
  for (const [mode, idx] of groups) {
    const r = await travel.matrix(idx.map((i) => people[i]), dests, { mode: mode as Participant["mode"], departAt });
    idx.forEach((i, j) => (rows[i] = r.durations[j]));
    snapped ??= r.snapped;
    elements += idx.length * dests.length;
  }
  return { durations: rows, snapped: snapped ?? dests.map((d) => ({ ...d })), elements };
}

/**
 * Apply hard constraints to a scored candidate list. Returns the surviving indices and the names
 * of constraints that had to be dropped (in order) to keep at least one candidate.
 */
export function applyConstraints<T extends LatLng>(
  items: T[], scores: (Score | null)[], c: Constraints, relaxable: (keyof Constraints)[] = ["nearMetroM", "maxMinutes"],
): { keep: number[]; relaxed: (keyof Constraints)[] } {
  const relaxed: (keyof Constraints)[] = [];
  const active: Constraints = { ...c };
  for (;;) {
    const keep = items.map((_, k) => k).filter((k) => {
      const s = scores[k];
      if (!s) return false;
      if (active.maxMinutes != null && s.worst > active.maxMinutes * 60) return false;
      if (active.nearMetroM != null) {
        const m = nearestStation(items[k]);
        if (!m || m.distM > active.nearMetroM) return false;
      }
      return true;
    });
    if (keep.length) return { keep, relaxed };
    const next = relaxable.find((r) => active[r] != null);
    if (!next) return { keep: [], relaxed };
    delete active[next];
    relaxed.push(next);
  }
}

function pickBest(scores: (Score | null)[], keep: number[], items: LatLng[], preferMetro: boolean): number {
  let best = -1;
  for (const k of keep) {
    const s = scores[k]!;
    if (best < 0) { best = k; continue; }
    const b = scores[best]!;
    if (better(s, b)) best = k;
    else if (preferMetro && s.key === b.key && s.total === b.total) {
      const dm = nearestStation(items[k])?.distM ?? Infinity, db = nearestStation(items[best])?.distM ?? Infinity;
      if (dm < db) best = k;
    }
  }
  return best;
}

export async function solve(participants: Participant[], opts: SolveOptions, deps: SolveDeps): Promise<SolveResult> {
  if (participants.length < 2) throw new SolveError("Add at least two people with locations.");
  if (participants.length > 8) throw new SolveError("Up to 8 people are supported.");
  const { objective } = opts;
  const constraints: Constraints = { ...(opts.constraints ?? {}) };
  const departAt = opts.departAt ? new Date(opts.departAt) : undefined;
  const anyTransit = participants.some((p) => p.mode === "transit");
  const preferMetro = anyTransit || constraints.nearMetroM != null;
  const heat: HeatCell[] = [];
  const relaxedAll = new Set<keyof Constraints>();
  let elements = 0;

  // Pass 1: coarse grid + geographic centroid. Hard constraints are not applied here so the
  // heatmap shows the whole picture; they shape the choice from pass 2 on.
  const c = centroid(participants);
  const cand1 = [...prune(participants, coarseCandidates(participants)), c];
  const m1 = await matrixByMode(deps.travel, participants, cand1, departAt);
  elements += m1.elements;
  const s1 = cand1.map((_, k) => scoreColumn(m1.durations, k, objective));
  const centroidScore = s1[cand1.length - 1];
  const b1 = argbest(s1);
  if (b1 < 0) throw new SolveError("No reachable meeting point. Check that every start is on the road network.");
  m1.snapped.forEach((p, k) => { const s = s1[k]; if (s) heat.push({ lat: p.lat, lon: p.lon, worst: s.worst, key: s.key, pass: 1 }); });

  // Pass 2: fine grid around the winner, plus nearby metro stations when transit or metro matters.
  const cand2: LatLng[] = fineCandidates(participants, cand1[b1]);
  if (preferMetro) cand2.push(...stationsNear(cand1[b1], 4, 25));
  const m2 = await matrixByMode(deps.travel, participants, cand2, departAt);
  elements += m2.elements;
  const s2 = cand2.map((_, k) => scoreColumn(m2.durations, k, objective));
  m2.snapped.forEach((p, k) => { const s = s2[k]; if (s) heat.push({ lat: p.lat, lon: p.lon, worst: s.worst, key: s.key, pass: 2 }); });

  // Choose the fair point among pass 1 + pass 2 under the constraints.
  const all: Snapped[] = [...m1.snapped, ...m2.snapped];
  const allScores = [...s1, ...s2];
  const { keep, relaxed } = applyConstraints(all, allScores, constraints);
  relaxed.forEach((r) => relaxedAll.add(r));
  const bf = pickBest(allScores, keep, all, preferMetro);
  if (bf < 0) throw new SolveError("No reachable meeting point under these settings.");
  const fair = { pt: { ...all[bf], metro: nearestStation(all[bf]) }, score: allScores[bf]! };

  // Pass 3: real venues near the fair point, re-ranked by door-to-door time under the same constraints.
  let venues: RankedVenue[] = [];
  const found = await deps.venues.near(fair.pt, 1500, 25, constraints.kinds);
  if (found.length) {
    found.sort((a, b) => haversineKm(a, fair.pt) - haversineKm(b, fair.pt));
    const m3 = await matrixByMode(deps.travel, participants, found, departAt);
    elements += m3.elements;
    const s3 = found.map((_, k) => scoreColumn(m3.durations, k, objective));
    const v = applyConstraints(found, s3, constraints);
    v.relaxed.forEach((r) => relaxedAll.add(r));
    venues = v.keep
      .map((k) => ({ ...found[k], metro: nearestStation(found[k]), score: s3[k]! }))
      .sort((a, b) => (better(a.score, b.score) ? -1 : better(b.score, a.score) ? 1 : (a.metro?.distM ?? 0) - (b.metro?.distM ?? 0)))
      .slice(0, 6);
  }

  return {
    objective,
    constraints,
    relaxed: [...relaxedAll],
    departAt: opts.departAt,
    provider: deps.travel.name,
    departureAware: deps.travel.supportsDeparture && !!departAt,
    computedAt: new Date().toISOString(),
    participants: participants.map(({ id, name, mode }) => ({ id, name, mode })),
    fairPoint: fair.pt,
    fairScore: fair.score,
    centroid: c,
    centroidScore,
    venues,
    heat,
    elements,
  };
}

/** "Why not here?": score one arbitrary point for the same group. One matrix column. */
export async function inspect(participants: Participant[], point: LatLng, opts: SolveOptions, deps: Pick<SolveDeps, "travel">): Promise<InspectResult> {
  const m = await matrixByMode(deps.travel, participants, [point], opts.departAt ? new Date(opts.departAt) : undefined);
  const snapped = m.snapped[0] ?? point;
  return {
    point: { ...snapped, metro: nearestStation(snapped) },
    score: scoreColumn(m.durations, 0, opts.objective),
    participants: participants.map(({ id, name, mode }) => ({ id, name, mode })),
  };
}
