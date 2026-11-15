export type LatLng = { lat: number; lon: number };

export type Mode = "drive" | "two_wheeler" | "transit" | "walk";
export const MODES: Mode[] = ["drive", "two_wheeler", "transit", "walk"];

export type Objective = "minimax" | "total";
export const OBJECTIVES: Objective[] = ["minimax", "total"];

export const VENUE_KINDS = ["cafe", "restaurant", "bar", "pub", "food_court"] as const;
export type VenueKind = (typeof VENUE_KINDS)[number];

/** Hard constraints. Each one is relaxed, in this order, when it leaves nothing feasible. */
export type Constraints = {
  /** nobody travels longer than this (minutes) */
  maxMinutes?: number;
  /** the spot must be within this many metres of a metro station */
  nearMetroM?: number;
  /** which kinds of venue to consider */
  kinds?: VenueKind[];
};

export type SolveOptions = {
  objective: Objective;
  constraints?: Constraints;
  /** ISO timestamp; honoured only by providers that support departure times */
  departAt?: string;
};

export type Participant = LatLng & {
  id: string;
  name: string;
  mode: Mode;
  query?: string;
};

/** Public shape of a participant: never carries coordinates. */
export type PublicParticipant = { id: string; name: string; mode: Mode };

export type Score = {
  worst: number; // seconds
  total: number;
  spread: number;
  col: number[]; // per participant, in participant order
  key: number; // the value the objective minimises
};

export type MetroInfo = { name: string; distM: number };

export type Venue = { name: string; kind: string; lat: number; lon: number; metro?: MetroInfo };
export type RankedVenue = Venue & { score: Score };

export type HeatCell = LatLng & { worst: number; key: number; pass: 1 | 2 };

export type SolveResult = {
  objective: Objective;
  constraints: Constraints;
  /** constraints that had to be dropped to find anything, in the order they were dropped */
  relaxed: (keyof Constraints)[];
  departAt?: string;
  provider: string;
  /** whether the provider actually used departAt (traffic / schedules) */
  departureAware: boolean;
  computedAt: string;
  participants: PublicParticipant[];
  fairPoint: LatLng & { name?: string; metro?: MetroInfo };
  fairScore: Score;
  centroid: LatLng;
  centroidScore: Score | null;
  venues: RankedVenue[];
  heat: HeatCell[];
  elements: number; // matrix elements consumed (cost tracking)
};

export type InspectResult = {
  point: LatLng & { name?: string; metro?: MetroInfo };
  score: Score | null;
  participants: PublicParticipant[];
};

export type GroupStatus = "open" | "confirmed";

/** Stable identity for a venue across solves: name plus rounded coordinates. */
export const venueKey = (v: { name: string; lat: number; lon: number }) => `${v.name.toLowerCase()}|${v.lat.toFixed(4)}|${v.lon.toFixed(4)}`;

export type VoteTally = Record<string, number>; // venueKey -> votes

export type Viewer = {
  isOrganiser: boolean;
  /** the participant this browser joined as, if any */
  participantId?: string;
};

export type PublicGroup = {
  id: string;
  title: string;
  createdAt: string;
  status: GroupStatus;
  objective: Objective;
  constraints: Constraints;
  participants: PublicParticipant[];
  result: SolveResult | null;
  /** a solve is running in the background */
  computing: boolean;
  votes: VoteTally;
  confirmedVenueKey?: string;
  viewer: Viewer;
  myVote?: string;
};
