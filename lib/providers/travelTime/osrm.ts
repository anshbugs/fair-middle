import type { LatLng } from "../../types";
import { chunkedMatrix, type MatrixOpts, type MatrixResult, type TravelTimeProvider } from "./types";

type OsrmTable = {
  code: string;
  message?: string;
  durations: (number | null)[][];
  destinations: { location: [number, number]; name?: string }[];
};

/**
 * OSRM table service. The public demo server only has a car profile, so every mode is routed as
 * driving; two-wheeler and walk/transit are scaled as rough estimates (the UI says so).
 */
export class OsrmProvider implements TravelTimeProvider {
  readonly name: string;
  readonly maxCoords = 100;
  readonly supportsDeparture = false;
  constructor(private base = process.env.OSRM_URL ?? "https://router.project-osrm.org", private timeoutMs = 15000) {
    this.name = `osrm(${new URL(base).host})`;
  }

  matrix(origins: LatLng[], dests: LatLng[], opts: MatrixOpts): Promise<MatrixResult> {
    return chunkedMatrix(this.maxCoords - origins.length, (o, d) => this.call(o, d, opts), origins, dests);
  }

  private async call(origins: LatLng[], dests: LatLng[], opts: MatrixOpts): Promise<MatrixResult> {
    const coords = [...origins, ...dests].map((p) => `${p.lon.toFixed(6)},${p.lat.toFixed(6)}`).join(";");
    const s = origins.map((_, i) => i).join(";");
    const d = dests.map((_, i) => origins.length + i).join(";");
    const url = `${this.base}/table/v1/driving/${coords}?sources=${s}&destinations=${d}&annotations=duration`;
    const r = await fetch(url, { signal: AbortSignal.timeout(this.timeoutMs) });
    if (!r.ok) throw new Error(`Routing server returned ${r.status}`);
    const j = (await r.json()) as OsrmTable;
    if (j.code !== "Ok") throw new Error(`Routing failed: ${j.message ?? j.code}`);
    const factor = opts.mode === "two_wheeler" ? 0.85 : opts.mode === "walk" ? 6 : opts.mode === "transit" ? 1.6 : 1;
    return {
      durations: j.durations.map((row) => row.map((v) => (v == null ? null : v * factor))),
      snapped: j.destinations.map((x) => ({ lat: x.location[1], lon: x.location[0], name: x.name || undefined })),
    };
  }
}
