# NASCAR Pick'Em — Documentation Index

Documentation for setup, deployment, admin workflow, and data integration.

## Setup & deployment

| Document | Description |
|----------|-------------|
| [setup-checklist.md](setup-checklist.md) | Full setup: Firebase project, env vars, build, deploy, and troubleshooting (e.g. IAM for Cloud Functions). |
| [GETTING-FULLY-WORKING.md](GETTING-FULLY-WORKING.md) | Get a 2026 league from zero to playable using direct NASCAR CF feeds (no external provider adapter). |

**Hosting:** The web app is deployed to Firebase Hosting. Live URL: https://nascar-pick-em.web.app. Deploy with `npm run deploy`.

## Admin & operations

| Document | Description |
|----------|-------------|
| [admin-onboarding.md](admin-onboarding.md) | One-time setup and weekly admin workflow (picks monitor, refresh, overrides, penalties). |

## Data

| Document | Description |
|----------|-------------|
| [provider-adapter.md](provider-adapter.md) | Deprecated provider-adapter note; current ingestion is NASCAR CF direct. |
| [race-results-sources.md](race-results-sources.md) | NASCAR CF standings, schedule, completed-race, and live feeds used by the app. |

**Key modules (functions):** `nascar-live.ts` (NASCAR feed clients), `ingest.ts` (schedule/standings/results ingest), `live-sync.ts` (live sync orchestration), `driver-mapping.ts` (vehicle number → driver mapping), `pick-validation.ts` (tier validation).

## Firestore & indexes

| Document | Description |
|----------|-------------|
| [index-setup.md](index-setup.md) | Firestore index setup (composite indexes from `firestore.indexes.json`). |
| [add-members-userid-index.md](add-members-userid-index.md) | How to add the **collection group** index on `members` by `userId` (required for “my leagues” queries). |
| [firestore-rules-review.md](firestore-rules-review.md) | Review of Firestore security rules and coverage. |

## Testing

- **Unit tests:** `npm run test` — Vitest in `functions/` and `web/`
- **E2E tests:** `npm run test:e2e` — Playwright in `web/tests/`; set `E2E_EMAIL`, `E2E_PASSWORD`, `E2E_INVITE_CODE` env vars

## Project root

- **[../README.md](../README.md)** — Project overview, repo layout, setup summary, and links to key docs.
- **[../AGENTS.md](../AGENTS.md)** — AI/agent workflow: minimal file map, fast commands, gotchas.
- **[../STYLEGUIDE.md](../STYLEGUIDE.md)** — UI and code style for web and iOS.
