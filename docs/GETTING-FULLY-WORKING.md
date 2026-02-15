# Getting the App Fully Working

This checklist gets a 2026 league from zero to playable (schedule, drivers, tiers, and optional race results) **without** running your own NASCAR data provider.

---

## 1. Firebase project setup

- Create a Firebase project (or use existing).
- Enable: **Authentication** (Email/Password), **Firestore**, **Cloud Functions**, **Hosting**, **Scheduler** (for scheduled functions).
- In `.firebaserc`, set `default.project` to your project ID (e.g. `nascar-pick-em`).

---

## 2. Web app environment

- Copy `.env.example` to `.env` (or set env vars in your host).
- Set `VITE_FIREBASE_*` to your project's config (apiKey, authDomain, etc.).
- You do **not** need `NASCAR_PROVIDER_BASE_URL` for the static 2026 data; leave it unset to use the built-in schedule, standings, and Cook Out Clash result.

---

## 3. Build and deploy

```bash
npm install
npm run build --workspaces
firebase deploy
```

This deploys Functions (with 2026 schedule, standings, and Clash result), Hosting (web app), Firestore rules, and indexes.

---

## 4. Create a 2026 league

**Option A – Web app (recommended)**

1. Open your hosted web app (e.g. https://nascar-pick-em.web.app) and sign in (create an account if needed).
2. Create a league:
   - League name: e.g. "NASCAR Pick'Em 2026"
   - Invite code: e.g. "NASCAR2026"
   - **Season year: 2026** (required for full schedule + drivers)
3. Click **Create League**.

**Option B – CLI script**

```bash
gcloud auth application-default login
node scripts/init-db.js "NASCAR Pick'Em 2026" "NASCAR2026" 2026 YOUR_FIREBASE_UID "Your Display Name"
```

Use the same UID as the user who will be admin (e.g. from Firebase Auth).

---

## 5. Seed races and drivers (one-time)

1. In the web app, open the league and go to **Admin**.
2. Click **Refresh Data Now**.

This runs the ingest that:

- Writes the **full 2026 schedule** (40 races) into the league.
- Writes **2026 Cup standings** into the league (40 drivers) and creates a standings snapshot.
- Computes **tiers** for upcoming races (Tier A/B/C from standings positions 1–10, 11–20, 21–30).

After this, players can make picks for the next race.

---

## 6. (Optional) Apply Cook Out Clash results

If you want the 2026 Cook Out Clash to be marked completed and scored:

1. Ensure **Refresh Data Now** has already run (so drivers exist with matching `providerDriverKey`).
2. Either run **Refresh Data Now** again (it will fetch the static Clash result and apply it), or rely on the scheduled job that refreshes recent race results.

Leagues that already have drivers will get Clash points applied when the provider returns that result.

---

## 7. Share and play

- Share the **invite code** (e.g. "NASCAR2026") with players.
- Players sign in, join the league, then use **Picks** to choose drivers from the tiered list before each race locks.
- After races, **Standings** and **Race** tabs show scores (and adjustments if you add any).

---

## What's included without a custom provider

| Data              | Source when no `NASCAR_PROVIDER_BASE_URL` |
|-------------------|--------------------------------------------|
| Schedule          | Full 2026 Cup schedule (40 events)        |
| Drivers / tiers   | 2026 Cup standings (40 drivers, A/B/C)    |
| Clash result     | Static Cook Out Clash finishing order     |
| Other race results | Not available until you add a provider or more static result files |

To get results for more races automatically, you'd either:

- Set **NASCAR_PROVIDER_BASE_URL** to a service that implements the [provider adapter](provider-adapter.md) (schedule, standings, results), or  
- Add more static result JSON files and map them in the static provider (see `functions/src/results-2026-cook-out-clash.json` and `provider.ts`).

---

## Troubleshooting

- **No drivers / can't make picks**  
  Make sure the league's **season year is 2026** and you've clicked **Refresh Data Now** at least once. Drivers and tiers come from the 2026 standings ingest.

- **Clash not scoring**  
  Refresh Data Now must have run first (to create drivers). Then run it again so the Clash result is fetched and applied; driver `providerDriverKey` values must match the result (e.g. `ryan-preece`, `kyle-larson`).

- **Wrong project or auth**  
  Check `.firebaserc` and `.env` (or hosting env). For the init script, use the same Firebase UID that appears in Auth after signing in.
