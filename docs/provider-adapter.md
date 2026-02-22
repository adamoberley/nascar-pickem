# NASCAR Data Adapter (Deprecated)

The project no longer uses `NASCAR_PROVIDER_BASE_URL` or a custom provider adapter. The `functions/src/provider.ts` module has been removed.

Current ingestion is direct from NASCAR CF endpoints in `functions/src/nascar-live.ts` and `functions/src/ingest.ts`:

- `https://cf.nascar.com/cacher/{year}/1/race_list_basic.json` (schedule + race metadata)
- `https://cf.nascar.com/data/cacher/production/{year}/1/racinginsights-points-feed.json` (standings)
- `https://cf.nascar.com/cacher/{year}/1/{race_id}/weekend-feed.json` (official results / points)
- `https://cf.nascar.com/live/feeds/live-feed.json` (live running order + lap/stage metadata)
- `https://cf.nascar.com/cacher/{year}/1/{race_id}/live-stage-points.json` (live stage points used for in-race scoring)

If you need a custom adapter later, add it as a new module and wire it explicitly in `ingest.ts`.
