# Fair Middle — PM brief

**One line:** Everyone splits the distance. Fair Middle splits the *time*, which is the thing people actually feel.

## 1. The problem (and why it is real)

- Groups pick a meeting spot by eyeballing the map or deferring to the loudest person. One person reliably eats a 60 to 90 minute commute.
- The geographic middle is a bad proxy in any city shaped by rivers, ring roads, expressways and one-ways. In Delhi NCR a Yamuna crossing, a stretch of NH48 or the absence of a direct road can double one person's time while the map says "halfway".
- Existing tools (WhatsHalfway, MeetWays, Google Maps' shared lists) all compute a *distance* midpoint or a straight-line centroid. None explain *why* their answer is fair, and none re-rank the actual venue by door-to-door time.

Evidence to collect before/while building: 10 to 15 short interviews with people who organise friend or team meetups weekly ("tell me about the last time you picked a place"), plus a count of how often one person's commute was more than 1.5x the next longest. Target metric for the problem: share of meetups where the longest commute exceeded 45 min.

## 2. The insight

Fairness is about **time**, not distance, and people judge fairness by the **worst-off person**, not the average. So the objective is minimax: pick the spot that minimises the longest commute. (The app also offers "minimise total time" so the trade-off is visible, which is itself a good interview talking point.)

## 3. What the prototype does (built, working)

1. Each person drops a start location (search or pin on map).
2. It samples ~80 candidate points across the group's area and gets live road travel times for every person to every candidate (one routing matrix call), then refines around the winner.
3. It picks the spot that minimises the worst commute and shows a **fairness heatmap** so you can see the fair zone, not just a pin.
4. It pulls real cafés and restaurants around that spot and **re-ranks the venues by actual travel time**, so the recommendation is a place, not a coordinate.
5. The **fairness receipt** compares each person's time at the recommended spot vs the geographic middle and names who the "obvious" middle would have punished.

Stack: single HTML file, Leaflet + OpenStreetMap tiles, OSRM for travel-time matrices, Overpass / Nominatim / Photon for venues. No API keys, so it runs anywhere. Google Distance Matrix + Places is the production path (transit and walking modes, traffic-aware departure times); the code isolates travel-time and venue providers so that swap is contained.

## 4. What makes it unique

- **Minimax by time**, not centroid by distance.
- **Explains itself**: the receipt and heatmap show *why* the answer is fair, which is what converts a sceptical group.
- **Venue-level fairness**: ranks real places by door-to-door time instead of dropping a pin in a park.
- **Mixed modes per person** (roadmap): the metro rider and the driver get their own travel-time models, which is where the geographic middle fails worst.

## 5. Scope

In (v0): 2 to 6 people, road travel time, minimax / total objectives, heatmap, venue re-ranking, fairness receipt, Delhi demo.
Out (v0): accounts, group chat / voting, calendar, live traffic, transit, opening hours, ratings.

## 6. Success metrics

- Activation: % of sessions that reach a recommendation (target > 70%).
- Core value: median reduction in worst commute vs geographic middle (report in minutes; demo shows the receipt).
- Trust: % of groups that pick one of the top 3 suggested venues.
- Retention proxy: repeat sessions per inviter within 30 days.

## 7. Risks and honest caveats

- Free-flow road times understate peak-hour Delhi traffic; with Google's traffic-aware matrix the fairness gap gets *bigger*, not smaller.
- Public OSM servers rate-limit; the prototype has timeouts and fallbacks but a production build needs paid APIs or self-hosted OSRM.
- Fairness by time can push the meeting far from everyone's home turf; a "max 40 min for anyone" constraint plus a "closest to a metro station" tie-breaker is the natural v1.

## 8. Demo script (90 seconds)

1. "Three friends: Dwarka, Indirapuram, Saket. Where do you meet?" Most people point at central Delhi.
2. Load demo, hit Find. Heatmap appears: the fair zone is a band, not a dot.
3. Read the receipt: the geographic middle makes Rahul drive 32 min and Priya 30; the fair spot brings everyone to 23 min or less and the spread from 17 min to 7. (Live numbers on 2026-11-14, free-flow traffic.)
4. Scroll venues: "these are ranked by the longest commute, measured door to door."
5. Switch the rule to "minimise total" and show the trade-off: total goes down, one person's commute goes up. "That's the product decision. I chose the worst-off person."

## 9. Interview line

"Everyone splits the distance. I split the time, which is the thing people actually care about. And I show the group the receipt, because a fair answer nobody believes is not a fair answer."
