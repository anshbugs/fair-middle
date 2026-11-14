import { describe, expect, it } from "vitest";
import { haversineKm } from "../geo";
import type { TravelTimeProvider } from "../providers/travelTime/types";
import type { VenueProvider } from "../providers/venues/types";
import type { LatLng, Participant } from "../types";
import { solve } from "./solve";
import { argbest, scoreColumn } from "./objective";

/**
 * Synthetic city: travel is straight-line at 30 km/h, but crossing the "river" at lon 77.25
 * costs an extra 20 minutes. That makes the geographic middle unfair to whoever lives across it.
 */
const river = 77.25;
const fake: TravelTimeProvider = {
  name: "fake",
  maxCoords: 100,
  async matrix(origins, dests) {
    return {
      durations: origins.map((o) => dests.map((d) => (haversineKm(o, d) / 30) * 3600 + ((o.lon < river) !== (d.lon < river) ? 1200 : 0))),
      snapped: dests.map((d) => ({ ...d, name: "Test Road" })),
    };
  },
};
const venues: VenueProvider = {
  name: "fake-venues",
  async near(pt: LatLng) {
    return [0.002, 0.004, 0.006].map((d, i) => ({ name: `Cafe ${i + 1}`, kind: "cafe", lat: pt.lat + d, lon: pt.lon - d }));
  },
};

const people: Participant[] = [
  { id: "a", name: "A", lat: 28.58, lon: 77.05, mode: "drive" },
  { id: "b", name: "B", lat: 28.64, lon: 77.37, mode: "drive" },
  { id: "c", name: "C", lat: 28.52, lon: 77.2, mode: "drive" },
];

describe("solve", () => {
  it("never does worse than the geographic middle on the worst commute", async () => {
    const r = await solve(people, "minimax", { travel: fake, venues });
    expect(r.centroidScore).not.toBeNull();
    expect(r.fairScore.worst).toBeLessThanOrEqual(r.centroidScore!.worst);
    expect(r.venues.length).toBeGreaterThan(0);
    expect(r.venues[0].score.worst).toBeLessThanOrEqual(r.venues[r.venues.length - 1].score.worst);
    expect(r.heat.some((h) => h.pass === 2)).toBe(true);
    expect(r.participants.every((p) => !("lat" in p))).toBe(true);
  });

  it("total objective gives a lower or equal total than minimax", async () => {
    const a = await solve(people, "minimax", { travel: fake, venues });
    const b = await solve(people, "total", { travel: fake, venues });
    expect(b.fairScore.total).toBeLessThanOrEqual(a.fairScore.total + 1);
  });

  it("groups mixed modes and keeps participant order", async () => {
    const mixed = people.map((p, i) => ({ ...p, mode: (i === 1 ? "walk" : "drive") as Participant["mode"] }));
    const r = await solve(mixed, "minimax", { travel: fake, venues });
    expect(r.fairScore.col).toHaveLength(3);
    expect(r.participants[1].mode).toBe("walk");
  });

  it("rejects fewer than two people", async () => {
    await expect(solve(people.slice(0, 1), "minimax", { travel: fake, venues })).rejects.toThrow(/two people/);
  });
});

describe("objective", () => {
  const m = [[600, 1200, null], [900, 300, 100]];
  it("scores columns and skips unreachable ones", () => {
    expect(scoreColumn(m, 0, "minimax")).toMatchObject({ worst: 900, total: 1500, spread: 300, key: 900 });
    expect(scoreColumn(m, 1, "total")).toMatchObject({ key: 1500 });
    expect(scoreColumn(m, 2, "minimax")).toBeNull();
  });
  it("argbest picks the lowest key", () => {
    expect(argbest([scoreColumn(m, 0, "minimax"), scoreColumn(m, 1, "minimax"), scoreColumn(m, 2, "minimax")])).toBe(0);
  });
});
