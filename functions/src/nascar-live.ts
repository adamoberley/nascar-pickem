/**
 * NASCAR.com live feed: https://cf.nascar.com/live/feeds/live-feed.json
 * Human leaderboard: https://www.nascar.com/live-results/nascar-cup-series/{race-slug}/
 *
 * Live points: position only (40, 35, 34, ... 1). We do not add laps-led or stage
 * points here; league scoring uses finish position + top-10 stage points.
 *
 * Stage results: https://cf.nascar.com/cacher/{year}/{series_id}/{race_id}/live-stage-points.json
 * Returns array of { race_id, run_id, stage_number, results: [{ position, vehicle_number, stage_points }] }.
 */

import { logger } from "firebase-functions";

const LIVE_FEED_URL = "https://cf.nascar.com/live/feeds/live-feed.json";

/** Request like a browser so the feed isn’t blocked for server-side requests. */
const LIVE_FEED_HEADERS: RequestInit["headers"] = {
  Accept: "application/json",
  "User-Agent":
    "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36",
};

export interface NascarLiveVehicle {
  vehicle_number: string;
  running_position: number;
  laps_completed: number;
  laps_led: Array<{ start_lap: number; end_lap: number }>;
  driver: {
    driver_id: number;
    full_name: string;
    first_name: string;
    last_name: string;
  };
  status?: number;
}

export interface NascarLiveFeed {
  lap_number: number;
  laps_in_race: number;
  laps_to_go: number;
  flag_state: number;
  race_id: number;
  /** Run/session id (e.g. 7); used with stage-results-1, stage-results-2 on the live-results page. */
  run_id?: number;
  run_name: string;
  track_name: string;
  vehicles: NascarLiveVehicle[];
  stage?: {
    stage_num: number;
    finish_at_lap: number;
    laps_in_stage: number;
  };
}

export interface LiveFeedDriverPoints {
  /** Car number from feed (for mapping to league driver). */
  vehicleNumber: string;
  /** NASCAR driver full name. */
  driverName: string;
  /** Current running position (1-based). */
  runningPosition: number;
  /** Total laps led (informational only; not used for points). */
  lapsLed: number;
  /** Position points only: 40 for 1st, 35 for 2nd, 34…1 (no laps led / stage in this feed). */
  basePoints: number;
}

export interface FetchLiveFeedResult {
  runName: string;
  /** NASCAR numeric race id (e.g. 5596); used for live-stage-points.json URL. */
  raceId?: number;
  /** Run/session id from feed (e.g. 7). */
  runId?: number;
  lapNumber: number;
  lapsInRace: number;
  lapsToGo: number;
  /** Current stage and when it ends (from feed.stage). */
  stage?: {
    stageNum: number;
    finishAtLap: number;
    lapsInStage: number;
  };
  drivers: LiveFeedDriverPoints[];
}

/** One stage's top-10: vehicle number and finish position (1–10). Stage points typically 10,9,8…1. */
export interface StageResultEntry {
  vehicleNumber: string;
  position: number;
  stagePoints?: number;
}

/**
 * Fetch the public NASCAR live feed JSON.
 * Returns null if the feed is unavailable or not for an active race.
 */
export async function fetchNascarLiveFeed(): Promise<FetchLiveFeedResult | null> {
  try {
    const response = await fetch(LIVE_FEED_URL, {
      headers: LIVE_FEED_HEADERS,
    });
    if (!response.ok) {
      logger.warn("NASCAR live feed request failed", { status: response.status });
      return null;
    }
    const raw = (await response.json()) as NascarLiveFeed;
    if (!raw || typeof raw !== "object") return null;
    return computeLivePoints(raw);
  } catch (err) {
    logger.warn("NASCAR live feed fetch error", { error: String(err) });
    return null;
  }
}

/**
 * Compute live points from feed: position only (40, 35, 34, ... 1).
 * No laps-led or stage points; league uses position + stage top-10 (stage data not in this feed).
 */
function computeLivePoints(feed: NascarLiveFeed): FetchLiveFeedResult {
  const vehicles = (feed.vehicles ?? [])
    .filter((v) => v.running_position >= 1 && v.status === 1)
    .sort((a, b) => a.running_position - b.running_position);

  const drivers: LiveFeedDriverPoints[] = vehicles.map((v) => {
    const basePoints = Math.max(1, Math.min(40, 41 - v.running_position));
    const lapsLed = (v.laps_led ?? []).reduce(
      (sum, seg) => sum + (seg.end_lap - seg.start_lap + 1),
      0,
    );
    return {
      vehicleNumber: String(v.vehicle_number),
      driverName: v.driver?.full_name ?? "",
      runningPosition: v.running_position,
      lapsLed,
      basePoints,
    };
  });

  const stage = feed.stage
    ? {
        stageNum: feed.stage.stage_num,
        finishAtLap: feed.stage.finish_at_lap,
        lapsInStage: feed.stage.laps_in_stage,
      }
    : undefined;

  return {
    runName: feed.run_name ?? "",
    raceId: feed.race_id,
    runId: feed.run_id,
    lapNumber: feed.lap_number ?? 0,
    lapsInRace: feed.laps_in_race ?? 0,
    lapsToGo: feed.laps_to_go ?? 0,
    stage,
    drivers,
  };
}

