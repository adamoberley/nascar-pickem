# Race Results & Standings Sources (NASCAR CF Only)

The app now uses NASCAR CF feeds directly for schedule, standings, completed-race scoring, and live scoring.

## Standings (weekly tiers)

- URL pattern: `https://cf.nascar.com/data/cacher/production/{year}/1/racinginsights-points-feed.json`
- Example: `https://cf.nascar.com/data/cacher/production/2026/1/racinginsights-points-feed.json`
- Used for:
  - `drivers` upsert (name, number, manufacturer/team, `nascarDriverId`)
  - `standingsSnapshots` write
  - tier recomputation for the next race only (stale tier docs are removed)

## Schedule & race metadata

- URL pattern: `https://cf.nascar.com/cacher/{year}/1/race_list_basic.json`
- Example: `https://cf.nascar.com/cacher/2026/1/race_list_basic.json`
- Used for:
  - points-race filtering (`race_type_id == 1`)
  - race docs (`name`, `track`, `weekIndex`, `nascarRaceId`, `tvChannel`)
  - race matching fallback by name/date when a race doc is missing `nascarRaceId`

## Completed-race results (official)

- URL pattern: `https://cf.nascar.com/cacher/{year}/1/{race_id}/weekend-feed.json`
- Example: `https://cf.nascar.com/cacher/2026/1/5596/weekend-feed.json`
- Used for:
  - `officialResults` on `racePoints`
  - `drivers[].basePoints` from `points_earned` (or fallback finish+stage composition)
  - post-race re-score and race status completion

## Live race scoring

- Live feed: `https://cf.nascar.com/live/feeds/live-feed.json`
- Stage feed: `https://cf.nascar.com/cacher/{year}/1/{race_id}/live-stage-points.json`
- Used for:
  - in-race driver points (running position + stage points)
  - lap/stage metadata in UI

## Optional/auxiliary feeds

These are not required for scoring but can be used for enrichment:

- `https://cf.nascar.com/cacher/drivers.json`
- `https://cf.nascar.com/live-ops/live-ops.json`
- `https://cf.nascar.com/data/cacher/production/live/current-results.json`
- `https://cf.nascar.com/cacher/{year}/1/final/1-owners-points.json`
- `https://cf.nascar.com/cacher/{year}/1/final/1-manufacturer-points.json`
