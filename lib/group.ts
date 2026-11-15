import {
  confirmGroup, groupOptions, insertGroup, insertParticipant, insertResult, latestResult, liveGroup, logEvent,
  newId, privateParticipants, setVote, updateParticipant, voteTally, type GroupRow,
} from "./db";
import type { SolveDeps } from "./solver/solve";
import { solve } from "./solver/solve";
import { hashToken, newToken, tokenMatches } from "./tokens";
import { venueKey, type Participant, type PublicGroup, type SolveOptions, type SolveResult } from "./types";

/**
 * Group lifecycle for the account-free flow:
 *   organiser creates a link → friends join with their own start → every join re-solves in the
 *   background → friends vote on the top venues → organiser confirms → share card.
 */
export class GroupError extends Error {
  constructor(message: string, public status = 400) { super(message); }
}

export type Cookies = { organiser?: string; participant?: string };

const computing = new Set<string>();
/** Groups that changed while a solve was running and need one more pass. */
const dirty = new Set<string>();
export const isComputing = (id: string) => computing.has(id);

export function createGroup(options: SolveOptions, title?: string): { id: string; organiserToken: string } {
  const organiserToken = newToken();
  const id = insertGroup({ options, title, organiserHash: hashToken(organiserToken) });
  logEvent(id, "group.created", { objective: options.objective });
  return { id, organiserToken };
}

/** Quick mode: the organiser enters everyone at once and the solve runs inline. */
export async function createSolvedGroup(options: SolveOptions, participants: Participant[], deps: SolveDeps): Promise<{ id: string; organiserToken: string; result: SolveResult }> {
  const result = await solve(participants, options, deps);
  const { id, organiserToken } = createGroup(options);
  for (const p of participants) insertParticipant(id, p);
  insertResult(id, result);
  logEvent(id, "solve.ok", { elements: result.elements, participants: participants.length });
  return { id, organiserToken, result };
}

function requireGroup(id: string): GroupRow {
  const g = liveGroup(id);
  if (!g) throw new GroupError("This plan has expired or does not exist.", 404);
  return g;
}

/** Add this browser's participant, or update it if they already joined. Returns their token. */
export async function join(id: string, person: Omit<Participant, "id">, cookies: Cookies, deps: SolveDeps): Promise<{ participantId: string; token: string }> {
  const g = requireGroup(id);
  if (g.status === "confirmed") throw new GroupError("This plan is already confirmed.");
  const existing = privateParticipants(id);
  const mine = cookies.participant ? existing.find((p) => tokenMatches(cookies.participant!.split(".")[1], p.tokenHash) && p.id === cookies.participant!.split(".")[0]) : undefined;
  let participantId: string, token: string;
  if (mine) {
    participantId = mine.id; token = cookies.participant!.split(".")[1];
    updateParticipant(id, { ...person, id: participantId });
    logEvent(id, "participant.updated", { participantId });
  } else {
    if (existing.length >= 8) throw new GroupError("This plan already has 8 people.");
    participantId = newId(6); token = newToken();
    insertParticipant(id, { ...person, id: participantId }, hashToken(token));
    logEvent(id, "participant.joined", { participantId, mode: person.mode });
  }
  scheduleRecompute(id, deps);
  return { participantId, token };
}

/** Re-solve in the background; concurrent requests for the same group coalesce. */
export function scheduleRecompute(id: string, deps: SolveDeps): boolean {
  if (computing.has(id)) { dirty.add(id); return false; }
  const people = privateParticipants(id);
  if (people.length < 2) return false;
  computing.add(id);
  dirty.delete(id);
  void (async () => {
    try {
      const g = requireGroup(id);
      const result = await solve(people, groupOptions(g), deps);
      insertResult(id, result);
      logEvent(id, "solve.ok", { elements: result.elements, participants: people.length });
    } catch (e) {
      logEvent(id, "solve.failed", { message: e instanceof Error ? e.message : String(e) });
    } finally {
      computing.delete(id);
      // Someone joined or changed while we were solving: go again with the latest roster.
      if (dirty.has(id)) scheduleRecompute(id, deps);
    }
  })();
  return true;
}

export function vote(id: string, key: string, cookies: Cookies): void {
  const g = requireGroup(id);
  if (g.status === "confirmed") throw new GroupError("This plan is already confirmed.");
  const me = whoAmI(id, cookies).participantId;
  if (!me) throw new GroupError("Join the plan before voting.", 403);
  const result = latestResult(id);
  if (!result || !result.venues.some((v) => venueKey(v) === key)) throw new GroupError("That place is not on the list any more.");
  setVote(id, me, key);
  logEvent(id, "vote", { participantId: me, key });
}

export function confirm(id: string, key: string, cookies: Cookies): void {
  const g = requireGroup(id);
  if (!tokenMatches(cookies.organiser, g.organiser_hash)) throw new GroupError("Only the organiser can confirm.", 403);
  const result = latestResult(id);
  if (!result || !result.venues.some((v) => venueKey(v) === key)) throw new GroupError("That place is not on the list any more.");
  confirmGroup(id, key);
  logEvent(id, "confirmed", { key });
}

export function whoAmI(id: string, cookies: Cookies): PublicGroup["viewer"] {
  const g = liveGroup(id);
  if (!g) return { isOrganiser: false };
  const isOrganiser = tokenMatches(cookies.organiser, g.organiser_hash);
  let participantId: string | undefined;
  if (cookies.participant) {
    const [pid, tok] = cookies.participant.split(".");
    const p = privateParticipants(id).find((x) => x.id === pid);
    if (p && tokenMatches(tok, p.tokenHash)) participantId = pid;
  }
  return { isOrganiser, participantId };
}

/** Everything a viewer may see. Never includes coordinates. */
export function publicView(id: string, cookies: Cookies): PublicGroup | null {
  const g = liveGroup(id);
  if (!g) return null;
  const viewer = whoAmI(id, cookies);
  const { tally, byParticipant } = voteTally(id);
  const opts = groupOptions(g);
  return {
    id: g.id,
    title: g.title ?? "",
    createdAt: g.created_at,
    status: g.status,
    objective: opts.objective,
    constraints: opts.constraints ?? {},
    participants: privateParticipants(id).map(({ id, name, mode }) => ({ id, name, mode })),
    result: latestResult(id),
    computing: computing.has(id),
    votes: tally,
    confirmedVenueKey: g.confirmed_venue_key ?? undefined,
    viewer,
    myVote: viewer.participantId ? byParticipant[viewer.participantId] : undefined,
  };
}
