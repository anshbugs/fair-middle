import { mkdirSync } from "node:fs";
import os from "node:os";
import path from "node:path";
import { DatabaseSync } from "node:sqlite";
import type { Participant, SolveOptions, SolveResult, VoteTally } from "../types";
import { newId } from "./ids";
import { SOLVE_STALE_MS, type GroupRow, type Store, type StoredParticipant } from "./types";

type ParticipantRow = { id: string; display_name: string; lat: number; lon: number; mode: Participant["mode"]; query: string | null; token_hash: string | null };

function addColumn(db: DatabaseSync, table: string, col: string, decl: string) {
  const cols = (db.prepare(`PRAGMA table_info(${table})`).all() as { name: string }[]).map((c) => c.name);
  if (!cols.includes(col)) db.exec(`ALTER TABLE ${table} ADD COLUMN ${col} ${decl}`);
}

/** Node's built-in SQLite: zero setup for local development and single-server hosts. */
export class SqliteStore implements Store {
  readonly name: string;
  private db: DatabaseSync;

  constructor(file = process.env.DATABASE_FILE ?? (process.env.VERCEL ? path.join(os.tmpdir(), "fairmiddle.db") : path.join(process.cwd(), "data", "fairmiddle.db"))) {
    if (file !== ":memory:") mkdirSync(path.dirname(file), { recursive: true });
    this.name = `sqlite(${file === ":memory:" ? "memory" : path.basename(file)})`;
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
    addColumn(db, "groups", "options", "TEXT");
    addColumn(db, "groups", "title", "TEXT");
    addColumn(db, "groups", "status", "TEXT NOT NULL DEFAULT 'open'");
    addColumn(db, "groups", "organiser_hash", "TEXT");
    addColumn(db, "groups", "confirmed_venue_key", "TEXT");
    addColumn(db, "groups", "solving_since", "TEXT");
    addColumn(db, "groups", "dirty", "INTEGER NOT NULL DEFAULT 0");
    addColumn(db, "participants", "token_hash", "TEXT");
    addColumn(db, "participants", "joined_at", "TEXT");
    this.db = db;
  }

  async insertGroup(opts: { options: SolveOptions; title?: string; organiserHash: string; ttlDays?: number }): Promise<string> {
    const id = newId();
    const now = new Date();
    const exp = new Date(now.getTime() + (opts.ttlDays ?? 7) * 86400000);
    this.db.prepare("INSERT INTO groups (id, created_at, objective, expires_at, options, title, status, organiser_hash) VALUES (?, ?, ?, ?, ?, ?, 'open', ?)")
      .run(id, now.toISOString(), opts.options.objective, exp.toISOString(), JSON.stringify(opts.options), opts.title ?? null, opts.organiserHash);
    return id;
  }

  async liveGroup(id: string): Promise<GroupRow | null> {
    const g = this.db.prepare("SELECT * FROM groups WHERE id = ?").get(id) as GroupRow | undefined;
    if (!g || new Date(g.expires_at) < new Date()) return null;
    return g;
  }

  async insertParticipant(groupId: string, p: Participant, tokenHash?: string) {
    this.db.prepare("INSERT INTO participants (id, group_id, display_name, lat, lon, mode, query, token_hash, joined_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)")
      .run(p.id, groupId, p.name, p.lat, p.lon, p.mode, p.query ?? null, tokenHash ?? null, new Date().toISOString());
  }

  async updateParticipant(groupId: string, p: Participant) {
    this.db.prepare("UPDATE participants SET display_name = ?, lat = ?, lon = ?, mode = ?, query = ? WHERE id = ? AND group_id = ?")
      .run(p.name, p.lat, p.lon, p.mode, p.query ?? null, p.id, groupId);
  }

  async privateParticipants(groupId: string): Promise<StoredParticipant[]> {
    const rows = this.db.prepare("SELECT id, display_name, lat, lon, mode, query, token_hash FROM participants WHERE group_id = ? ORDER BY rowid").all(groupId) as ParticipantRow[];
    return rows.map((p) => ({ id: p.id, name: p.display_name, lat: p.lat, lon: p.lon, mode: p.mode, query: p.query ?? undefined, tokenHash: p.token_hash }));
  }

  async insertResult(groupId: string, result: SolveResult) {
    this.db.prepare("INSERT INTO results (id, group_id, computed_at, payload) VALUES (?, ?, ?, ?)").run(newId(), groupId, result.computedAt, JSON.stringify(result));
  }

  async latestResult(groupId: string): Promise<SolveResult | null> {
    const r = this.db.prepare("SELECT payload FROM results WHERE group_id = ? ORDER BY computed_at DESC LIMIT 1").get(groupId) as { payload: string } | undefined;
    return r ? (JSON.parse(r.payload) as SolveResult) : null;
  }

  async claimSolve(groupId: string): Promise<boolean> {
    const stale = new Date(Date.now() - SOLVE_STALE_MS).toISOString();
    const r = this.db.prepare("UPDATE groups SET solving_since = ?, dirty = 0 WHERE id = ? AND (solving_since IS NULL OR solving_since < ?)").run(new Date().toISOString(), groupId, stale);
    if (Number(r.changes) > 0) return true;
    this.db.prepare("UPDATE groups SET dirty = 1 WHERE id = ?").run(groupId);
    return false;
  }

  async releaseSolve(groupId: string): Promise<boolean> {
    const g = this.db.prepare("SELECT dirty FROM groups WHERE id = ?").get(groupId) as { dirty: number } | undefined;
    this.db.prepare("UPDATE groups SET solving_since = NULL, dirty = 0 WHERE id = ?").run(groupId);
    return !!g && g.dirty === 1;
  }

  async setVote(groupId: string, participantId: string, venueKey: string) {
    this.db.prepare("INSERT INTO votes (group_id, participant_id, venue_key, created_at) VALUES (?, ?, ?, ?) ON CONFLICT(group_id, participant_id) DO UPDATE SET venue_key = excluded.venue_key, created_at = excluded.created_at")
      .run(groupId, participantId, venueKey, new Date().toISOString());
  }

  async voteTally(groupId: string) {
    const rows = this.db.prepare("SELECT participant_id, venue_key FROM votes WHERE group_id = ?").all(groupId) as { participant_id: string; venue_key: string }[];
    const tally: VoteTally = {}; const byParticipant: Record<string, string> = {};
    for (const r of rows) { tally[r.venue_key] = (tally[r.venue_key] ?? 0) + 1; byParticipant[r.participant_id] = r.venue_key; }
    return { tally, byParticipant };
  }

  async confirmGroup(groupId: string, venueKey: string) {
    this.db.prepare("UPDATE groups SET status = 'confirmed', confirmed_venue_key = ? WHERE id = ?").run(venueKey, groupId);
  }

  async logEvent(groupId: string, type: string, payload?: unknown) {
    this.db.prepare("INSERT INTO events (group_id, type, payload, created_at) VALUES (?, ?, ?, ?)").run(groupId, type, payload == null ? null : JSON.stringify(payload), new Date().toISOString());
  }

  async purgeExpired(): Promise<number> {
    return Number(this.db.prepare("DELETE FROM groups WHERE expires_at < ?").run(new Date().toISOString()).changes);
  }
}
