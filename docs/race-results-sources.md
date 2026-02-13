# Race Results & Standings Data Sources

The app can sync race results and driver standings from an external provider (see [provider-adapter.md](./provider-adapter.md)). We don’t use a paid API—data is either **built-in** (2026 schedule, standings, Clash result) or **scraped** from the web. The URLs below are what you’d scrape (NASCAR.com and ESPN) and how they map to the provider contract.

---

## Standings

Driver standings are used to populate each league’s driver list (name, number, team, position) and to set `providerDriverKey` so that race results can be matched to drivers.

### NASCAR.com Cup Series Standings

- **URL:** https://www.nascar.com/standings/nascar-cup-series/
- **Other series:** Replace path with `nascar-xfinity-series` or `nascar-craftsman-truck-series`.

Table columns include: **POS**, **NO.** (car number), **DRIVER**, **MFR** (manufacturer: Chevrolet, Toyota, Ford), **POINTS**, **BEHIND**, **STARTS**, **WINS**, **TOP 5s**, **TOP 10s**, **DNFs**, **LAPS LED**, **PLAYOFF POINTS**. Driver names appear in the table (e.g. “Kyle Larson”); car number comes from the badge/NO. column. Team is not in the standings table—you can leave it blank or derive from another source.

### ESPN Racing Standings

- **URL:** https://www.espn.com/racing/standings  
- **Cup series:** Page defaults to Cup; season can be selected (2026, 2025, …).  
- **Other series:** e.g. `https://www.espn.com/racing/standings/_/series/xfinity` or `/_/series/truck`.

Table columns: **RK** (position), **DRIVER** (name, links to profile), **POINTS**, **WINS**, **POLES**, **TOP 5**, **TOP 10**. Driver links look like:  
`https://www.espn.com/racing/driver/_/id/4539/kyle-larson`  
The path segment `kyle-larson` is a good choice for `providerDriverKey` so it matches the same convention used in race results (lowercase hyphenated name).

Car number and team are not in the standings table; they can be scraped from driver profile pages or from race results (e.g. CAR column).

### Provider standings contract

Standings must be returned as an array of objects (see [provider-adapter.md](./provider-adapter.md)):

```json
[
  {
    "providerDriverKey": "kyle-larson",
    "name": "Kyle Larson",
    "number": "5",
    "team": "Hendrick Motorsports",
    "position": 1
  }
]
```

- **providerDriverKey** – Stable ID for the driver; must match the keys used in race result `points` (e.g. ESPN’s driver URL slug: `kyle-larson`).
- **name**, **number**, **team** – Display and tier logic. Number and team can be blank if not available from the source.
- **position** – Current standings position (1-based).

Using the same `providerDriverKey` convention for both standings and race results (e.g. lowercase hyphenated name from ESPN driver URLs) keeps driver matching consistent.

---

## Race Results

## NASCAR.com Live Results

- **Pattern:** `https://www.nascar.com/live-results/nascar-cup-series/{race-slug}?section=results`
- **Example (2026 Cook Out Clash):**  
  https://www.nascar.com/live-results/nascar-cup-series/2026-cook-out-clash-at-bowman-gray-stadium?section=results

Race slugs are typically the race name in lowercase with hyphens (e.g. `2026-cook-out-clash-at-bowman-gray-stadium`). Our schedule `providerRaceKey` values (e.g. `2026-cook-out-clash`) can be mapped to these slugs for lookup.

## ESPN Racing Results

### Season results index

- **URL:** https://www.espn.com/racing/results  
- Lists races with links to individual race result pages.

### Single race results

- **Pattern:** `https://www.espn.com/racing/raceresults/_/series/sprint/raceId/{raceId}`
- **Example (2026 Clash at Bowman Gray):**  
  https://www.espn.com/racing/raceresults/_/series/sprint/raceId/202602044256

ESPN uses a numeric `raceId` (e.g. `202602044256` for the Clash). The results page shows a table with:

| Column       | Description                    |
|-------------|--------------------------------|
| POS         | Finishing position             |
| DRIVER      | Name (links to driver profile) |
| CAR         | Car number                     |
| MANUFACTURER| Ford, Chevrolet, Toyota       |
| LAPS        | Laps completed                 |
| START       | Starting position              |
| LED         | Laps led                       |
| PTS         | NASCAR points (0 for Clash)   |
| BONUS       | Bonus points                   |
| PENALTY     | Penalty points                 |

Driver profile URLs look like:  
`https://www.espn.com/racing/driver/_/id/{driverId}/{name-slug}`  
(e.g. `id/4585/ryan-preece`).

### Mapping our race keys to ESPN raceId

When building a provider or scraping results, map our schedule `providerRaceKey` to the ESPN `raceId` for the same race. Example:

| Our providerRaceKey   | ESPN raceId   | Notes |
|-----------------------|---------------|--------|
| `2026-cook-out-clash` | `202602044256` | Clash at Bowman Gray |

Other 2026 raceIds can be discovered from the ESPN results index or race pages as the season progresses.

## Provider race result contract

Whatever source you use, the provider must return results in this shape (see [provider-adapter.md](./provider-adapter.md)):

```json
{
  "raceKey": "2026-cook-out-clash",
  "status": "completed",
  "points": [
    { "providerDriverKey": "ryan-preece", "points": 40 },
    { "providerDriverKey": "william-byron", "points": 35 }
  ]
}
```

- **raceKey** – Must match the schedule race `id` / `providerRaceKey` (e.g. `2026-cook-out-clash`).
- **status** – `"scheduled"` | `"locked"` | `"completed"`.
- **points** – One entry per driver that finished. `providerDriverKey` must match the league’s driver `providerDriverKey` (from standings ingest) so the backend can map to `driverId`. Typical convention: lowercase hyphenated name (e.g. `ryan-preece`).
- **points** value – Usually NASCAR-style: 1st = 40, 2nd = 35, 3rd = 34, 4th = 33, … (41 − position, min 1).

## Similar setup for other races

Other Cup races follow the same ideas:

1. **NASCAR.com** – Same URL pattern with the race-specific slug (e.g. `2026-daytona-500`, `2026-autotrader-400`).
2. **ESPN** – Same `/racing/raceresults/_/series/sprint/raceId/{raceId}` pattern; only `raceId` changes per race.

A custom provider (e.g. `NASCAR_PROVIDER_BASE_URL`) can implement `GET /results/{raceKey}?seasonYear=YYYY` by resolving `raceKey` + `seasonYear` to the correct NASCAR.com slug or ESPN `raceId`, then fetching and parsing that page (or an internal cache) and returning the JSON contract above.
