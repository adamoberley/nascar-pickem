# Admin Onboarding Checklist

## One-time Setup

1. Sign in to the web app using your email.
2. Create your league and invite code.
3. Share the invite code with players.
4. Click **Refresh Data Now** to load schedule/standings.
5. Confirm upcoming race and tier lists appear.

## Weekly Workflow (5 minutes)

1. Before lock:
   - Open Admin tab
   - Check Pick Monitoring (submitted vs missing)
2. After race:
   - Confirm race points synced
   - Verify standings updated
3. If points are wrong/missing:
   - Use Manual Results Override
4. If a penalty/correction is announced later:
   - Add adjustment
   - Scores and ranks update automatically

## What is Automatic

- Picks lock at race start time
- Tier generation from latest standings snapshots
- Weekly score recomputation
- Season leaderboard updates
- Scheduled data refresh and post-race re-checks

## Manual Fallbacks

- `Refresh Data Now` — Ingest schedule, standings, and results from provider.
- `Sync Live Race` — During an in-progress race, pull running order from NASCAR.com live feed.
- `Manual Results / Override` — Override race points when automatic sync fails.
- `Add Penalty / Correction` — Add adjustments; scores and ranks update automatically.
