import { neon, type NeonQueryFunction } from "@neondatabase/serverless";
import type { Participant, SolveOptions, SolveResult, VoteTally } from "../types";
import { newId } from "./ids";
import { SOLVE_STALE_MS, type GroupRow, type Store, type StoredParticipant } from "./types";

type Row = Record<string, unknown>;

/**
 * Postgres over Neon's HTTP driver: no connection pool to manage, works on serverless.
 * Same tables as the SQLite store; timestamps are kept as ISO strings for parity.
 */
export class PostgresStore implements Store {
  readonly name = "postgres(neon)";
  private sql: NeonQueryFunction<false, false>;
  private ready: Promise<void> | null = null;

  constructor(url: string) {
    this.sql = neon(url);
  }

  private async q<T = Row>(text: string, params: unknown[] = []): Promise<T[]> {
    await (this.ready ??= this.migrate());
    return (await this.sql.query(text, params)) as T[];
  }

  private async migrate() {
    const s = this.sql;
    await s.query(`CREATE TABLE IF NOT EXISTS groups (
      id TEXT PRIMARY KEY, created_at TEXT NOT NULL, objective TEXT NOT NULL, expires_at TEXT NOT NULL,
      options TEXT, title TEXT, status TEXT NOT NULL DEFAULT 'open', organiser_hash TEXT, confirmed_venue_key TEXT,
      solving_since TEXT, dirty INTEGER NOT NULL DEFAULT 0)`);
    await s.query(`CREATE TABLE IF NOT EXISTS participants (
      id TEXT PRIMARY KEY, group_id TEXT NOT NULL REFERENCES groups(id) ON DELETE CASCADE,
      display_name TEXT NOT NULL, lat DOUBLE PRECISION NOT NULL, lon DOUBLE PRECISION NOT NULL, mode TEXT NOT NULL, query TEXT,
      token_hash TEXT, joined_at TEXT, seq BIGSERIAL)`);
    await s.query(`CREATE TABLE IF NOT EXISTS results (
      id TEXT PRIMARY KEY, group_id TEXT NOT NULL REFERENCES groups(id) ON DELETE CASCADE, computed_at TEXT NOT NULL, payload TEXT NOT NULL)`);
    await s.query(`CREATE INDEX IF NOT EXISTS results_group ON results(group_id, computed_at DESC)`);
    await s.query(`CREATE TABLE IF NOT EXISTS votes (
      group_id TEXT NOT NULL REFERENCES groups(id) ON DELETE CASCADE,
      participant_id TEXT NOT NULL REFERENCES participants(id) ON DELETE CASCADE,
      venue_key TEXT NOT NULL, created_at TEXT NOT NULL, PRIMARY KEY (group_id, participant_id))`);
    await s.query(`CREATE TABLE IF NOT EXISTS events (
      id BIGSERIAL PRIMARY KEY, group_id TEXT NOT NULL, type TEXT NOT NULL, payload TEXT, created_at TEXT NOT NULL)`);
  }

  async insertGroup(opts: { options: SolveOptions; title?: string; organiserHash: string; ttlDays?: number }): Promise<string> {
    const id = newId();
    const now = new Date();
    const exp = new Date(now.getTime() + (opts.ttlDays ?? 7) * 86400000);
    await this.q("INSERT INTO groups (id, created_at, objective, expires_at, options, title, status, organiser_hash) VALUES ($1, $2, $3, $4, $5, $6, 'open', $7)",
      [id, now.toISOString(), opts.options.objective, exp.toISOString(), JSON.stringify(opts.options), opts.title ?? null, opts.organiserHash]);
    return id;
  }

  async liveGroup(id: string): Promise<GroupRow | null> {
    const [g] = await this.q<GroupRow>("SELECT * FROM groups WHERE id = $1", [id]);
    if (!g || new Date(g.expires_at) < new Date()) return null;
    return { ...g, dirty: Number(g.dirty) };
  }

  async insertParticipant(groupId: string, p: Participant, tokenHash?: string) {
    await this.q("INSERT INTO participants (id, group_id, display_name, lat, lon, mode, query, token_hash, joined_at) VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9)",
      [p.id, groupId, p.name, p.lat, p.lon, p.mode, p.query ?? null, tokenHash ?? null, new Date().toISOString()]);
  }

