import { createHash } from "node:crypto";
import { roundKey } from "../../geo";
import type { Cache } from "../../cache/types";
import type { LatLng } from "../../types";
import type { MatrixOpts, MatrixResult, TravelTimeProvider } from "./types";

/**
 * Caches whole matrix calls keyed by provider, mode, 15-minute departure bucket and rounded
 * coordinates. Whole-call caching is enough for repeat solves of the same group; per-cell
 * caching is a later upgrade.
 */
export class CachedTravelTime implements TravelTimeProvider {
  readonly name: string;
  readonly maxCoords: number;
  readonly supportsDeparture: boolean;
  constructor(private inner: TravelTimeProvider, private cache: Cache, private ttlSec = 24 * 3600) {
    this.name = inner.name;
    this.maxCoords = inner.maxCoords;
    this.supportsDeparture = inner.supportsDeparture;
  }

  async matrix(origins: LatLng[], dests: LatLng[], opts: MatrixOpts): Promise<MatrixResult> {
    const bucket = this.supportsDeparture && opts.departAt ? Math.floor(opts.departAt.getTime() / 900000) : "any";
    const raw = `${this.inner.name}|${opts.mode}|${bucket}|${origins.map((p) => roundKey(p)).join(";")}|${dests.map((p) => roundKey(p)).join(";")}`;
    const key = `tt:${createHash("sha1").update(raw).digest("hex")}`;
    const hit = await this.cache.get<MatrixResult>(key);
    if (hit) return hit;
    const r = await this.inner.matrix(origins, dests, opts);
    await this.cache.set(key, r, bucket === "any" ? this.ttlSec : 3600);
    return r;
  }
}
