import type { LatLng, Venue } from "../../types";

export interface VenueProvider {
  readonly name: string;
  near(pt: LatLng, radiusM: number, limit: number): Promise<Venue[]>;
}

export const VENUE_KINDS = ["cafe", "restaurant", "bar", "pub", "food_court"] as const;
