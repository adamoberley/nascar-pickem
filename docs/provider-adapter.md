# Provider Adapter Contract

The ingestion layer uses `NascarDataProvider` (`functions/src/provider.ts`).

## Required Methods

- `fetchSchedule(seasonYear)`
- `fetchStandings(seasonYear)`
- `fetchRaceResult(raceKey, seasonYear)`

## HTTP Adapter Endpoints

Set `NASCAR_PROVIDER_BASE_URL` and implement:

- `GET /schedule?seasonYear=YYYY`
- `GET /standings?seasonYear=YYYY`
- `GET /results/{raceKey}?seasonYear=YYYY`

## Schedule Response Example

```json
[
  {
    "id": "2026-daytona-500",
    "name": "Daytona 500",
    "track": "Daytona International Speedway",
    "weekIndex": 1,
    "startTimeIso": "2026-02-16T19:30:00.000Z",
    "status": "scheduled"
  }
]
```

## Standings Response Example

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

## Results Response Example

```json
{
  "raceKey": "2026-daytona-500",
  "status": "completed",
  "points": [
    {
      "providerDriverKey": "kyle-larson",
      "points": 40
    }
  ]
}
```
