import { randomBytes } from "node:crypto";
import { mkdirSync } from "node:fs";
import path from "node:path";
import { DatabaseSync } from "node:sqlite";
import type { Objective, Participant, PublicGroup, SolveResult } from "./types";

/**
 * SQLite via Node's built-in driver: zero setup locally. The schema mirrors the Postgres one in
 * ARCHITECTURE.md so the swap is a driver change, not a model change.
 * Coordinates are stored but never returned by the public read path.
 */
declare global {
  var __fairMiddleDb: DatabaseSync | undefined;
}

function open(): DatabaseSync {
  if (globalThis.__fairMiddleDb) return globalThis.__fairMiddleDb;
  const file = process.env.DATABASE_FILE ?? path.join(process.cwd(), "data", "fairmiddle.db");
  mkdirSync(path.dirname(file), { recursive: true });
  const db = new DatabaseSync(file);
  db.exec(`
    PRAGMA journal_mode = WAL;
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
  `);
  globalThis.__fairMiddleDb = db;
  return db;
}

export const newId = (bytes = 9) => randomBytes(bytes).toString("base64url");

export function createGroup(objective: Objective, participants: Participant[], result: SolveResult, ttlDays = 7): string {
  const db = open();
  const id = newId();
  const now = new Date();
  const exp = new Date(now.getTime() + ttlDays * 86400000);
  db.exec("BEGIN");
  try {
    db.prepare("INSERT INTO groups (id, created_at, objective, expires_at) VALUES (?, ?, ?, ?)").run(id, now.toISOString(), objective, exp.toISOString());
    const ins = db.prepare("INSERT INTO participants (id, group_id, display_name, lat, lon, mode, query) VALUES (?, ?, ?, ?, ?, ?, ?)");
    for (const p of participants) ins.run(p.id, id, p.name, p.lat, p.lon, p.mode, p.query ?? null);
    db.prepare("INSERT INTO results (id, group_id, computed_at, payload) VALUES (?, ?, ?, ?)").run(newId(), id, result.computedAt, JSON.stringify(result));
    db.exec("COMMIT");
  } catch (e) {
    db.exec("ROLLBACK");
    throw e;
  }
  return id;
}

export function getPublicGroup(id: string): PublicGroup | null {
  const db = open();
  const g = db.prepare("SELECT id, created_at, objective, expires_at FROM groups WHERE id = ?").get(id) as
    | { id: string; created_at: string; objective: Objective; expires_at: string } | undefined;
  if (!g || new Date(g.expires_at) < new Date()) return null;
  const ps = db.prepare("SELECT id, display_name, mode FROM participants WHERE group_id = ? ORDER BY rowid").all(id) as
    { id: string; display_name: string; mode: Participant["mode"] }[];
  const r = db.prepare("SELECT payload FROM results WHERE group_id = ? ORDER BY computed_at DESC LIMIT 1").get(id) as { payload: string } | undefined;
  return {
    id: g.id,
    createdAt: g.created_at,
    objective: g.objective,
    participants: ps.map((p) => ({ id: p.id, name: p.display_name, mode: p.mode })),
    result: r ? (JSON.parse(r.payload) as SolveResult) : null,
  };
}

/** Housekeeping: delete expired groups (coordinates go with them). */
export function purgeExpired(): number {
  const db = open();
  return Number(db.prepare("DELETE FROM groups WHERE expires_at < ?").run(new Date().toISOString()).changes);
}
