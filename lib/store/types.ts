import type { GroupStatus, Objective, Participant, SolveOptions, SolveResult, VoteTally } from "../types";

export type GroupRow = {
  id: string;
  created_at: string;
  objective: Objective;
  expires_at: string;
  options: string | null;
  title: string | null;
  status: GroupStatus;
  organiser_hash: string | null;
  confirmed_venue_key: string | null;
  /** ISO time a solve started, or null; stale values (> 2 min) are treated as not solving */
  solving_since: string | null;
  /** 1 when something changed while a solve was running */
  dirty: number;
};

export type StoredParticipant = Participant & { tokenHash: string | null };

/**
 * Everything the app persists. SQLite implements it for local dev and single-box hosts;
 * Postgres (Neon) for serverless. Methods are async so both fit the same shape.
 */
export interface Store {
  readonly name: string;
  insertGroup(opts: { options: SolveOptions; title?: string; organiserHash: string; ttlDays?: number }): Promise<string>;
  liveGroup(id: string): Promise<GroupRow | null>;
  insertParticipant(groupId: string, p: Participant, tokenHash?: string): Promise<void>;
  updateParticipant(groupId: string, p: Participant): Promise<void>;
  privateParticipants(groupId: string): Promise<StoredParticipant[]>;
  insertResult(groupId: string, result: SolveResult): Promise<void>;
  latestResult(groupId: string): Promise<SolveResult | null>;
  /** Atomically claim the solve lock. Returns false if another solve holds it (and marks dirty). */
  claimSolve(groupId: string): Promise<boolean>;
  /** Release the lock; returns true if the group was marked dirty meanwhile (and clears it). */
  releaseSolve(groupId: string): Promise<boolean>;
  setVote(groupId: string, participantId: string, venueKey: string): Promise<void>;
  voteTally(groupId: string): Promise<{ tally: VoteTally; byParticipant: Record<string, string> }>;
  confirmGroup(groupId: string, venueKey: string): Promise<void>;
  logEvent(groupId: string, type: string, payload?: unknown): Promise<void>;
  purgeExpired(): Promise<number>;
}

export const SOLVE_STALE_MS = 2 * 60 * 1000;
export const isSolving = (g: GroupRow) => !!g.solving_since && Date.now() - new Date(g.solving_since).getTime() < SOLVE_STALE_MS;
