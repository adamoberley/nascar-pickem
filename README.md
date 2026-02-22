# NASCAR Pick'Em (Firebase + SwiftUI + Web)

Private season-long NASCAR Pick'Em platform for ~20–21 users with:
- **iOS app** (SwiftUI) in `ios/Nascar Pick'Em/`
- **Web app** (React + Vite) for players and admins — responsive, works on Android and desktop
- **Firebase backend** — Auth, Firestore, Cloud Functions, scheduled jobs

**Requirements:** Node.js ≥ 20 (see `package.json` engines).

**Live site:** https://nascar-pick-em.web.app (Firebase Hosting). Deploy with `npm run deploy`.

## What This Project Includes

- Firestore schema aligned with your weekly game rules (3A / 2B / 1C)
- Callable + scheduled Cloud Functions for:
  - league join/create
  - pick save validation + lock behavior
  - scoring + season ranks
  - ingestion adapter and scheduled refresh jobs
  - race-week and lock-window missing-pick reminders
  - manual admin overrides + penalties/adjustments
- Firestore Security Rules enforcing role access and lock-time pick restrictions
- Web app with player flows and admin operations
- SwiftUI iOS client source for player flows

## Repository Layout

| Path | Description |
|------|-------------|
| `functions/` | Firebase Cloud Functions (TypeScript). Vitest for unit tests. |
| `web/` | React + Vite web app (mobile responsive). Views in `web/src/views/`; Playwright E2E in `web/tests/`. |
| `shared/` | Shared TypeScript (callables, types) used by functions and web |
| `ios/Nascar Pick'Em/` | SwiftUI iOS app (Xcode project and source) |
| `docs/` | Project documentation (see [docs/README.md](docs/README.md)) |
| `scripts/` | `setup-env.js`, `init-db.js` |
| `firestore.rules` | Firestore access control |
| `firestore.indexes.json` | Firestore query indexes |
| `firebase.json` | Firebase deployment config |

## Data Model (Firestore)

Collections and docs:
- `leagues/{leagueId}`
- `leagues/{leagueId}/members/{userId}`
- `leagues/{leagueId}/races/{raceId}`
- `leagues/{leagueId}/drivers/{driverId}`
- `leagues/{leagueId}/standingsSnapshots/{snapshotId}`
- `leagues/{leagueId}/tiers/{raceId}`
- `leagues/{leagueId}/picks/{raceId_userId}`
- `leagues/{leagueId}/racePoints/{raceId}`
- `leagues/{leagueId}/adjustments/{adjustmentId}`
- `leagues/{leagueId}/weeklyScores/{raceId_userId}`
- `leagues/{leagueId}/seasonScores/{userId}`

Penalty rule implemented in scoring:
- `finalPointsApplied = max(0, basePoints + sum(deltaPoints))`

## Cloud Functions Implemented

Core behavior:
1. Compute tiers from latest standings snapshot (`computeRaceTiers`; next-race tier only).
2. Auto-lock picks by lock time (`lockPicksAtRaceStart` every 30 minutes on Sunday).
3. Scheduled weekly ingest (`ingestLeagueDataDaily`) and weekly result refresh (`refreshRaceResults`) from NASCAR CF feeds.
4. Live race sync from NASCAR.com via callable (`syncLiveRaceNow`) using live stage points plus lap/position metadata.
5. Re-score races when lock cycles, manual live sync, result refresh, or admin updates change race data.
6. Recompute season totals/rank as part of each race re-score.
7. Admin callables:
   - `manualUpsertRacePoints`
   - `addAdjustment`
   - `manualRefreshData`
   - `updateLeagueSettings`
   - `updateMemberPaidStatus`
   - `syncLiveRaceNow` (trigger live NASCAR stage-points sync during a race)

Player/admin callables:
- `createLeague`
- `joinLeagueByInvite`
- `savePick`
- `upsertPushToken`
- `removePushToken`

## NASCAR Data Ingestion

Ingest is now direct from NASCAR CF endpoints (no provider adapter required):

- **Schedule + race metadata:** `race_list_basic.json`
- **Standings:** `racinginsights-points-feed.json`
- **Completed-race results/points:** `weekend-feed.json`
- **Live race scoring:** `live-stage-points.json` for in-race points, with `live-feed.json` for lap/stage/position metadata

See [docs/race-results-sources.md](docs/race-results-sources.md).

## Web App

**Typography:** Racer Italic (display/race titles), Barlow Condensed, Source Sans 3. Font assets in `web/src/assets/fonts/`. Styles: `app.css` → `tokens.css`, `app-core.css`.

### Features

Player features:
- Email/password sign-in and account creation
- Join private league with invite code
- Home: next race, lock countdown, pick status
- Picks: tiered selection with validation and save (frontend also hard-locks when lock time passes, even if backend lock is delayed)
- Standings: season leaderboard, sprint (monthly segment) leaderboard, player weekly breakdown
- Race: select any race to view results, your scored picks with adjusted tags, and live leaderboard during races