  async updateParticipant(groupId: string, p: Participant) {
    await this.q("UPDATE participants SET display_name = $1, lat = $2, lon = $3, mode = $4, query = $5 WHERE id = $6 AND group_id = $7",
      [p.name, p.lat, p.lon, p.mode, p.query ?? null, p.id, groupId]);
  }

  async privateParticipants(groupId: string): Promise<StoredParticipant[]> {
    type R = { id: string; display_name: string; lat: number; lon: number; mode: Participant["mode"]; query: string | null; token_hash: string | null };
    const rows = await this.q<R>("SELECT id, display_name, lat, lon, mode, query, token_hash FROM participants WHERE group_id = $1 ORDER BY seq", [groupId]);
    return rows.map((p) => ({ id: p.id, name: p.display_name, lat: Number(p.lat), lon: Number(p.lon), mode: p.mode, query: p.query ?? undefined, tokenHash: p.token_hash }));
  }

  async insertResult(groupId: string, result: SolveResult) {
    await this.q("INSERT INTO results (id, group_id, computed_at, payload) VALUES ($1, $2, $3, $4)", [newId(), groupId, result.computedAt, JSON.stringify(result)]);
  }

  async latestResult(groupId: string): Promise<SolveResult | null> {
    const [r] = await this.q<{ payload: string }>("SELECT payload FROM results WHERE group_id = $1 ORDER BY computed_at DESC LIMIT 1", [groupId]);
    return r ? (JSON.parse(r.payload) as SolveResult) : null;
  }

  async claimSolve(groupId: string): Promise<boolean> {
    const stale = new Date(Date.now() - SOLVE_STALE_MS).toISOString();
    const rows = await this.q("UPDATE groups SET solving_since = $1, dirty = 0 WHERE id = $2 AND (solving_since IS NULL OR solving_since < $3) RETURNING id",
      [new Date().toISOString(), groupId, stale]);
    if (rows.length) return true;
    await this.q("UPDATE groups SET dirty = 1 WHERE id = $1", [groupId]);
    return false;
  }

  async releaseSolve(groupId: string): Promise<boolean> {
    const rows = await this.q<{ dirty: number }>("UPDATE groups SET solving_since = NULL, dirty = 0 WHERE id = $1 RETURNING (SELECT dirty FROM groups g2 WHERE g2.id = $1) AS dirty", [groupId]);
    return rows.length > 0 && Number(rows[0].dirty) === 1;
  }

  async setVote(groupId: string, participantId: string, venueKey: string) {
    await this.q("INSERT INTO votes (group_id, participant_id, venue_key, created_at) VALUES ($1, $2, $3, $4) ON CONFLICT (group_id, participant_id) DO UPDATE SET venue_key = EXCLUDED.venue_key, created_at = EXCLUDED.created_at",
      [groupId, participantId, venueKey, new Date().toISOString()]);
  }

  async voteTally(groupId: string) {
    const rows = await this.q<{ participant_id: string; venue_key: string }>("SELECT participant_id, venue_key FROM votes WHERE group_id = $1", [groupId]);
    const tally: VoteTally = {}; const byParticipant: Record<string, string> = {};
    for (const r of rows) { tally[r.venue_key] = (tally[r.venue_key] ?? 0) + 1; byParticipant[r.participant_id] = r.venue_key; }
    return { tally, byParticipant };
  }

  async confirmGroup(groupId: string, venueKey: string) {
    await this.q("UPDATE groups SET status = 'confirmed', confirmed_venue_key = $1 WHERE id = $2", [venueKey, groupId]);
  }

  async logEvent(groupId: string, type: string, payload?: unknown) {
    await this.q("INSERT INTO events (group_id, type, payload, created_at) VALUES ($1, $2, $3, $4)", [groupId, type, payload == null ? null : JSON.stringify(payload), new Date().toISOString()]);
  }

  async purgeExpired(): Promise<number> {
    const rows = await this.q("DELETE FROM groups WHERE expires_at < $1 RETURNING id", [new Date().toISOString()]);
    return rows.length;
  }
}
