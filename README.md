# Fair Middle

Meet where the **time** is fair, not the distance.

Everyone splits the distance. Fair Middle splits the time: it finds the meeting point that minimises the *longest* commute in the group, shows a fairness heatmap and a receipt comparing it to the geographic middle, and ranks real cafés and restaurants there by door-to-door travel time.

**Live:** https://fair-middle.vercel.app (Vercel + Neon Postgres, free OSRM routing)

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

**Rules (Phase 2):** a travel-time cap for everyone, "within a short walk of a metro station" (274 Delhi Metro stations from Wikidata), and venue types. When no spot satisfies every rule the solver relaxes them in a fixed order and the receipt says which rule was dropped. Anyone on metro / bus pulls candidate spots toward stations.

**Why not here?** Click anywhere on the map (including on a shared plan) to score that point for the whole group. Coordinates stay on the server.

**One link for the group (Phase 3):** the organiser creates a plan and shares a link. Each friend adds their own start privately (only their travel time is visible to the others), the fair spot re-solves in the background as people join, the top three places show the **fairness price of each vote** ("costs Priya +12 min"), friends vote, the organiser confirms, and the plan ships to WhatsApp with a generated card (`/g/<id>/card.png`, also used as the link preview). No accounts: organiser and participant identities are httpOnly cookie tokens, hashed at rest.

**Departure time and traffic:** set `TRAVEL_PROVIDER=google` with a Routes API key to get per-mode, traffic- and schedule-aware times; the "Leave at" selector and the compare-across-the-day panel light up. With OSRM, times are free-flow and non-car modes are estimates.

## Layout

```
lib/solver        pure solver: candidates, objective, 3-pass pipeline (+ tests)
lib/providers     TravelTimeProvider (OSRM, Google Routes, cached), VenueProvider chain, geocoder
lib/metro.ts      Delhi Metro stations (lib/data), nearest-station helpers
lib/cache         in-memory cache behind an interface (Redis-ready)
lib/store         Store interface: SQLite (node:sqlite) locally, Postgres (Neon driver) on serverless
app/api           /solve, /geocode, /groups (create), /groups/[id] (+ join, vote, confirm, solve, inspect)
app/g/[id]        group page (join, vote, confirm, share), card.png and OpenGraph image
lib/group.ts      group lifecycle: create, join, background re-solve, vote, confirm, public view
components        Planner (home), GroupPage, MapView (MapLibre), Receipt
```

## Deploy

Vercel: `vercel deploy --prod`. Attach a Postgres database (Neon via the Vercel Marketplace works out of the box); the app switches from the local SQLite file to Postgres whenever `DATABASE_URL` or `POSTGRES_URL` is set. Set `TRAVEL_PROVIDER=google` and `GOOGLE_MAPS_API_KEY` for traffic-aware, per-mode times.

Keys stay server-side. Shared plans expose each person's *travel time*, never their start location, and expire after 7 days.

See `docs/ARCHITECTURE.md` (and `docs/PM-BRIEF.md`; the original single-file prototype is `docs/prototype-v0.html`) for the phase plan (modes and traffic, time-of-day heatmap, account-free group flow, commute credit).
