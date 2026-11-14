import { MemoryCache } from "../cache/memory";
import type { Cache } from "../cache/types";
import { CachedTravelTime } from "./travelTime/cached";
import { OsrmProvider } from "./travelTime/osrm";
import type { TravelTimeProvider } from "./travelTime/types";
import { NominatimVenues, OverpassVenues, PhotonVenues, VenueChain } from "./venues/osm";
import type { VenueProvider } from "./venues/types";

/**
 * One place that reads the environment and wires providers. Module-level singletons survive
 * across requests in a long-lived server and are recreated per cold start on serverless.
 */
type Registry = { cache: Cache; travel: TravelTimeProvider; venues: VenueProvider };

declare global {
  var __fairMiddle: Registry | undefined;
}

export function providers(): Registry {
  if (globalThis.__fairMiddle) return globalThis.__fairMiddle;
  const cache = new MemoryCache();
  const kind = process.env.TRAVEL_PROVIDER ?? "osrm";
  let travel: TravelTimeProvider;
  switch (kind) {
    case "osrm":
      travel = new OsrmProvider();
      break;
    // case "google": travel = new GoogleRoutesProvider(process.env.GOOGLE_MAPS_API_KEY!); break;  // Phase 2
    default:
      throw new Error(`Unknown TRAVEL_PROVIDER "${kind}"`);
  }
  const reg: Registry = {
    cache,
    travel: new CachedTravelTime(travel, cache),
    venues: new VenueChain([new OverpassVenues(), new NominatimVenues(), new PhotonVenues()]),
  };
  globalThis.__fairMiddle = reg;
  return reg;
}
