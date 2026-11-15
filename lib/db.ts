import { randomBytes } from "node:crypto";
import { mkdirSync } from "node:fs";
import path from "node:path";
import { DatabaseSync } from "node:sqlite";
import type { Constraints, GroupStatus, Objective, Participant, SolveOptions, SolveResult, VoteTally } from "./types";

/**
 * SQLite via Node's built-in driver: zero setup locally. The schema mirrors the Postgres one in
 * docs/ARCHITECTURE.md so the swap is a driver change, not a model change.
 * Coordinates are stored but never returned by the public read path.
 */
declare global {
  var __fairMiddleDb: DatabaseSync | undefined;
}

function addColumn(db: DatabaseSync, table: string, col: string, decl: string) {
  const cols = (db.prepare(`PRAGMA table_info(${table})`).all() as { name: string }[]).map((c) => c.name);
  if (!cols.includes(col)) db.exec(`ALTER TABLE ${table} ADD COLUMN ${col} ${decl}`);
}

function open(): DatabaseSync {
  if (globalThis.__fairMiddleDb) return globalThis.__fairMiddleDb;
  const file = process.env.DATABASE_FILE ?? path.join(process.cwd(), "data", "fairmiddle.db");
  if (file !== ":memory:") mkdirSync(path.dirname(file), { recursive: true });
  const db = new DatabaseSync(file);
  db.exec(`
    PRAGMA journal_mode = WAL;
    PRAGMA foreign_keys = ON;
    CREATE TABLE IF NOT EXISTS groups (
      id TEXT PRIMARY KEY, created_at TEXT NOT NULL, objective TEXT NOT NULL, expires_at TEXT NOT NULL
    );
    CREATE TABLE IF NOT EXISTS participants (
      id TEXT PRIMARY KEY, group_id TEXT NOT NULL REFERENCES groups(id) ON DELETE CASCADE,
      display_name TEXT NOT NULL, lat REAL NOT NULL, lon REAL NOT NULL, mode TEXT NOT NULL, query TEXT
    );
    CREATE TABLE IF NOT EXISTS results (
      id TEXT PRIMARY KEY, group_id TEXT NOT NULL REFERENCES groups(id) ON DELETE CASCADE,
      computed_at TEXT NOT NULL, payload TEXT NOT NULL
    );
    CREATE INDEX IF NOT EXISTS results_group ON results(group_id, computed_at DESC);
    CREATE TABLE IF NOT EXISTS votes (
      group_id TEXT NOT NULL REFERENCES groups(id) ON DELETE CASCADE,
      participant_id TEXT NOT NULL REFERENCES participants(id) ON DELETE CASCADE,
      venue_key TEXT NOT NULL, created_at TEXT NOT NULL,
      PRIMARY KEY (group_id, participant_id)
    );
    CREATE TABLE IF NOT EXISTS events (
      id INTEGER PRIMARY KEY AUTOINCREMENT, group_id TEXT NOT NULL, type TEXT NOT NULL, payload TEXT, created_at TEXT NOT NULL
    );
  `);
  // Later-phase columns, added idempotently so existing local databases keep working.
  addColumn(db, "groups", "options", "TEXT");
  addColumn(db, "groups", "title", "TEXT");
  addColumn(db, "groups", "status", "TEXT NOT NULL DEFAULT 'open'");
  addColumn(db, "groups", "organiser_hash", "TEXT");
  addColumn(db, "groups", "confirmed_venue_key", "TEXT");
  addColumn(db, "participants", "token_hash", "TEXT");
  addColumn(db, "participants", "joined_at", "TEXT");
  globalThis.__fairMiddleDb = db;
  return db;
}

export const newId = (bytes = 9) => randomBytes(bytes).toString("base64url");

export type GroupRow = {
  id: string; created_at: string; objective: Objective; expires_at: string; options: string | null;
  title: string | null; status: GroupStatus; organiser_hash: string | null; confirmed_venue_key: string | null;
};
type ParticipantRow = { id: string; display_name: string; lat: number; lon: number; mode: Participant["mode"]; query: string | null; token_hash: string | null };

export function liveGroup(id: string): GroupRow | null {
  const g = open().prepare("SELECT * FROM groups WHERE id = ?").get(id) as GroupRow | undefined;
  if (!g || new Date(g.expires_at) < new Date()) return null;
  return g;
}