/** Known NASCAR race_id by league race id. Use when live feed is unavailable so we can still fetch stage points. Add entries as season progresses. */
const NASCAR_RACE_ID_BY_LEAGUE_RACE: Record<string, number> = {
  "2026-daytona-500": 5596,
};

/** Return NASCAR race_id for a league race id if known; otherwise null. Lets us fetch stage points when the live feed is down. */
export function getNascarRaceIdForLeagueRace(leagueRaceId: string): number | null {
  return NASCAR_RACE_ID_BY_LEAGUE_RACE[leagueRaceId] ?? null;
}

/** Live stage points URL. race_id is per-race from the live feed (e.g. 5596 = Daytona 500, different for each race). */
const LIVE_STAGE_POINTS_URL = (seasonYear: number, raceId: number) =>
  `https://cf.nascar.com/cacher/${seasonYear}/1/${raceId}/live-stage-points.json`;

/** One stage in the live-stage-points.json response. */
interface LiveStagePointsItem {
  race_id?: number;
  run_id?: number;
  stage_number?: number;
  results?: Array<{
    position?: number;
    vehicle_number?: string;
    driver_id?: number;
    full_name?: string;
    stage_points?: number;
  }>;
}

/**
 * Fetch live stage points from cf.nascar.com/cacher/.../live-stage-points.json.
 * Returns a map of vehicle_number (string) -> total stage points across all stages.
 * Cup series = 1. Returns empty map if fetch fails or response is invalid.
 */
export async function fetchNascarLiveStagePoints(
  seasonYear: number,
  raceId: number,
): Promise<Map<string, number>> {
  const url = LIVE_STAGE_POINTS_URL(seasonYear, raceId);
  try {
    const res = await fetch(url, { headers: { Accept: "application/json" } });
    if (!res.ok) {
      logger.warn("NASCAR live-stage-points request failed", { url, status: res.status });
      return new Map();
    }
    const data = (await res.json()) as unknown;
    const stages = Array.isArray(data) ? data : [];
    const byVehicle = new Map<string, number>();
    for (const stage of stages as LiveStagePointsItem[]) {
      const results = stage?.results ?? [];
      for (const r of results) {
        const num = r?.vehicle_number != null ? String(r.vehicle_number).trim() : "";
        const pts = typeof r?.stage_points === "number" ? r.stage_points : 0;
        if (num) byVehicle.set(num, (byVehicle.get(num) ?? 0) + pts);
      }
    }
    const stageNumbers = (stages as LiveStagePointsItem[]).map((s) => s?.stage_number).filter((n) => n != null);
    if (byVehicle.size > 0) {
      logger.info("NASCAR live stage points loaded", {
        seasonYear,
        raceId,
        stages: stageNumbers,
        driverCount: byVehicle.size,
      });
    }
    return byVehicle;
  } catch (err) {
    logger.warn("NASCAR live-stage-points fetch error", { url, error: String(err) });
    return new Map();
  }
}

/**
 * Normalize race name for matching (lowercase, collapse spaces).
 */
export function normalizeRaceName(name: string): string {
  return (name ?? "")
    .toLowerCase()
    .replace(/\s+/g, " ")
    .trim();
}

/**
 * Check if feed run name is a plausible match for our race name.
 * Handles "DAYTONA 500" vs "Daytona 500", "2026 Daytona 500", and minor differences.
 * Uses token overlap so "DAYTONA 500" matches "Daytona 500 at Daytona International Speedway".
 */
export function runNameMatchesRace(runName: string, ourRaceName: string): boolean {
  const a = normalizeRaceName(runName);
  const b = normalizeRaceName(ourRaceName);
  if (a === b) return true;
  if (a.includes(b) || b.includes(a)) return true;
  // Token match: feed "daytona 500" vs our "2026 daytona 500 at daytona" - require feed tokens to appear in ours.
  const feedTokens = a.split(/\s+/).filter((t) => t.length > 1);
  if (feedTokens.length > 0 && feedTokens.every((t) => b.includes(t))) return true;
  return false;
}
