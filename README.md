# NASCAR Pick'Em (Firebase + SwiftUI + Web)

Private season-long NASCAR Pick'Em platform for ~20–21 users with:
- **iOS app** (SwiftUI) in `ios/Nascar Pick'Em/`
- **Web app** (React + Vite) for players and admins — responsive, works on Android and desktop
- **Firebase backend** — Auth, Firestore, Cloud Functions, scheduled jobs

**Requirements:** Node.js ≥ 20 (see `package.json` engines).

**Live site:** https://nascar-pick-em.web.app (Firebase Hosting). Pushes to `main` auto-deploy via GitHub Actions.

## What This Project Includes

- Firestore schema aligned with your weekly game rules (3A / 2B / 1C)
- Callable + trigger + scheduled Cloud Functions for:
  - league join/create
  - pick save validation + lock behavior
  - scoring + season ranks
  - ingestion adapter and scheduled refresh jobs
  - manual admin overrides + penalties/adjustments
- Firestore Security Rules enforcing role access and lock-time pick restrictions
- Web app with player flows and admin operations
- SwiftUI iOS client source for player flows

## Repository Layout

| Path | Description |
|------|-------------|
| `functions/` | Firebase Cloud Functions (TypeScript) |
| `web/` | React + Vite web app (mobile responsive, admin role included) |
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
1. Compute tiers from latest standings snapshot (`computeRaceTiers`, plus snapshot trigger).
2. Auto-lock picks at race lock time (`lockPicksAtRaceStart`, scheduled every minute).
3. Scheduled ingestion (`ingestLeagueDataDaily`, `refreshRaceResults`) with swappable provider.
4. Re-score races on picks / race points / adjustments changes.
5. Recompute season totals and rank on weekly score updates.
6. Admin callables:
   - `manualUpsertRacePoints`
   - `addAdjustment`
   - `manualRefreshData`

Player/admin callables:
- `createLeague`
- `joinLeagueByInvite`
- `savePick`

## NASCAR Data Ingestion

Provider interface: `functions/src/provider.ts`. See [docs/provider-adapter.md](docs/provider-adapter.md) and [docs/race-results-sources.md](docs/race-results-sources.md).

- **Static fallback (default):** Built-in 2026 schedule, standings, and Cook Out Clash result. No external API needed.
- **HTTP adapter (optional):** Set `NASCAR_PROVIDER_BASE_URL` (and optionally `NASCAR_PROVIDER_TOKEN`) for a custom provider implementing the adapter endpoints (schedule, standings, results).

## Web App

**Typography:** Racer Italic (display/race titles), Barlow Condensed, Source Sans 3. Font assets in `web/src/assets/fonts/` and `web/public/fonts/`.

### Features

Player features:
- Email/password sign-in and account creation
- Join private league with invite code
- Home: next race, lock countdown, pick status
- Picks: tiered selection with validation and save
- Standings: season leaderboard + player weekly breakdown
- Race: race results + your scored picks with adjusted tags

Admin features:
- League settings (season year, payout notes)
- Member paid/unpaid toggles
- Submission monitor (who has/hasn't picked)
- Manual data refresh
- Manual race point override
- Add penalties/corrections

## iOS App (SwiftUI)

Source lives in `ios/Nascar Pick'Em/`:
- Auth (sign in / create account)
- League join/create
- Tabs: Home, Picks, Standings, Race
- Firestore listeners and callable integration

To run on iOS:
1. Open `ios/Nascar Pick'Em/Nascar Pick'Em.xcodeproj` in Xcode.
2. Add Firebase iOS SDK packages (Swift Package Manager):
   - `FirebaseAuth`
   - `FirebaseFirestore`
   - `FirebaseFunctions`
   - `FirebaseCore`
3. Add your `GoogleService-Info.plist` from Firebase Console (Project settings → Your apps → iOS) to the app target.
4. Build and run on a simulator or device.

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

Edit `.env` in the repo root and set the `VITE_FIREBASE_*` values from Firebase Console → Project settings → Your apps (web). Optional: `NASCAR_PROVIDER_BASE_URL` and `NASCAR_PROVIDER_TOKEN` for a custom data provider (see [docs/provider-adapter.md](docs/provider-adapter.md)).

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

**CI:** Pushes to `main` trigger GitHub Actions to build and deploy. Add `FIREBASE_TOKEN` (from `firebase login:ci`) in repo secrets. See [.github/workflows/deploy.yml](.github/workflows/deploy.yml).

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
| [docs/README.md](docs/README.md) | Index of all documentation |
| [docs/setup-checklist.md](docs/setup-checklist.md) | Full setup and deploy steps |
| [docs/GETTING-FULLY-WORKING.md](docs/GETTING-FULLY-WORKING.md) | Zero-to-playable 2026 league (no external provider) |
| [docs/admin-onboarding.md](docs/admin-onboarding.md) | Admin workflow and weekly routine |
| [docs/provider-adapter.md](docs/provider-adapter.md) | NASCAR data provider contract |
| [docs/race-results-sources.md](docs/race-results-sources.md) | Standings/results URLs (NASCAR.com, ESPN) |
| [docs/index-setup.md](docs/index-setup.md) | Firestore composite index setup |
| [docs/add-members-userid-index.md](docs/add-members-userid-index.md) | Collection group index on members by userId |
| [docs/firestore-rules-review.md](docs/firestore-rules-review.md) | Firestore security rules review |
| [STYLEGUIDE.md](STYLEGUIDE.md) | UI and code style for web/iOS |

## Notes

- Security rules enforce player/admin boundaries and post-lock edit prevention.
- With ~20 users, full re-score and rank recomputation is inexpensive and reliable.
- Scheduled re-check catches delayed post-race penalties as long as the provider reflects them.
