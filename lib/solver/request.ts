import { newId } from "../db";
import { MODES, OBJECTIVES, VENUE_KINDS, type Constraints, type Mode, type Objective, type Participant, type SolveOptions, type VenueKind } from "../types";
import { SolveError } from "./solve";

export type SolveBody = {
  objective?: Objective;
  departAt?: string;
  constraints?: { maxMinutes?: number; nearMetroM?: number; kinds?: string[] };
  participants?: { name?: string; lat?: number; lon?: number; mode?: Mode; query?: string }[];
};

/** Validate and normalise a solve request body. Shared by /api/solve and the inspect route. */
export function parseOptions(body: Pick<SolveBody, "objective" | "departAt" | "constraints">): SolveOptions {
  const objective = OBJECTIVES.includes(body.objective as Objective) ? (body.objective as Objective) : "minimax";
  const c: Constraints = {};
  const raw = body.constraints ?? {};
  if (Number.isFinite(raw.maxMinutes) && raw.maxMinutes! >= 5 && raw.maxMinutes! <= 240) c.maxMinutes = Math.round(raw.maxMinutes!);
  if (Number.isFinite(raw.nearMetroM) && raw.nearMetroM! >= 100 && raw.nearMetroM! <= 3000) c.nearMetroM = Math.round(raw.nearMetroM!);
  if (Array.isArray(raw.kinds)) {
    const kinds = raw.kinds.filter((k): k is VenueKind => (VENUE_KINDS as readonly string[]).includes(k));
    if (kinds.length && kinds.length < VENUE_KINDS.length) c.kinds = kinds;
  }
  let departAt: string | undefined;
  if (body.departAt) {
    const d = new Date(body.departAt);
    if (!Number.isNaN(d.getTime()) && Math.abs(d.getTime() - Date.now()) < 14 * 86400000) departAt = d.toISOString();
  }
  return { objective, constraints: c, departAt };
}

export function parseParticipants(body: Pick<SolveBody, "participants">): Participant[] {
  const raw = Array.isArray(body.participants) ? body.participants : [];
  return raw.map((p, i) => {
    const lat = Number(p.lat), lon = Number(p.lon);
    if (!Number.isFinite(lat) || !Number.isFinite(lon) || Math.abs(lat) > 90 || Math.abs(lon) > 180) throw new SolveError(`Person ${i + 1} has no valid location.`);
    return {
      id: newId(6),
      name: String(p.name ?? `Person ${i + 1}`).slice(0, 40) || `Person ${i + 1}`,
      lat, lon,
      mode: MODES.includes(p.mode as Mode) ? (p.mode as Mode) : "drive",
      query: p.query ? String(p.query).slice(0, 200) : undefined,
    };
  });
}
