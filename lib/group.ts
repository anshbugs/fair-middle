import { groupOptions, newId, store } from "./db";
import type { SolveDeps } from "./solver/solve";
import { solve } from "./solver/solve";
import { isSolving, type GroupRow } from "./store";
import { hashToken, newToken, tokenMatches } from "./tokens";
import { venueKey, type Participant, type PublicGroup, type SolveOptions, type SolveResult } from "./types";

/**
 * Group lifecycle for the account-free flow:
 *   organiser creates a link → friends join with their own start → every join re-solves in the
 *   background → friends vote on the top venues → organiser confirms → share card.
 * All coordination state (solve lock, dirty flag) lives in the store, so it works across
 * serverless instances.
 */
export class GroupError extends Error {
  constructor(message: string, public status = 400) { super(message); }
}

export type Cookies = { organiser?: string; participant?: string };

export async function createGroup(options: SolveOptions, title?: string): Promise<{ id: string; organiserToken: string }> {
  const s = await store();
  const organiserToken = newToken();
  const id = await s.insertGroup({ options, title, organiserHash: hashToken(organiserToken) });
  await s.logEvent(id, "group.created", { objective: options.objective });
  return { id, organiserToken };
}

/** Quick mode: the organiser enters everyone at once and the solve runs inline. */
export async function createSolvedGroup(options: SolveOptions, participants: Participant[], deps: SolveDeps): Promise<{ id: string; organiserToken: string; result: SolveResult }> {
  const result = await solve(participants, options, deps);
  const s = await store();
  const { id, organiserToken } = await createGroup(options);
  for (const p of participants) await s.insertParticipant(id, p);
  await s.insertResult(id, result);
  await s.logEvent(id, "solve.ok", { elements: result.elements, participants: participants.length });
  return { id, organiserToken, result };
}

async function requireGroup(id: string): Promise<GroupRow> {
  const g = await (await store()).liveGroup(id);
  if (!g) throw new GroupError("This plan has expired or does not exist.", 404);
  return g;
}

/**
 * Add this browser's participant, or update it if they already joined. Returns their token and a
 * promise for the background re-solve, which the caller should keep alive (`after()` on Vercel).
 */
export async function join(id: string, person: Omit<Participant, "id">, cookies: Cookies, deps: SolveDeps): Promise<{ participantId: string; token: string; recompute: Promise<void> }> {
  const s = await store();
  const g = await requireGroup(id);
  if (g.status === "confirmed") throw new GroupError("This plan is already confirmed.");
  const existing = await s.privateParticipants(id);
  const [pid, tok] = cookies.participant?.split(".") ?? [];
  const mine = pid && tok ? existing.find((p) => p.id === pid && tokenMatches(tok, p.tokenHash)) : undefined;
  let participantId: string, token: string;
  if (mine) {
    participantId = mine.id; token = tok;
    await s.updateParticipant(id, { ...person, id: participantId });
    await s.logEvent(id, "participant.updated", { participantId });
  } else {
    if (existing.length >= 8) throw new GroupError("This plan already has 8 people.");
    participantId = newId(6); token = newToken();
    await s.insertParticipant(id, { ...person, id: participantId }, hashToken(token));
    await s.logEvent(id, "participant.joined", { participantId, mode: person.mode });
  }
  return { participantId, token, recompute: recompute(id, deps) };
}

/**
 * Re-solve now if nobody else is; otherwise mark the group dirty so the running solve goes once
 * more with the latest roster. Resolves when this instance's work is done.
 */
export async function recompute(id: string, deps: SolveDeps): Promise<void> {
  const s = await store();
  const people = await s.privateParticipants(id);
  if (people.length < 2) return;
  if (!(await s.claimSolve(id))) return;
  try {
    const g = await requireGroup(id);
    const result = await solve(people, groupOptions(g), deps);
    await s.insertResult(id, result);
    await s.logEvent(id, "solve.ok", { elements: result.elements, participants: people.length });
  } catch (e) {
    await s.logEvent(id, "solve.failed", { message: e instanceof Error ? e.message : String(e) });
  } finally {
    if (await s.releaseSolve(id)) await recompute(id, deps);
  }
}

export async function vote(id: string, key: string, cookies: Cookies): Promise<void> {
  const s = await store();
  const g = await requireGroup(id);
  if (g.status === "confirmed") throw new GroupError("This plan is already confirmed.");
  const me = (await whoAmI(id, cookies)).participantId;
  if (!me) throw new GroupError("Join the plan before voting.", 403);
  const result = await s.latestResult(id);
  if (!result || !result.venues.some((v) => venueKey(v) === key)) throw new GroupError("That place is not on the list any more.");
  await s.setVote(id, me, key);
  await s.logEvent(id, "vote", { participantId: me, key });
}

export async function confirm(id: string, key: string, cookies: Cookies): Promise<void> {
  const s = await store();
  const g = await requireGroup(id);
  if (!tokenMatches(cookies.organiser, g.organiser_hash)) throw new GroupError("Only the organiser can confirm.", 403);
  const result = await s.latestResult(id);
  if (!result || !result.venues.some((v) => venueKey(v) === key)) throw new GroupError("That place is not on the list any more.");
  await s.confirmGroup(id, key);
  await s.logEvent(id, "confirmed", { key });
}

export async function whoAmI(id: string, cookies: Cookies): Promise<PublicGroup["viewer"]> {
  const s = await store();
  const g = await s.liveGroup(id);
  if (!g) return { isOrganiser: false };
  const isOrganiser = tokenMatches(cookies.organiser, g.organiser_hash);
  let participantId: string | undefined;
  if (cookies.participant) {
    const [pid, tok] = cookies.participant.split(".");
    const p = (await s.privateParticipants(id)).find((x) => x.id === pid);
    if (p && tokenMatches(tok, p.tokenHash)) participantId = pid;
  }
  return { isOrganiser, participantId };
}

/** Everything a viewer may see. Never includes coordinates. */
export async function publicView(id: string, cookies: Cookies): Promise<PublicGroup | null> {
  const s = await store();
  const g = await s.liveGroup(id);
  if (!g) return null;
  const [viewer, { tally, byParticipant }, participants, result] = await Promise.all([
    whoAmI(id, cookies), s.voteTally(id), s.privateParticipants(id), s.latestResult(id),
  ]);
  const opts = groupOptions(g);
  return {
    id: g.id,
    title: g.title ?? "",
    createdAt: g.created_at,
    status: g.status,
    objective: opts.objective,
    constraints: opts.constraints ?? {},
    participants: participants.map(({ id, name, mode }) => ({ id, name, mode })),
    result,
    computing: isSolving(g),
    votes: tally,
    confirmedVenueKey: g.confirmed_venue_key ?? undefined,
    viewer,
    myVote: viewer.participantId ? byParticipant[viewer.participantId] : undefined,
  };
}
