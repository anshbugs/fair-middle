# Fair Middle — phase-wise architecture

Companion to `PM-BRIEF.md`. Phase 0 is the prototype in `prototype-v0.html`. Each later phase is independently shippable and adds one capability the PM story needs. Nothing in a phase depends on a later one.

---

## Guiding constraints

- **Travel-time calls are the cost centre.** Every design choice minimises matrix elements (origins × destinations) and caches aggressively.
- **Locations are sensitive.** Friends see each other's *travel times*, never each other's coordinates.
- **Providers are swappable.** Travel time, venues, geocoding and isochrones each sit behind an interface so the free OSM stack and the paid Google stack can coexist (dev on free, prod on paid, fall back on outage).
- **No accounts until Phase 3.** A group is a link.

---

## Phase 0 — Prototype (done)

Single `index.html`: Leaflet + OSM tiles, OSRM `/table` for travel-time matrices, Overpass → Nominatim → Photon chain for venues, minimax solver in the browser, fairness receipt, heatmap, Delhi demo.

Known limits: free-flow times only, driving only, public servers rate-limit, nothing is shareable, keys cannot be used safely from a static page.

---

## Phase 1 — Productised core

**Goal:** same experience, but reliable, shareable, and ready for paid providers.

### Stack
| Layer | Choice | Why |
|---|---|---|
| Web | Next.js (App Router) + TypeScript, MapLibre GL | SSR for share pages, one repo for UI + API |
| API | Next.js route handlers on Vercel (or Cloudflare Workers) | Keeps provider keys server-side |
| Cache | Upstash Redis (or Vercel KV) | Matrix results, geocodes, venue lists |
| DB | Postgres (Supabase / Neon) | Groups, participants, results |
| Routing (dev) | OSRM public or self-hosted | Free |
| Routing (prod) | Google Routes API `computeRouteMatrix` | Traffic-aware, transit, walking |
| Venues (prod) | Google Places API (Nearby Search, New) | Coverage, hours, ratings |
| Venues (dev) | Overpass / Nominatim | Free |

### Modules
```
/lib
  solver/            pure functions, no I/O
    candidates.ts    bbox → coarse grid → refined grid; haversine pruning
    objective.ts     minimax | total | p90 | constrained
    rank.ts          score candidates and venues; ties → total → distance-to-metro
  providers/
    travelTime/      TravelTimeProvider: osrm.ts, googleRoutes.ts, cached.ts (decorator)
    venues/          VenueProvider: overpass.ts, googlePlaces.ts
    geocode/         GeocodeProvider: nominatim.ts, googleGeocode.ts
  cache/             key builders + TTLs
/app
  api/solve          POST: participants[] → result (runs the 3-pass pipeline)
  api/geocode        GET
  g/[groupId]        share page (SSR, reads result from DB)
```

### Interfaces
```ts
interface TravelTimeProvider {
  matrix(origins: LatLng[], dests: LatLng[], opts: { mode: Mode; departAt?: Date }): Promise<Seconds[][]>;
  maxElements: number;                    // per-call budget (OSRM demo 100 coords; Google 625 elements)
}
interface VenueProvider {
  near(pt: LatLng, radiusM: number, kinds: VenueKind[], limit: number): Promise<Venue[]>;
}
```

### Solve pipeline (server)
1. Validate 2–8 participants, resolve any unresolved addresses (geocode cache first).
2. **Pass 1 (coarse):** bbox padded 25 %, 9×9 grid + centroid. One matrix call per *mode group* (all drivers in one call, all transit riders in another). Prune grid points whose straight-line lower bound (distance / 80 km h⁻¹) already exceeds the current best worst-case.
3. **Pass 2 (fine):** 7×7 around the winner at half cell size.
4. **Pass 3 (venues):** fetch ≤ 25 venues around the winner, one matrix call participants × venues, rank by objective.
5. Persist `Result { fairPoint, centroid, perPersonTimes, venues[], heat[] }` and return.

