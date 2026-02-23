# AGENTS.md

Purpose: keep coding sessions fast, targeted, and low-token in this repo.

## Quick Start
- Read only this file first.
- Then open only the files required for the specific task.
- Prefer `rg` for discovery (`rg --files`, `rg -n "pattern"`).

## Repo Surfaces
- `web/`: React + Vite app.
- `functions/`: Firebase Cloud Functions (TypeScript).
- `ios/Nascar Pick'Em/`: SwiftUI iOS app.
- `shared/`: shared callable request/response types.

## Token-Efficient Workflow
1. Identify surface (`web`, `functions`, `ios`).
2. Open the smallest entrypoint set for that surface.
3. Make focused edits.
4. Run only relevant checks (not full monorepo by default).
5. Summarize changed files and why.

## Minimal File Map By Task
- Auth/login issues (web):  
  `web/src/hooks/useAuth.ts`, `web/src/views/AuthView.tsx`
- League join/create (web):  
  `web/src/views/LeagueAccessView.tsx`, `web/src/lib/api.ts`, `functions/src/index.ts`
- Picks flow (web):  
  `web/src/hooks/usePickDraft.ts`, `web/src/views/PicksTab.tsx`, `functions/src/index.ts`, `functions/src/pick-validation.ts`
- Race/standings display (web):  
  `web/src/views/RaceTab.tsx`, `web/src/views/StandingsTab.tsx`, `web/src/hooks/useRaceSelection.ts`, `web/src/lib/race-points.ts`
- Admin actions (web):  
  `web/src/views/AdminTab.tsx`, `web/src/lib/api.ts`, `functions/src/index.ts`
- Ingest/live scoring (backend):  
  `functions/src/ingest.ts`, `functions/src/live-sync.ts`, `functions/src/nascar-live.ts`, `functions/src/scoring.ts`
- Firestore access/security:  
  `firestore.rules`, `functions/src/data.ts`, `web/src/lib/api.ts`, `ios/.../Services/LeagueRepository.swift`
- iOS state/data layer:  
  `ios/.../Features/PlayerViewModel.swift`, `ios/.../Services/LeagueRepository.swift`

## Fast Commands
- Install: `npm install`
- Typecheck all: `npm run lint`
- Unit tests all: `npm run test`
- Web only:
  - `npm --prefix web run lint`
  - `npm --prefix web run test`
- Functions only:
  - `npm --prefix functions run lint`
  - `npm --prefix functions run test`

## Rules To Avoid Wasted Time
- Do not bulk-read `docs/` unless task is docs/setup-specific.
- Do not edit generated artifacts by hand:
  - `web/vite.config.js`
  - `web/vite.config.d.ts`
  - `web/*.tsbuildinfo`
- Prefer callables for privileged writes. Firestore rules block direct client writes to league data.
- Keep changes scoped to one surface unless cross-surface change is required.

## Known Gotchas
- iOS currently references callable `getLeaguePreviewByInviteCode`; verify backend export exists before relying on it.
- iOS `setLeagueSettings` path should use callable flow (security rules deny direct `leagues/{leagueId}` updates from client).

## PR/Commit Hygiene
- Include: what changed, why, and which checks were run.
- If checks were not run, say so explicitly.
