# Getting the App Fully Working

This checklist gets a 2026 league from zero to playable using direct NASCAR CF feeds.

## 1. Firebase setup

- Create/use a Firebase project.
- Enable: Authentication (Email/Password), Firestore, Cloud Functions, Hosting, Scheduler.
- In `.firebaserc`, set `default.project` to your project id.

## 2. Web environment

- Copy `.env.example` to `.env`.
- Set `VITE_FIREBASE_*` from Firebase Console.
- No `NASCAR_PROVIDER_BASE_URL` is needed.

## 3. Build and deploy

```bash
npm install
npm run build --workspaces
firebase deploy
```

## 4. Create a league

1. Open the hosted web app.
2. Sign in.
3. Create a league with `seasonYear = 2026`.

## 5. Seed NASCAR data

In Admin, click **Refresh Data Now**.

This will:

- pull schedule from `race_list_basic.json` (Cup points races only),
- pull standings from `racinginsights-points-feed.json`,
- upsert drivers + standings snapshot,
- compute tiers for the next race only (and remove stale tier docs),
- backfill completed-race results/points from `weekend-feed.json` for the full lookback window.

## 6. Live scoring

During an active race:

- admin can trigger **Refresh Live (NASCAR.com)** manually.

Live scoring uses:

- `live-stage-points.json` (in-race scoring points)
- `live-feed.json` (running order and lap/stage metadata only)

## 7. Share and play

- Share invite code.
- Players submit picks before lock.
- Race, standings, and season totals update from NASCAR feeds + app adjustments.

## Troubleshooting

- No drivers/tiers: run **Refresh Data Now** and confirm `seasonYear` matches the current NASCAR feed year.
- Missing completed-race points: rerun **Refresh Data Now** or wait for the weekly `refreshRaceResults` schedule.
- Live race not updating: verify NASCAR live feed is active and race doc has/receives `nascarRaceId`.
