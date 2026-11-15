import type { LatLng, Mode } from "../../types";
import { chunkedMatrix, type MatrixOpts, type MatrixResult, type TravelTimeProvider } from "./types";

const MODE_MAP: Record<Mode, string> = { drive: "DRIVE", two_wheeler: "TWO_WHEELER", transit: "TRANSIT", walk: "WALK" };
const ELEMENT_LIMIT = 625; // Routes API computeRouteMatrix: origins × destinations per request

type Element = { originIndex: number; destinationIndex: number; duration?: string; condition?: string };

/**
 * Google Routes API, computeRouteMatrix. Traffic-aware for driving, schedule-aware for transit,
 * when `departAt` is in the future. Key stays on the server.
 */
export class GoogleRoutesProvider implements TravelTimeProvider {
  readonly name = "google-routes";
  readonly maxCoords = ELEMENT_LIMIT;
  readonly supportsDeparture = true;
  constructor(private apiKey: string, private fetchImpl: typeof fetch = fetch, private timeoutMs = 20000) {
    if (!apiKey) throw new Error("GOOGLE_MAPS_API_KEY is not set");
  }

  matrix(origins: LatLng[], dests: LatLng[], opts: MatrixOpts): Promise<MatrixResult> {
    return chunkedMatrix(Math.floor(ELEMENT_LIMIT / origins.length), (o, d) => this.call(o, d, opts), origins, dests);
  }

  buildBody(origins: LatLng[], dests: LatLng[], opts: MatrixOpts) {
    const wp = (p: LatLng) => ({ waypoint: { location: { latLng: { latitude: p.lat, longitude: p.lon } } } });
    const road = opts.mode === "drive" || opts.mode === "two_wheeler";
    const future = opts.departAt && opts.departAt.getTime() > Date.now() + 60_000 ? opts.departAt : undefined;
    return {
      origins: origins.map(wp),
      destinations: dests.map(wp),
      travelMode: MODE_MAP[opts.mode],
      ...(road ? { routingPreference: "TRAFFIC_AWARE" } : {}),
      ...(future ? { departureTime: future.toISOString() } : {}),
    };
  }

  private async call(origins: LatLng[], dests: LatLng[], opts: MatrixOpts): Promise<MatrixResult> {
    const r = await this.fetchImpl("https://routes.googleapis.com/distanceMatrix/v2:computeRouteMatrix", {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        "X-Goog-Api-Key": this.apiKey,
        "X-Goog-FieldMask": "originIndex,destinationIndex,duration,condition",
      },
      body: JSON.stringify(this.buildBody(origins, dests, opts)),
      signal: AbortSignal.timeout(this.timeoutMs),
    });
    if (!r.ok) throw new Error(`Google Routes returned ${r.status}: ${(await r.text()).slice(0, 200)}`);
    const els = (await r.json()) as Element[];
    const durations: (number | null)[][] = origins.map(() => dests.map(() => null));
    for (const e of els) {
      if (e.condition !== "ROUTE_EXISTS" || !e.duration) continue;
      durations[e.originIndex][e.destinationIndex] = parseFloat(e.duration);
    }
    return { durations, snapped: dests.map((d) => ({ ...d })) };
  }
}
