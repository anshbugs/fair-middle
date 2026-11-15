import { describe, expect, it } from "vitest";
import { haversineKm } from "../geo";
import { GoogleRoutesProvider } from "../providers/travelTime/google";
import type { TravelTimeProvider } from "../providers/travelTime/types";
import type { VenueProvider } from "../providers/venues/types";
import type { LatLng, Participant } from "../types";
import { applyConstraints, inspect, solve } from "./solve";
import { argbest, scoreColumn } from "./objective";

/**
 * Synthetic city: travel is straight-line at 30 km/h, but crossing the "river" at lon 77.25
 * costs an extra 20 minutes. That makes the geographic middle unfair to whoever lives across it.
 */
const river = 77.25;
const fake: TravelTimeProvider = {
  name: "fake",
  maxCoords: 100,
  supportsDeparture: false,
  async matrix(origins, dests) {
    return {
      durations: origins.map((o) => dests.map((d) => (haversineKm(o, d) / 30) * 3600 + ((o.lon < river) !== (d.lon < river) ? 1200 : 0))),
      snapped: dests.map((d) => ({ ...d, name: "Test Road" })),
    };
  },
};
const venues: VenueProvider = {
  name: "fake-venues",
  async near(pt: LatLng, _r, _l, kinds) {
    return [0.002, 0.004, 0.006].map((d, i) => ({ name: `Place ${i + 1}`, kind: kinds?.[0] ?? "cafe", lat: pt.lat + d, lon: pt.lon - d }));
  },
};

const people: Participant[] = [
  { id: "a", name: "A", lat: 28.58, lon: 77.05, mode: "drive" },
  { id: "b", name: "B", lat: 28.64, lon: 77.37, mode: "drive" },
  { id: "c", name: "C", lat: 28.52, lon: 77.2, mode: "drive" },
];
const deps = { travel: fake, venues };

describe("solve", () => {
  it("never does worse than the geographic middle on the worst commute", async () => {
    const r = await solve(people, { objective: "minimax" }, deps);
    expect(r.centroidScore).not.toBeNull();
    expect(r.fairScore.worst).toBeLessThanOrEqual(r.centroidScore!.worst);
    expect(r.venues.length).toBeGreaterThan(0);
    expect(r.venues[0].score.worst).toBeLessThanOrEqual(r.venues[r.venues.length - 1].score.worst);
    expect(r.heat.some((h) => h.pass === 2)).toBe(true);
    expect(r.participants.every((p) => !("lat" in p))).toBe(true);
    expect(r.relaxed).toEqual([]);
    expect(r.departureAware).toBe(false);
  });

  it("total objective gives a lower or equal total than minimax", async () => {
    const a = await solve(people, { objective: "minimax" }, deps);
    const b = await solve(people, { objective: "total" }, deps);
    expect(b.fairScore.total).toBeLessThanOrEqual(a.fairScore.total + 1);
  });

  it("groups mixed modes and keeps participant order", async () => {
    const mixed = people.map((p, i) => ({ ...p, mode: (i === 1 ? "walk" : "drive") as Participant["mode"] }));
    const r = await solve(mixed, { objective: "minimax" }, deps);
    expect(r.fairScore.col).toHaveLength(3);
    expect(r.participants[1].mode).toBe("walk");
  });

  it("passes venue kinds through and reports them", async () => {
    const r = await solve(people, { objective: "minimax", constraints: { kinds: ["bar"] } }, deps);
    expect(r.venues[0].kind).toBe("bar");
    expect(r.constraints.kinds).toEqual(["bar"]);
  });

  it("relaxes an impossible travel-time cap and says so", async () => {
    const r = await solve(people, { objective: "minimax", constraints: { maxMinutes: 5 } }, deps);
    expect(r.relaxed).toContain("maxMinutes");
    expect(r.fairScore.worst).toBeGreaterThan(300);
  });

  it("honours a feasible travel-time cap", async () => {
    const loose = await solve(people, { objective: "minimax" }, deps);
    const cap = Math.ceil(loose.fairScore.worst / 60) + 5;
    const r = await solve(people, { objective: "minimax", constraints: { maxMinutes: cap } }, deps);
    expect(r.relaxed).toEqual([]);
    expect(r.fairScore.worst).toBeLessThanOrEqual(cap * 60);
  });

  it("rejects fewer than two people", async () => {
    await expect(solve(people.slice(0, 1), { objective: "minimax" }, deps)).rejects.toThrow(/two people/);
  });
});

