import type { Cache } from "./types";

/** In-process cache with TTL and a size cap. Swap for Redis (same interface) when deploying. */
export class MemoryCache implements Cache {
  private store = new Map<string, { exp: number; v: unknown }>();
  constructor(private max = 2000) {}

  async get<T>(key: string): Promise<T | undefined> {
    const e = this.store.get(key);
    if (!e) return undefined;
    if (e.exp < Date.now()) { this.store.delete(key); return undefined; }
    return e.v as T;
  }

  async set<T>(key: string, value: T, ttlSec: number): Promise<void> {
    if (this.store.size >= this.max) {
      const first = this.store.keys().next().value;
      if (first !== undefined) this.store.delete(first);
    }
    this.store.set(key, { exp: Date.now() + ttlSec * 1000, v: value });
  }
}
