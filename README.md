# NASCAR Pick'Em (Firebase + SwiftUI + Web)

Private season-long NASCAR Pick'Em platform for ~20-21 users with:
- Player app on iOS (SwiftUI source in `ios/NASCARPickEm`)
- Responsive web app for Android + Admin dashboard (React + Firebase Hosting)
- Firebase backend (Auth, Firestore, Cloud Functions, scheduled jobs)

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

- `functions/`: Firebase Cloud Functions (TypeScript)
- `web/`: React web app (mobile responsive, admin role included)
- `ios/NASCARPickEm/`: SwiftUI iOS app source files
- `firestore.rules`: access control
- `firestore.indexes.json`: query indexes
- `firebase.json`: Firebase deployment config

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

## NASCAR Data Ingestion Adapter

Provider interface is in `functions/src/provider.ts`.

Two modes:
- HTTP adapter using env var `NASCAR_PROVIDER_BASE_URL` (plus optional token)
- Static fallback provider when no external source is configured

HTTP adapter expected endpoints:
- `GET /schedule?seasonYear=YYYY`
- `GET /standings?seasonYear=YYYY`
- `GET /results/{raceKey}?seasonYear=YYYY`

This lets you swap to another NASCAR/motorsports provider later without rewriting scoring logic.

## Web App Features

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

SwiftUI player client source is under `ios/NASCARPickEm`:
- auth
- league join/create
- home/picks/standings/race tabs
- Firestore listeners and callable integration

To run on iOS:
1. Create a new Xcode iOS App project (SwiftUI).
2. Copy files from `ios/NASCARPickEm` into the project.
3. Add Firebase iOS SDK packages:
   - `FirebaseAuth`
   - `FirebaseFirestore`
   - `FirebaseFunctions`
   - `FirebaseCore`
4. Add your `GoogleService-Info.plist` to the iOS target.

## Setup and Deploy

### 1. Create Firebase project

Enable:
- Authentication (Email/Password)
- Firestore
- Functions
- Hosting
- Scheduler (for scheduled functions)

### 2. Configure project id

Edit `.firebaserc`:
- replace `your-firebase-project-id`

### 3. Configure environment variables

Copy `.env.example` values:
- Vite `VITE_FIREBASE_*`
- optional `NASCAR_PROVIDER_BASE_URL` and `NASCAR_PROVIDER_TOKEN`

### 4. Install and build

```bash
npm install
npm run build --workspaces
```

### 5. Deploy

```bash
firebase deploy
```

## Minimal Admin Onboarding (Set-and-Forget)

1. Open web app and sign in.
2. Create league once (`Create League` form).
3. Share invite code with players.
4. Click `Refresh Data Now` once to seed schedule/standings.
5. Weekly routine:
   - Verify picks monitor before lock.
   - After race, verify scores.
   - Only use manual override if provider data is missing/wrong.

For penalties/corrections:
- Use `Add Penalty / Correction`.
- Weekly and season totals update automatically.
- Adjusted picks are tagged in UI.

## Notes

- Security rules enforce player/admin boundaries and post-lock edit prevention.
- With ~20 users, full re-score and rank recomputation is inexpensive and reliable.
- Scheduled re-check catches delayed post-race penalties as long as provider reflects them.
