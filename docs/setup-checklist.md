# Setup Checklist

## 1. Firebase project ID

Edit `.firebaserc` and replace `your-firebase-project-id` with your actual Firebase project ID (from [Firebase Console](https://console.firebase.google.com) → Project settings → General).

## 2. Web app env vars

Copy `.env.example` to `.env` in the repo root (or in `web/` if your Vite app loads from there). Fill in from Firebase Console → Project settings → General → Your apps (web app config):

- `VITE_FIREBASE_API_KEY`
- `VITE_FIREBASE_AUTH_DOMAIN`
- `VITE_FIREBASE_PROJECT_ID`
- `VITE_FIREBASE_STORAGE_BUCKET`
- `VITE_FIREBASE_MESSAGING_SENDER_ID`
- `VITE_FIREBASE_APP_ID`

## 3. Firebase Console – enable products

In [Firebase Console](https://console.firebase.google.com) for your project:

- **Authentication**: enable **Email/Password**
- **Firestore**: create database
- **Hosting**: enable
- **Functions**: enable (Blaze plan required for scheduled functions)
- **Scheduler**: used by Cloud Functions; enable if prompted or ensure Blaze plan

## 4. Install and build

```bash
npm install --workspaces
npm run build --workspaces
```

Functions use **esbuild** for the build (fast); type-checking is still `npm run lint` in `functions/` (tsc).

## 5. Deploy backend + hosting

```bash
npm run deploy
```

If deploy times out during "Loading and analyzing source code" for functions:

- **Stub entry:** Functions use a discovery-only entry (`lib/index.js`); the heavy bundle loads only when an export is accessed. Try deploy again.
- **Deploy from GitHub Actions:** Push to `main` or run the workflow **Deploy to Firebase** manually. Add `FIREBASE_TOKEN` in repo secrets (from `firebase login:ci`). The workflow runs on a cloud runner with more memory and a 120s discovery timeout.

## 6. Seed league data (after deploy)

1. Open the web app (Hosting URL, e.g. `https://YOUR_PROJECT_ID.web.app`)
2. Sign in (email/password)
3. Create a league
4. Use **Refresh Data Now** once to seed schedule and tiers
5. Confirm schedule and tiers appear

## 7. Optional: live NASCAR data

To use a real NASCAR provider instead of the static fallback:

- Set **Cloud Functions** config (or `.env` for emulators):
  - `NASCAR_PROVIDER_BASE_URL` – base URL of your provider
  - `NASCAR_PROVIDER_TOKEN` (optional)
- Ensure the provider implements the endpoints in [provider-adapter.md](./provider-adapter.md):
  - `GET /schedule?seasonYear=YYYY`
  - `GET /standings?seasonYear=YYYY`
  - `GET /results/{raceKey}?seasonYear=YYYY`

## 8. iOS app (if using)

- Add `GoogleService-Info.plist` (from Firebase Console → Project settings → Your apps → iOS) to your Xcode target
