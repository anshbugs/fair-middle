import { centroid, haversineKm } from "../geo";
import type { TravelTimeProvider, MatrixResult } from "../providers/travelTime/types";
import type { VenueProvider } from "../providers/venues/types";
import type { HeatCell, LatLng, Objective, Participant, RankedVenue, Score, SolveResult } from "../types";
import { coarseCandidates, fineCandidates, prune } from "./candidates";
import { argbest, better, scoreColumn } from "./objective";

export type SolveDeps = { travel: TravelTimeProvider; venues: VenueProvider };

export class SolveError extends Error {}

/**
 * Participants may travel by different modes, so the matrix is assembled per mode group and the
 * rows are put back in participant order.
 */
async function matrixByMode(travel: TravelTimeProvider, people: Participant[], dests: LatLng[]) {
  const rows: (number | null)[][] = new Array(people.length);
  let snapped: MatrixResult["snapped"] | undefined;
  let elements = 0;
  const groups = new Map<string, number[]>();
  people.forEach((p, i) => groups.set(p.mode, [...(groups.get(p.mode) ?? []), i]));
  for (const [mode, idx] of groups) {
    const r = await travel.matrix(idx.map((i) => people[i]), dests, { mode: mode as Participant["mode"] });
    idx.forEach((i, j) => (rows[i] = r.durations[j]));
    snapped ??= r.snapped;
    elements += idx.length * dests.length;
  }
  return { durations: rows, snapped: snapped ?? dests.map((d) => ({ ...d })), elements };
}

export async function solve(participants: Participant[], objective: Objective, deps: SolveDeps): Promise<SolveResult> {
  if (participants.length < 2) throw new SolveError("Add at least two people with locations.");
  if (participants.length > 8) throw new SolveError("Up to 8 people are supported.");
  const heat: HeatCell[] = [];
  let elements = 0;

  // Pass 1: coarse grid + geographic centroid
  const c = centroid(participants);
  const cand1 = [...prune(participants, coarseCandidates(participants)), c];
  const m1 = await matrixByMode(deps.travel, participants, cand1);
  elements += m1.elements;
  const s1 = cand1.map((_, k) => scoreColumn(m1.durations, k, objective));
  const centroidScore = s1[cand1.length - 1];
  const b1 = argbest(s1);
  if (b1 < 0) throw new SolveError("No reachable meeting point. Check that every start is on the road network.");
  m1.snapped.forEach((p, k) => { const s = s1[k]; if (s) heat.push({ lat: p.lat, lon: p.lon, worst: s.worst, key: s.key, pass: 1 }); });

  let fair: { pt: LatLng & { name?: string }; score: Score } = { pt: m1.snapped[b1], score: s1[b1]! };

  // Pass 2: fine grid around the winner
  const cand2 = fineCandidates(participants, cand1[b1]);
  const m2 = await matrixByMode(deps.travel, participants, cand2);
  elements += m2.elements;
  const s2 = cand2.map((_, k) => scoreColumn(m2.durations, k, objective));
  const b2 = argbest(s2);
  if (b2 >= 0 && better(s2[b2]!, fair.score)) fair = { pt: m2.snapped[b2], score: s2[b2]! };
  m2.snapped.forEach((p, k) => { const s = s2[k]; if (s) heat.push({ lat: p.lat, lon: p.lon, worst: s.worst, key: s.key, pass: 2 }); });

  // Pass 3: real venues near the fair point, re-ranked by door-to-door time
  let venues: RankedVenue[] = [];
  const found = await deps.venues.near(fair.pt, 1500, 25);
  if (found.length) {
    found.sort((a, b) => haversineKm(a, fair.pt) - haversineKm(b, fair.pt));
    const m3 = await matrixByMode(deps.travel, participants, found);
    elements += m3.elements;
    venues = found
      .map((v, k) => ({ ...v, score: scoreColumn(m3.durations, k, objective) }))
      .filter((v): v is RankedVenue => v.score != null)
      .sort((a, b) => (better(a.score, b.score) ? -1 : 1))
      .slice(0, 6);
  }

  return {
    objective,
    provider: deps.travel.name,
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