Element budget per solve (3 people, 1 mode): 3×82 + 3×49 + 3×25 ≈ 470 elements. With Google Routes matrix pricing this is cents, not dollars, and caching cuts repeat solves to near zero.

### Caching keys
- Matrix cell: `tt:{provider}:{mode}:{departBucket15min}:{originGeohash7}:{destGeohash7}` TTL 24 h (free-flow) / 1 h (traffic).
- Geocode: `geo:{normalisedQuery}` TTL 30 d.
- Venues: `venue:{provider}:{geohash6}:{kinds}` TTL 7 d.

### Data model (Phase 1)
```
groups(id, created_at, objective, constraints jsonb, expires_at)
participants(id, group_id, display_name, lat, lon, mode, depart_at)      -- lat/lon never leave the server
results(id, group_id, computed_at, fair_point, centroid, receipt jsonb, venues jsonb, heat jsonb)
```

### Non-functional
- Rate limit `/api/solve` per IP and per group (sliding window in Redis).
- Timeouts + fallback: Google → OSRM on 5xx; Places → Overpass.
- Playwright smoke test on the Delhi demo; unit tests on the solver with a recorded matrix fixture.

**Exit criteria:** share link works, solve p95 < 4 s warm, zero keys in the client bundle.

---

## Phase 2 — Modes, time, and explanation

**Goal:** the demo moments that make the product look smart.

### 2a. Per-person mode and departure time
- Participant gets `mode ∈ {drive, two_wheeler, transit, walk, cab}` and `departAt`.
- Matrix calls grouped by mode; `departAt` passed to Routes API for traffic and transit schedules.
- Two-wheeler: Routes API `TWO_WHEELER` where supported, else drive × 0.85 (flagged as estimate).

### 2b. Time-of-day heatmap ("the fair zone moves")
- Precompute Pass 1 for 6 departure buckets (08, 11, 14, 17, 20, 23). Six coarse matrices, cached.
- UI scrubber animates the heatmap and fair point across the day. This is the single most visual feature; build it as a share-able GIF/MP4 for the portfolio.

### 2c. Constraints engine
- Hard: `maxMinutesAnyone`, `nearMetro ≤ 500 m`, `openAt`, `venueKinds`, `priceLevel`.
- Soft (tie-breakers): metro proximity, rating, total time.
- Implementation: filter candidates/venues before ranking; if infeasible, relax in a documented order and tell the user which constraint was dropped.

### 2d. Metro snapping (Delhi first)
- Static dataset of Delhi Metro stations (DMRC GTFS or OSM `railway=station` + `station=subway`).
- When any participant is transit, bias Pass 2 grid to station locations and surface "2 min walk from Rajiv Chowk" in the receipt.

### 2e. Click-to-inspect ("why not here?")
- Click any map point → one matrix call participants × 1 point → mini receipt. Cached per geohash7.

### 2f. Isochrone overlay
- Provider: OpenRouteService isochrones (free tier) or self-hosted Valhalla; Mapbox Isochrone as paid option.
- Draw each person's N-minute polygon; the intersection is the fair zone. Purely visual; the solver stays matrix-based.

---

## Phase 3 — Group flow without accounts

**Goal:** the inviter sends one link; everyone contributes privately; the group converges.

### Flow
1. Inviter creates group → `/g/{id}` with a 7-day expiry and an organiser token (cookie).
2. Each invitee opens the link, enters their own location + mode. Server stores coords; the page shows only names and "ready" state.
3. Solve runs when ≥ 2 ready; re-runs on each new participant (debounced).
4. Top 3 venues shown with **fairness cost of each vote**: "picking Cafe Museo costs Priya +12 min".
5. Vote → organiser confirms → **WhatsApp share card** (server-rendered OG image: venue, time, per-person minutes, map thumbnail).