export function insertGroup(opts: { options: SolveOptions; title?: string; organiserHash: string; ttlDays?: number }): string {
  const id = newId();
  const now = new Date();
  const exp = new Date(now.getTime() + (opts.ttlDays ?? 7) * 86400000);
  open().prepare("INSERT INTO groups (id, created_at, objective, expires_at, options, title, status, organiser_hash) VALUES (?, ?, ?, ?, ?, ?, 'open', ?)")
    .run(id, now.toISOString(), opts.options.objective, exp.toISOString(), JSON.stringify(opts.options), opts.title ?? null, opts.organiserHash);
  return id;
}

export function insertParticipant(groupId: string, p: Participant, tokenHash?: string) {
  open().prepare("INSERT INTO participants (id, group_id, display_name, lat, lon, mode, query, token_hash, joined_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)")
    .run(p.id, groupId, p.name, p.lat, p.lon, p.mode, p.query ?? null, tokenHash ?? null, new Date().toISOString());
}

export function updateParticipant(groupId: string, p: Participant) {
  open().prepare("UPDATE participants SET display_name = ?, lat = ?, lon = ?, mode = ?, query = ? WHERE id = ? AND group_id = ?")
    .run(p.name, p.lat, p.lon, p.mode, p.query ?? null, p.id, groupId);
}

export function insertResult(groupId: string, result: SolveResult) {
  open().prepare("INSERT INTO results (id, group_id, computed_at, payload) VALUES (?, ?, ?, ?)").run(newId(), groupId, result.computedAt, JSON.stringify(result));
}

export function latestResult(groupId: string): SolveResult | null {
  const r = open().prepare("SELECT payload FROM results WHERE group_id = ? ORDER BY computed_at DESC LIMIT 1").get(groupId) as { payload: string } | undefined;
  return r ? (JSON.parse(r.payload) as SolveResult) : null;
}

/** Server-only: full participants including coordinates. */
export function privateParticipants(groupId: string): (Participant & { tokenHash: string | null })[] {
  const rows = open().prepare("SELECT id, display_name, lat, lon, mode, query, token_hash FROM participants WHERE group_id = ? ORDER BY rowid").all(groupId) as ParticipantRow[];
  return rows.map((p) => ({ id: p.id, name: p.display_name, lat: p.lat, lon: p.lon, mode: p.mode, query: p.query ?? undefined, tokenHash: p.token_hash }));
}

export function groupOptions(g: GroupRow): SolveOptions {
  return g.options ? (JSON.parse(g.options) as SolveOptions) : { objective: g.objective };
}
export const groupConstraints = (g: GroupRow): Constraints => groupOptions(g).constraints ?? {};

export function setVote(groupId: string, participantId: string, venueKey: string) {
  open().prepare("INSERT INTO votes (group_id, participant_id, venue_key, created_at) VALUES (?, ?, ?, ?) ON CONFLICT(group_id, participant_id) DO UPDATE SET venue_key = excluded.venue_key, created_at = excluded.created_at")
    .run(groupId, participantId, venueKey, new Date().toISOString());
}

export function voteTally(groupId: string): { tally: VoteTally; byParticipant: Record<string, string> } {
  const rows = open().prepare("SELECT participant_id, venue_key FROM votes WHERE group_id = ?").all(groupId) as { participant_id: string; venue_key: string }[];
  const tally: VoteTally = {}; const byParticipant: Record<string, string> = {};
  for (const r of rows) { tally[r.venue_key] = (tally[r.venue_key] ?? 0) + 1; byParticipant[r.participant_id] = r.venue_key; }
  return { tally, byParticipant };
}

export function confirmGroup(groupId: string, venueKey: string) {
  open().prepare("UPDATE groups SET status = 'confirmed', confirmed_venue_key = ? WHERE id = ?").run(venueKey, groupId);
}

export function logEvent(groupId: string, type: string, payload?: unknown) {
  open().prepare("INSERT INTO events (group_id, type, payload, created_at) VALUES (?, ?, ?, ?)").run(groupId, type, payload == null ? null : JSON.stringify(payload), new Date().toISOString());
}

/** Housekeeping: delete expired groups (coordinates go with them). */
export function purgeExpired(): number {
  return Number(open().prepare("DELETE FROM groups WHERE expires_at < ?").run(new Date().toISOString()).changes);
}
