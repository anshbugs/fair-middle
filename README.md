# Fair Middle

Meet where the **time** is fair, not the distance.

Everyone splits the distance. Fair Middle splits the time: it finds the meeting point that minimises the *longest* commute in the group, shows a fairness heatmap and a receipt comparing it to the geographic middle, and ranks real cafés and restaurants there by door-to-door travel time.

## Run it

```bash
npm install
cp .env.example .env.local   # optional; defaults work without it
npm run dev
```

Open http://localhost:3000, hit **Load Delhi demo**, then **Find the fair spot**. No API keys needed: travel times come from OSRM (OpenStreetMap), venues from Overpass / Nominatim / Photon.

```bash
npm test          # solver unit tests (synthetic city with a "river" penalty)
```

## How it works

1. **Pass 1:** a 9×9 grid over the group's area plus the geographic centroid; one travel-time matrix call per travel mode.
2. **Pass 2:** a finer 7×7 grid around the winner.
3. **Pass 3:** real venues within 1.5 km of the fair point, re-ranked by the same objective.

Objectives: `minimax` (default, minimise the worst commute) and `total`.

## Layout

```
lib/solver        pure solver: candidates, objective, 3-pass pipeline (+ tests)
lib/providers     TravelTimeProvider (OSRM, cached), VenueProvider chain, geocoder
lib/cache         in-memory cache behind an interface (Redis-ready)
lib/db.ts         SQLite via node:sqlite; groups, participants, results
app/api           /solve, /geocode, /groups/[id]
app/g/[id]        share page (travel times only, never coordinates)
components        Planner, MapView (MapLibre), Receipt
```

Keys stay server-side. Shared plans expose each person's *travel time*, never their start location, and expire after 7 days.

See `docs/ARCHITECTURE.md` (and `docs/PM-BRIEF.md`; the original single-file prototype is `docs/prototype-v0.html`) for the phase plan (modes and traffic, time-of-day heatmap, account-free group flow, commute credit).
