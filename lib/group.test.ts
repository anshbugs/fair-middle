import { beforeAll, describe, expect, it } from "vitest";

// Isolated in-memory database for this file; must be set before the db module loads.
process.env.DATABASE_FILE = ":memory:";

import { haversineKm } from "./geo";
import type { TravelTimeProvider } from "./providers/travelTime/types";
import type { VenueProvider } from "./providers/venues/types";
import { venueKey, type LatLng } from "./types";

const fake: TravelTimeProvider = {
  name: "fake", maxCoords: 100, supportsDeparture: false,
  async matrix(origins, dests) {
    return { durations: origins.map((o) => dests.map((d) => (haversineKm(o, d) / 30) * 3600)), snapped: dests.map((d) => ({ ...d })) };
  },
};
const venues: VenueProvider = {
  name: "fake-venues",
  async near(pt: LatLng) { return [0.002, 0.004, 0.006].map((d, i) => ({ name: `Place ${i + 1}`, kind: "cafe", lat: pt.lat + d, lon: pt.lon - d })); },
};
const deps = { travel: fake, venues };

const waitForSolve = async (id: string, g: typeof import("./group")) => {
  for (let i = 0; i < 100 && g.isComputing(id); i++) await new Promise((r) => setTimeout(r, 10));
};

describe("group flow", () => {
  let group: typeof import("./group");
  beforeAll(async () => { group = await import("./group"); });

  it("create → join twice → background solve → vote → confirm, without leaking coordinates", async () => {
    const { id, organiserToken } = group.createGroup({ objective: "minimax" }, "Friday");
    const v0 = group.publicView(id, { organiser: organiserToken })!;
    expect(v0.status).toBe("open");
    expect(v0.viewer.isOrganiser).toBe(true);
    expect(v0.participants).toEqual([]);

    const a = await group.join(id, { name: "A", lat: 28.58, lon: 77.05, mode: "drive" }, {}, deps);
    expect(group.publicView(id, {})!.result).toBeNull(); // one person: nothing to solve yet

    const b = await group.join(id, { name: "B", lat: 28.64, lon: 77.37, mode: "transit" }, {}, deps);
    await waitForSolve(id, group);
    const v = group.publicView(id, { participant: `${b.participantId}.${b.token}` })!;
    expect(v.result).not.toBeNull();
    expect(v.result!.venues.length).toBeGreaterThan(0);
    expect(v.viewer.participantId).toBe(b.participantId);
    expect(JSON.stringify(v)).not.toContain("77.37");

    // A re-joins with a new start: same participant, updated
    await group.join(id, { name: "A", lat: 28.6, lon: 77.1, mode: "drive" }, { participant: `${a.participantId}.${a.token}` }, deps);
    await waitForSolve(id, group);
    expect(group.publicView(id, {})!.participants).toHaveLength(2);

    // votes (keys come from the latest result, since the re-join moved the fair spot)
    const latest = group.publicView(id, {})!.result!;
    const key = venueKey(latest.venues[1]);
    expect(() => group.vote(id, key, {})).toThrow(/Join the plan/);
    group.vote(id, key, { participant: `${b.participantId}.${b.token}` });
    const v2 = group.publicView(id, { participant: `${b.participantId}.${b.token}` })!;
    expect(v2.votes[key]).toBe(1);
    expect(v2.myVote).toBe(key);

    // confirm is organiser-only
    expect(() => group.confirm(id, key, { participant: `${b.participantId}.${b.token}` })).toThrow(/organiser/);
    group.confirm(id, key, { organiser: organiserToken });
    const v3 = group.publicView(id, {})!;
    expect(v3.status).toBe("confirmed");
    expect(v3.confirmedVenueKey).toBe(key);
    expect(() => group.vote(id, key, { participant: `${b.participantId}.${b.token}` })).toThrow(/confirmed/);
  });

  it("re-solves once more when someone joins mid-solve", async () => {
    const { id } = group.createGroup({ objective: "minimax" });
    await group.join(id, { name: "A", lat: 28.58, lon: 77.05, mode: "drive" }, {}, deps);
    await group.join(id, { name: "B", lat: 28.64, lon: 77.37, mode: "drive" }, {}, deps); // starts solve for 2
    await group.join(id, { name: "C", lat: 28.52, lon: 77.2, mode: "drive" }, {}, deps);  // arrives mid-solve
    await waitForSolve(id, group);
    await new Promise((r) => setTimeout(r, 20));
    await waitForSolve(id, group);
    expect(group.publicView(id, {})!.result!.participants).toHaveLength(3);
  });

  it("rejects a forged participant cookie", async () => {
    const { id } = group.createGroup({ objective: "minimax" });
    const a = await group.join(id, { name: "A", lat: 28.58, lon: 77.05, mode: "drive" }, {}, deps);
    expect(group.whoAmI(id, { participant: `${a.participantId}.not-the-token` }).participantId).toBeUndefined();
    expect(group.whoAmI(id, { participant: `${a.participantId}.${a.token}` }).participantId).toBe(a.participantId);
  });

  it("quick mode creates a solved group and an organiser", async () => {
    const r = await group.createSolvedGroup({ objective: "minimax" }, [
      { id: "p1", name: "A", lat: 28.58, lon: 77.05, mode: "drive" },
      { id: "p2", name: "B", lat: 28.64, lon: 77.37, mode: "drive" },
    ], deps);
    const v = group.publicView(r.id, { organiser: r.organiserToken })!;
    expect(v.viewer.isOrganiser).toBe(true);
    expect(v.result!.fairScore.worst).toBe(r.result.fairScore.worst);
  });
});