Admin features:
- League settings (name, season year, payout notes)
- Member paid/unpaid toggles
- Submission monitor (who has/hasn't picked)
- Manual data refresh
- Sync live race (trigger NASCAR.com stage-points sync during in-progress races)
- Manual race point override
- Add penalties/corrections

## iOS App (SwiftUI)

Source lives in `ios/Nascar Pick'Em/`:
- Auth (sign in / create account)
- League join/create
- Tabs: Home, Picks, Standings, Race, Admin (Admin tab visible to league admins only)
- Firestore listeners and callable integration

To run on iOS:
1. Open `ios/Nascar Pick'Em/Nascar Pick'Em.xcodeproj` in Xcode.
2. Add Firebase iOS SDK packages (Swift Package Manager):
   - `FirebaseAuth`
   - `FirebaseFirestore`
   - `FirebaseFunctions`
   - `FirebaseCore`
   - `FirebaseMessaging` (required for push reminders)
3. Add your `GoogleService-Info.plist` from Firebase Console (Project settings → Your apps → iOS) to the app target.
4. Build and run on a simulator or device.

Push reminder prerequisites (iOS):
- Enable **Push Notifications** capability in the iOS target.
- Upload APNs key/cert in Firebase Console (Project settings → Cloud Messaging).

Reminder channel controls (Cloud Functions env):
- `ENABLE_PUSH_REMINDERS=1` (default on unless set to `0`)
- `ENABLE_EMAIL_REMINDERS=1` (off by default)
- `REMINDER_EMAIL_FROM=...` (optional sender when email reminders are enabled)

Email reminders use a Firestore `mail` queue document format compatible with the Firebase **Trigger Email** extension.

## Testing

```bash
# Unit tests (functions + web, Vitest)
npm run test

# Typecheck only
npm run lint

# End-to-end flow (web, Playwright)
E2E_EMAIL=you@example.com \
E2E_PASSWORD=secret \
E2E_INVITE_CODE=RACER-2026 \
npm run test:e2e
```

E2E tests require a deployed app or local dev server. See `web/tests/` and `web/playwright.config.ts`.

## Single-League Beta Preflight

Use this before inviting real players to the 2026 beta league:

1. Quality gates:
   ```bash
   npm run lint
   npm run test
   npm run build --workspaces
   ```
2. Deploy backend + web:
   ```bash
   npm run deploy
   ```
3. Create one league from web admin and copy its invite code.
4. Run one full player flow with a non-admin account:
   - sign in
   - join league by invite code
   - submit picks for the next unlocked race
5. Run one admin flow:
   - refresh data
   - open pick monitoring
   - toggle one member paid status
6. Confirm iOS client flows against the same league:
   - league preview by invite code
   - join league
   - picks load/save
7. Optional E2E smoke check:
   ```bash
   E2E_EMAIL=you@example.com \
   E2E_PASSWORD=secret \
   E2E_INVITE_CODE=RACER-2026 \
   npm run test:e2e
   ```

## Setup and Deploy

Detailed steps: [docs/setup-checklist.md](docs/setup-checklist.md). Quick path:

### 1. Firebase project

Create a project and enable: **Authentication** (Email/Password), **Firestore**, **Functions**, **Hosting**, **Scheduler** (Blaze plan for scheduled functions).

### 2. Project ID

Edit `.firebaserc` and set `default.project` to your Firebase project ID.

### 3. Environment variables

```bash
npm run setup:env   # copies .env.example → .env if missing
```

Edit `.env` in the repo root and set the `VITE_FIREBASE_*` values from Firebase Console → Project settings → Your apps (web).

### 4. Install and build

```bash
npm install
npm run build --workspaces
```

### 5. Deploy

```bash
npm run deploy
# or: firebase deploy
```

### 6. Local web dev

```bash
cd web && npm run dev
```

## Admin onboarding

See [docs/admin-onboarding.md](docs/admin-onboarding.md). Summary:

1. Sign in to the web app → Create league → Share invite code.
2. Click **Refresh Data Now** once to seed schedule and standings.
3. Weekly: check Pick Monitoring before lock; after the race, verify scores. Use **Add Penalty / Correction** when needed; totals and ranks update automatically.

## Documentation

| Doc | Description |
|-----|-------------|
| [AGENTS.md](AGENTS.md) | AI/agent workflow: minimal file map, fast commands, gotchas |
| [docs/README.md](docs/README.md) | Index of all documentation |
| [docs/setup-checklist.md](docs/setup-checklist.md) | Full setup and deploy steps |
| [docs/GETTING-FULLY-WORKING.md](docs/GETTING-FULLY-WORKING.md) | Zero-to-playable 2026 league (NASCAR CF direct feeds) |
| [docs/admin-onboarding.md](docs/admin-onboarding.md) | Admin workflow and weekly routine |
| [docs/provider-adapter.md](docs/provider-adapter.md) | Deprecated provider-adapter note |
| [docs/race-results-sources.md](docs/race-results-sources.md) | NASCAR CF standings/schedule/results/live feed URLs |
| [docs/index-setup.md](docs/index-setup.md) | Firestore composite index setup |
| [docs/add-members-userid-index.md](docs/add-members-userid-index.md) | Collection group index on members by userId |
| [docs/firestore-rules-review.md](docs/firestore-rules-review.md) | Firestore security rules review |
| [STYLEGUIDE.md](STYLEGUIDE.md) | UI and code style for web/iOS |

## Notes

- Security rules enforce player/admin boundaries and post-lock edit prevention.
- With ~20 users, full re-score and rank recomputation is inexpensive and reliable.
- Scheduled re-check catches delayed post-race penalties as long as NASCAR feeds reflect them.
