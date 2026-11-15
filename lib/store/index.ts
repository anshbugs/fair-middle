import type { Store } from "./types";

export type { GroupRow, Store, StoredParticipant } from "./types";
export { isSolving } from "./types";
export { newId } from "./ids";

declare global {
  var __fairMiddleStore: Store | undefined;
}

/**
 * Pick the store from the environment:
 *   DATABASE_URL / POSTGRES_URL  → Postgres (Neon driver), for Vercel and any multi-instance host
 *   otherwise                    → SQLite file (DATABASE_FILE), for local dev and single servers
 * Loaded lazily so the SQLite driver never ships to serverless bundles that don't use it.
 */
export async function store(): Promise<Store> {
  if (globalThis.__fairMiddleStore) return globalThis.__fairMiddleStore;
  const url = process.env.DATABASE_URL ?? process.env.POSTGRES_URL;
  const s: Store = url
    ? new (await import("./postgres")).PostgresStore(url)
    : new (await import("./sqlite")).SqliteStore();
  globalThis.__fairMiddleStore = s;
  return s;
}
