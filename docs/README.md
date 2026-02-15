# NASCAR Pick'Em — Documentation Index

Documentation for setup, deployment, admin workflow, and data integration.

## Setup & deployment

| Document | Description |
|----------|-------------|
| [setup-checklist.md](setup-checklist.md) | Full setup: Firebase project, env vars, build, deploy, and troubleshooting (e.g. IAM for Cloud Functions). |
| [GETTING-FULLY-WORKING.md](GETTING-FULLY-WORKING.md) | Get a 2026 league from zero to playable using built-in schedule, standings, and Clash result (no external NASCAR provider). |

**Hosting:** The web app is deployed to Firebase Hosting. Live URL: https://nascar-pick-em.web.app. Deploy with `npm run deploy`.

## Admin & operations

| Document | Description |
|----------|-------------|
| [admin-onboarding.md](admin-onboarding.md) | One-time setup and weekly admin workflow (picks monitor, refresh, overrides, penalties). |

## Data & provider

| Document | Description |
|----------|-------------|
| [provider-adapter.md](provider-adapter.md) | NASCAR data provider contract: required methods and HTTP adapter endpoints (schedule, standings, results). |
| [race-results-sources.md](race-results-sources.md) | Standings and race results (NASCAR.com, ESPN). Live feed (cf.nascar.com) and stage points; implementation in `functions/src/nascar-live.ts`. |

## Firestore & indexes

| Document | Description |
|----------|-------------|
| [index-setup.md](index-setup.md) | Firestore index setup (composite indexes from `firestore.indexes.json`). |
| [add-members-userid-index.md](add-members-userid-index.md) | How to add the **collection group** index on `members` by `userId` (required for “my leagues” queries). |
| [firestore-rules-review.md](firestore-rules-review.md) | Review of Firestore security rules and coverage. |

## Project root

- **[../README.md](../README.md)** — Project overview, repo layout, setup summary, and links to key docs.
- **[../STYLEGUIDE.md](../STYLEGUIDE.md)** — UI and code style for web and iOS.