describe("inspect", () => {
  it("scores an arbitrary point for the group without exposing coordinates", async () => {
    const r = await inspect(people, { lat: 28.6, lon: 77.2 }, { objective: "minimax" }, { travel: fake });
    expect(r.score?.col).toHaveLength(3);
    expect(r.point.name).toBe("Test Road");
    expect(r.participants.every((p) => !("lat" in p))).toBe(true);
  });
});

describe("applyConstraints", () => {
  const pts = [{ lat: 28.6, lon: 77.2 }, { lat: 28.7, lon: 77.1 }];
  const s = (worst: number) => ({ worst, total: worst, spread: 0, col: [worst], key: worst });
  it("keeps what fits and relaxes in order", () => {
    expect(applyConstraints(pts, [s(600), s(1800)], { maxMinutes: 15 })).toEqual({ keep: [0], relaxed: [] });
    expect(applyConstraints(pts, [s(6000), s(7000)], { maxMinutes: 15 })).toEqual({ keep: [0, 1], relaxed: ["maxMinutes"] });
    expect(applyConstraints(pts, [null, s(60)], {})).toEqual({ keep: [1], relaxed: [] });
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

describe("GoogleRoutesProvider", () => {
  it("shapes the request per mode and parses the element list", async () => {
    const calls: { url: string; body: Record<string, unknown>; headers: Record<string, string> }[] = [];
    const fetchImpl = (async (url: string | URL | Request, init?: RequestInit) => {
      calls.push({ url: String(url), body: JSON.parse(String(init?.body)), headers: init?.headers as Record<string, string> });
      return new Response(JSON.stringify([
        { originIndex: 0, destinationIndex: 0, duration: "600s", condition: "ROUTE_EXISTS" },
        { originIndex: 0, destinationIndex: 1, condition: "ROUTE_NOT_FOUND" },
      ]), { status: 200 });
    }) as typeof fetch;
    const g = new GoogleRoutesProvider("test-key", fetchImpl);
    const depart = new Date(Date.now() + 3600_000);
    const r = await g.matrix([{ lat: 1, lon: 2 }], [{ lat: 3, lon: 4 }, { lat: 5, lon: 6 }], { mode: "transit", departAt: depart });
    expect(r.durations).toEqual([[600, null]]);
    expect(calls[0].headers["X-Goog-Api-Key"]).toBe("test-key");
    expect(calls[0].body.travelMode).toBe("TRANSIT");
    expect(calls[0].body.routingPreference).toBeUndefined();
    expect(calls[0].body.departureTime).toBe(depart.toISOString());
    await g.matrix([{ lat: 1, lon: 2 }], [{ lat: 3, lon: 4 }], { mode: "drive" });
    expect(calls[1].body.routingPreference).toBe("TRAFFIC_AWARE");
    expect(calls[1].body.departureTime).toBeUndefined();
  });

  it("chunks destinations to stay under the element limit", async () => {
    let n = 0;
    const fetchImpl = (async (_u: string | URL | Request, init?: RequestInit) => {
      n++;
      const b = JSON.parse(String(init?.body)) as { origins: unknown[]; destinations: unknown[] };
      const els = b.origins.flatMap((_, i) => b.destinations.map((_, j) => ({ originIndex: i, destinationIndex: j, duration: "1s", condition: "ROUTE_EXISTS" })));
      return new Response(JSON.stringify(els), { status: 200 });
    }) as typeof fetch;
    const g = new GoogleRoutesProvider("k", fetchImpl);
    const origins = Array.from({ length: 5 }, (_, i) => ({ lat: i, lon: 0 }));
    const dests = Array.from({ length: 300 }, (_, i) => ({ lat: 0, lon: i }));
    const r = await g.matrix(origins, dests, { mode: "drive" });
    expect(n).toBe(3); // 5 × 125 = 625 per call
    expect(r.durations[4]).toHaveLength(300);
  });
});