### Components
- Realtime: Supabase Realtime (Postgres changes) or polling every 5 s; no websockets infra of our own.
- Share card: `@vercel/og` (Satori) → PNG at `/g/{id}/card.png`; static map thumbnail from MapLibre server render or Google Static Maps.
- Privacy: coordinates column encrypted at rest; participant rows deleted at expiry; share card never includes origins.

### Data model additions
```
votes(group_id, participant_id, venue_id, created_at)
events(group_id, type, payload jsonb, created_at)   -- analytics for the metrics in PM-BRIEF
```

---

## Phase 4 — Memory and intelligence

**Goal:** fairness across time, not just within one meetup. This is the moat.

### 4a. Commute credit ledger
- Persistent *crew* (opt-in, magic-link auth). Each meetup records per-person minutes.
- Ledger: `credit_i = Σ(minutes_i − mean_minutes)` over the last N meetups.
- Objective becomes `minimax(minutes_i − w·credit_i)`: whoever has been eating long trips gets the spot pulled toward them. Expose `w` as "balance across meetups: off / gentle / strict".

### 4b. Post-meetup calibration
- One-tap "how long did it really take?" → ratio of actual to predicted per (mode, hour bucket, area). Apply as a correction factor; show "times adjusted from 38 past trips".

### 4c. Safe return
- For late departures: last-metro time per station (GTFS), prefer venues ≤ 500 m from a station with a train after the planned end time; optionally flag well-lit main roads (OSM `lit=yes`, `highway=primary/secondary` density).
- Receipt gains a "getting home" row.

### 4d. Cost fairness
- Cab fare estimate per person (distance × city tariff table, surge-agnostic) so the receipt shows time *and* money. Optional objective: minimise the worst *cost* instead.

---

## Phase 5 — Scale, cost, and operations

- **Self-hosted routing for India:** OSRM or Valhalla on a small VM with the India OSM extract (~2 GB PBF) for driving; keep Google for transit and traffic only. Cuts matrix cost by > 80 %.
- **Cost model:** Routes API matrix elements per solve × solves/day; alert when daily spend > budget. Cache hit rate is the KPI.
- **Observability:** OpenTelemetry traces per solve (pass timings, provider, cache hits), Sentry for errors, PostHog for product events (activation, venue pick, repeat).
- **Experiments:** objective default (minimax vs total), heatmap on/off, receipt wording.
- **Multi-city:** metro datasets and tariff tables per city behind a `cityPack` config; Bengaluru and Mumbai next.
- **Content engine:** nightly job computes a city "unfairness index" (average gap between centroid and fair worst-case over sampled trios) for blog/social.

---

## Cross-cutting

### Solver details
- Candidate pruning: for candidate c, lower bound `max_i haversine(p_i, c) / v_max`. Skip if ≥ current best; typically removes 30–50 % of grid points before the matrix call.
- Degenerate groups (all within 2 km): skip grids, go straight to venues within 1.5 km of the centroid.
- Unreachable cells (null durations): drop candidate; if a participant is unreachable from everywhere, surface it as an input error.
- Objectives: `minimax` (default), `total`, `p90` for groups > 6, `lexmin` (minimise worst, then second worst…) as the strict-fairness option.

### Security and privacy
- Keys server-side only; Google key restricted by API and referrer/IP.
- Group IDs are 128-bit random; organiser actions need the organiser token.
- Coordinates encrypted at rest, purged at expiry; logs never contain coordinates.

### Testing
- Solver: deterministic unit tests on fixture matrices (Delhi demo recorded).
- Providers: contract tests against recorded HTTP cassettes; a nightly live canary.
- E2E: Playwright on the demo, share link, and vote flow.

### Rough effort (one PM-builder, part time)
| Phase | Weeks |
|---|---|
| 1 | 2–3 |
| 2 | 2–3 (2b and 2e first) |
| 3 | 2 |
| 4 | 3+ (4a first) |
| 5 | ongoing |

For the portfolio, Phase 1 + 2b + 2e + the Phase 3 share card is the sweet spot: shareable, visibly intelligent, and every screen tells the fairness story.
