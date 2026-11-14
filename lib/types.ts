export type LatLng = { lat: number; lon: number };

export type Mode = "drive" | "two_wheeler" | "transit" | "walk";
export const MODES: Mode[] = ["drive", "two_wheeler", "transit", "walk"];

export type Objective = "minimax" | "total";
export const OBJECTIVES: Objective[] = ["minimax", "total"];

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

export type Venue = { name: string; kind: string; lat: number; lon: number };
export type RankedVenue = Venue & { score: Score };

export type HeatCell = LatLng & { worst: number; key: number; pass: 1 | 2 };

export type SolveResult = {
  objective: Objective;
  provider: string;
  computedAt: string;
  participants: PublicParticipant[];
  fairPoint: LatLng & { name?: string };
  fairScore: Score;
  centroid: LatLng;
  centroidScore: Score | null;
  venues: RankedVenue[];
  heat: HeatCell[];
  elements: number; // matrix elements consumed (cost tracking)
};

export type PublicGroup = {
  id: string;
  createdAt: string;
  objective: Objective;
  participants: PublicParticipant[];
  result: SolveResult | null;
};
