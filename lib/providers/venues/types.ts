import type { LatLng, Venue, VenueKind } from "../../types";

export { VENUE_KINDS } from "../../types";

export interface VenueProvider {
  readonly name: string;
  near(pt: LatLng, radiusM: number, limit: number, kinds?: VenueKind[]): Promise<Venue[]>;
}
