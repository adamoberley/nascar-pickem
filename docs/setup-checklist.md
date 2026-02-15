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

This deploys Hosting (web app from `web/dist`), Functions, Firestore rules, and indexes. Live site: `https://YOUR_PROJECT_ID.web.app` (e.g. https://nascar-pick-em.web.app).

**GitHub Actions:** Pushes to `main` auto-deploy. Add `FIREBASE_TOKEN` in repo secrets (from `firebase login:ci`). See [.github/workflows/deploy.yml](../.github/workflows/deploy.yml).

**Font assets:** `firebase.json` includes headers for `*.woff2` and `*.otf` so custom fonts (Racer Italic, etc.) are served with correct MIME types and caching.

Callable functions use `invoker: "public"` so the Cloud Run service allows client invocation; auth is still enforced inside each function (e.g. `requireAuthUid`, `assertAdminInLeague`). If you see "Missing or insufficient permissions" when creating a league or calling other callables, redeploy functions so the invoker IAM is applied.

**If you get "internal" error with "missing permissions" when creating a league:**

This usually means the Cloud Functions service account doesn't have Firestore permissions. For Firebase Functions v2 (Cloud Run), the service account is the **default compute service account**: `PROJECT_NUMBER-compute@developer.gserviceaccount.com`

Fix it:

1. **Grant Firestore permissions**:
   - Go to [Google Cloud Console IAM](https://console.cloud.google.com/iam-admin/iam?project=nascar-pick-em)
   - Find the service account: `422638449752-compute@developer.gserviceaccount.com` (Default compute service account)
   - Click Edit (pencil icon)
   - Click "Add Another Role"
   - Add role: **Cloud Datastore User** (`roles/datastore.user`)
   - Save
2. **Redeploy functions**: `npm run deploy` (or `firebase deploy --only functions`)

Alternatively, grant the role via gcloud:
```bash
gcloud projects add-iam-policy-binding nascar-pick-em \
  --member="serviceAccount:422638449752-compute@developer.gserviceaccount.com" \
  --role="roles/datastore.user"
```

**Note:** The Editor role should include Firestore permissions, but sometimes the explicit `roles/datastore.user` role is needed for Cloud Run-based functions.

**Note:** You don't need to set your user account as admin - the `createLeague` function automatically makes you an admin when you create a league.

If deploy times out during "Loading and analyzing source code" for functions:

- **Stub entry:** Functions use a discovery-only entry (`lib/index.js`); the heavy bundle loads only when an export is accessed. Try deploy again.
- **Deploy from GitHub Actions:** Push to `main` or run the **Deploy to Firebase** workflow manually. Add `FIREBASE_TOKEN` in repo secrets (from `firebase login:ci`). The workflow runs on a cloud runner with more memory and a longer discovery timeout.

## 6. Seed league data (after deploy)

1. Open the web app at your Hosting URL (e.g. https://nascar-pick-em.web.app or `https://YOUR_PROJECT_ID.web.app`)
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
