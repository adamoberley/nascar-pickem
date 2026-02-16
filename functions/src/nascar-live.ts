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

const CUP_SERIES_ID = 1;
const LIVE_FEED_URL = "https://cf.nascar.com/live/feeds/live-feed.json";
const RACE_LIST_BASIC_URL = (seasonYear: number) =>
  `https://cf.nascar.com/cacher/${seasonYear}/${CUP_SERIES_ID}/race_list_basic.json`;
const WEEKEND_FEED_URL = (seasonYear: number, raceId: number) =>
  `https://cf.nascar.com/cacher/${seasonYear}/${CUP_SERIES_ID}/${raceId}/weekend-feed.json`;

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

/** Official completed-race row from weekend-feed (matches live-results table). */
export interface NascarOfficialRaceResult {
  finishPosition: number;
  driverName: string;
  points: number;
  vehicleNumber: string;
}

/** Basic race metadata from cf.nascar.com race_list_basic.json. */
export interface NascarRaceListBasicEntry {
  race_id?: number;
  race_name?: string;
  race_date?: string;
  race_type_id?: number;
  series_id?: number;
  track_name?: string;
}

interface ResolveNascarRaceIdInput {
  leagueRaceId: string;
  leagueRaceName: string;
  leagueRaceStartTimeMs: number;
  raceList: NascarRaceListBasicEntry[];
}

interface NascarWeekendFeed {
  weekend_race?: NascarWeekendRace[];
}

interface NascarWeekendRace {
  race_id?: number;
  race_name?: string;
  results?: NascarWeekendRaceResult[];
  stage_results?: NascarWeekendRaceStageResult[];
}

interface NascarWeekendRaceResult {
  finishing_position?: number;
  official_car_number?: string;
  car_number?: string;
  driver_fullname?: string;
  points_earned?: number;
}

interface NascarWeekendRaceStageResult {
  stage_number?: number;
  results?: Array<{
    car_number?: string;
    stage_points?: number;
  }>;
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
 * NASCAR finish-position points for this app's rules:
 * 1st=40, 2nd=35, 3rd=34, 4th=33 ... 36th+=1.
 */
export function computeNascarPositionPoints(position: number): number {
  if (!Number.isFinite(position) || position <= 0) return 0;
  if (position === 1) return 40;
  if (position === 2) return 35;
  return Math.max(1, 37 - position);
}

/**
 * Compute live points from feed: position only (40, 35, 34, ... 1).
 * No laps-led or stage points; league uses position + stage top-10 (stage data not in this feed).
 */
function computeLivePoints(feed: NascarLiveFeed): FetchLiveFeedResult {
  const vehicles = (feed.vehicles ?? [])
    // Include all classified cars so picks don't drop to 0 when a driver is off pace or out.
    .filter((v) => Number.isFinite(v.running_position) && v.running_position >= 1)
    .sort((a, b) => a.running_position - b.running_position);

  const drivers: LiveFeedDriverPoints[] = vehicles.map((v) => {
    const basePoints = computeNascarPositionPoints(v.running_position);
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

/**
 * Fetch Cup race list for a season from cf.nascar.com.
 * Used to resolve league race docs to NASCAR numeric race_id dynamically.
 */
export async function fetchNascarRaceListBasic(
  seasonYear: number,
): Promise<NascarRaceListBasicEntry[]> {
  const url = RACE_LIST_BASIC_URL(seasonYear);
  try {
    const res = await fetch(url, { headers: LIVE_FEED_HEADERS });
    if (!res.ok) {
      logger.warn("NASCAR race_list_basic request failed", { url, status: res.status });
      return [];
    }
    const data = (await res.json()) as unknown;
    if (!Array.isArray(data)) return [];
    return data as NascarRaceListBasicEntry[];
  } catch (err) {
    logger.warn("NASCAR race_list_basic fetch error", { url, error: String(err) });
    return [];
  }
}

function toDateOnly(value: string | undefined | null): string | null {
  if (!value) return null;
  const match = value.match(/^(\d{4}-\d{2}-\d{2})/);
  if (match) return match[1];
  const parsed = new Date(value);
  if (Number.isNaN(parsed.getTime())) return null;
  return parsed.toISOString().slice(0, 10);
}

function dateDiffInDays(leftDateOnly: string, rightDateOnly: string): number {
  const [ly, lm, ld] = leftDateOnly.split("-").map((x) => Number(x));
  const [ry, rm, rd] = rightDateOnly.split("-").map((x) => Number(x));
  if (![ly, lm, ld, ry, rm, rd].every((n) => Number.isFinite(n))) {
    return Number.MAX_SAFE_INTEGER;
  }
  const leftMs = Date.UTC(ly, lm - 1, ld);
  const rightMs = Date.UTC(ry, rm - 1, rd);
  return Math.floor(Math.abs(leftMs - rightMs) / (24 * 60 * 60 * 1000));
}

const RACE_NAME_STOP_WORDS = new Set([
  "at",
  "presented",
  "by",
  "powered",
  "the",
  "race",
  "series",
  "cup",
  "nascar",
]);

function tokenizeRaceName(name: string): string[] {
  const normalized = normalizeRaceName(name)
    .normalize("NFKD")
    .replace(/[\u0300-\u036f]/g, "")
    .replace(/[^a-z0-9]+/g, " ")
    .trim();
  if (!normalized) return [];
  return normalized
    .split(/\s+/)
    .filter((token) => token.length > 0 && !RACE_NAME_STOP_WORDS.has(token));
}

function raceNameOverlapScore(left: string, right: string): number {
  const leftTokens = new Set(tokenizeRaceName(left));
  const rightTokens = new Set(tokenizeRaceName(right));
  if (leftTokens.size === 0 || rightTokens.size === 0) return 0;

  let intersection = 0;
  leftTokens.forEach((token) => {
    if (rightTokens.has(token)) intersection += 1;
  });

  return intersection / Math.min(leftTokens.size, rightTokens.size);
}

/**
 * Resolve NASCAR numeric race_id for a league race doc.
 * Uses hardcoded overrides first, then same-date matching from race_list_basic.json.
 */
export function resolveNascarRaceIdForLeagueRace(input: ResolveNascarRaceIdInput): number | null {
  const overrideRaceId = getNascarRaceIdForLeagueRace(input.leagueRaceId);
  if (overrideRaceId != null) return overrideRaceId;

  const pointsRaces = input.raceList
    .filter((race): race is NascarRaceListBasicEntry & { race_id: number } => typeof race.race_id === "number")
    .filter((race) => (race.series_id ?? CUP_SERIES_ID) === CUP_SERIES_ID)
    .filter((race) => (race.race_type_id ?? 1) === 1);

  if (pointsRaces.length === 0) return null;

  const leagueRaceDate = new Date(input.leagueRaceStartTimeMs).toISOString().slice(0, 10);

  type Candidate = {
    raceId: number;
    nameScore: number;
    sameDate: boolean;
    dayDiff: number;
  };

  const candidates: Candidate[] = pointsRaces.map((race) => {
    const raceDate = toDateOnly(race.race_date);
    const sameDate = raceDate === leagueRaceDate;
    const dayDiff =
      raceDate != null ? dateDiffInDays(leagueRaceDate, raceDate) : Number.MAX_SAFE_INTEGER;

    return {
      raceId: race.race_id,
      nameScore: raceNameOverlapScore(input.leagueRaceName, race.race_name ?? ""),
      sameDate,
      dayDiff,
    };
  });

  const sortBest = (left: Candidate, right: Candidate): number =>
    right.nameScore - left.nameScore ||
    left.dayDiff - right.dayDiff ||
    left.raceId - right.raceId;

  const sameDate = candidates.filter((candidate) => candidate.sameDate).sort(sortBest);
  if (sameDate.length > 0) return sameDate[0].raceId;

  const strongByName = candidates
    .filter((candidate) => candidate.nameScore >= 0.75)
    .sort(sortBest);
  if (strongByName.length > 0) return strongByName[0].raceId;

  const weakByNameAndDate = candidates
    .filter((candidate) => candidate.nameScore >= 0.5 && candidate.dayDiff <= 2)
    .sort(sortBest);
  if (weakByNameAndDate.length > 0) return weakByNameAndDate[0].raceId;

  return null;
}

/** Live stage points URL. race_id is per-race from the live feed (e.g. 5596 = Daytona 500, different for each race). */
const LIVE_STAGE_POINTS_URL = (seasonYear: number, raceId: number) =>
  `https://cf.nascar.com/cacher/${seasonYear}/${CUP_SERIES_ID}/${raceId}/live-stage-points.json`;

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
 * Fetch weekend-feed for one race_id.
 * Returns null when unavailable.
 */
async function fetchNascarWeekendRace(
  seasonYear: number,
  raceId: number,
): Promise<NascarWeekendRace | null> {
  const url = WEEKEND_FEED_URL(seasonYear, raceId);
  try {
    const res = await fetch(url, { headers: LIVE_FEED_HEADERS });
    if (!res.ok) {
      logger.warn("NASCAR weekend-feed request failed", { url, status: res.status });
      return null;
    }
    const data = (await res.json()) as NascarWeekendFeed;
    if (!Array.isArray(data?.weekend_race) || data.weekend_race.length === 0) {
      return null;
    }
    const weekendRace = data.weekend_race[0];
    if (!weekendRace || typeof weekendRace !== "object") return null;
    return weekendRace;
  } catch (err) {
    logger.warn("NASCAR weekend-feed fetch error", { url, error: String(err) });
    return null;
  }
}

function normalizeVehicleNumber(value: unknown): string {
  if (value == null) return "";
  return String(value).trim();
}

function extractOfficialResultsFromWeekendRace(
  weekendRace: NascarWeekendRace,
): NascarOfficialRaceResult[] {
  const rows: NascarOfficialRaceResult[] = [];
  for (const result of weekendRace.results ?? []) {
    const finishPosition =
      typeof result.finishing_position === "number" ? result.finishing_position : 0;
    if (finishPosition <= 0) continue;
    const vehicleNumber = normalizeVehicleNumber(
      result.official_car_number ?? result.car_number,
    );
    if (!vehicleNumber) continue;
    const points =
      typeof result.points_earned === "number"
        ? result.points_earned
        : computeNascarPositionPoints(finishPosition);
    rows.push({
      finishPosition,
      driverName: String(result.driver_fullname ?? "").trim(),
      points,
      vehicleNumber,
    });
  }
  return rows.sort((a, b) => a.finishPosition - b.finishPosition);
}

function extractFinishPointsByVehicleFromWeekendRace(
  weekendRace: NascarWeekendRace,
): Map<string, number> {
  const byVehicle = new Map<string, number>();
  const results = weekendRace.results ?? [];
  for (const result of results) {
    const finishingPosition =
      typeof result.finishing_position === "number" ? result.finishing_position : 0;
    if (finishingPosition <= 0) continue;
    const vehicleNumber = normalizeVehicleNumber(
      result.official_car_number ?? result.car_number,
    );
    if (!vehicleNumber) continue;
    byVehicle.set(vehicleNumber, computeNascarPositionPoints(finishingPosition));
  }
  return byVehicle;
}

function extractStagePointsByVehicleFromWeekendRace(
  weekendRace: NascarWeekendRace,
): Map<string, number> {
  const byVehicle = new Map<string, number>();
  for (const stage of weekendRace.stage_results ?? []) {
    const results = stage.results ?? [];
    for (const result of results) {
      const vehicleNumber = normalizeVehicleNumber(result.car_number);
      const stagePoints =
        typeof result.stage_points === "number" ? result.stage_points : 0;
      if (!vehicleNumber || stagePoints === 0) continue;
      byVehicle.set(vehicleNumber, (byVehicle.get(vehicleNumber) ?? 0) + stagePoints);
    }
  }
  return byVehicle;
}

/**
 * Fetch official completed-race rows from NASCAR weekend-feed.
 * Returns rows shaped like the live-results table (Finish / Name / Points).
 */
export async function fetchNascarCompletedRaceOfficialResults(
  seasonYear: number,
  raceId: number,
): Promise<NascarOfficialRaceResult[]> {
  const weekendRace = await fetchNascarWeekendRace(seasonYear, raceId);
  if (!weekendRace) return [];
  return extractOfficialResultsFromWeekendRace(weekendRace);
}

/**
 * Fetch final race points from NASCAR weekend-feed.
 * Prefers official points_earned values when available; otherwise falls back to
 * finish-position points + stage points.
 * Returns empty map when official finishing positions are not posted yet.
 */
export async function fetchNascarCompletedRacePoints(
  seasonYear: number,
  raceId: number,
): Promise<Map<string, number>> {
  const weekendRace = await fetchNascarWeekendRace(seasonYear, raceId);
  if (!weekendRace) return new Map();

  const officialResults = extractOfficialResultsFromWeekendRace(weekendRace);
  if (officialResults.length > 0) {
    const officialPointsByVehicle = new Map<string, number>();
    for (const row of officialResults) {
      officialPointsByVehicle.set(row.vehicleNumber, row.points);
    }

    logger.info("NASCAR weekend-feed official points loaded", {
      seasonYear,
      raceId,
      raceName: weekendRace.race_name ?? "",
      officialDrivers: officialResults.length,
    });
    return officialPointsByVehicle;
  }

  const finishPointsByVehicle = extractFinishPointsByVehicleFromWeekendRace(weekendRace);
  if (finishPointsByVehicle.size === 0) {
    // Results are not posted yet.
    return new Map();
  }

  let stagePointsByVehicle = extractStagePointsByVehicleFromWeekendRace(weekendRace);
  if (stagePointsByVehicle.size === 0) {
    // Fallback to the stage endpoint if weekend-feed stage block is missing.
    stagePointsByVehicle = await fetchNascarLiveStagePoints(seasonYear, raceId);
  }

  const totalPointsByVehicle = new Map<string, number>(finishPointsByVehicle);
  for (const [vehicleNumber, stagePoints] of stagePointsByVehicle) {
    totalPointsByVehicle.set(
      vehicleNumber,
      (totalPointsByVehicle.get(vehicleNumber) ?? 0) + stagePoints,
    );
  }

  logger.info("NASCAR weekend-feed points loaded", {
    seasonYear,
    raceId,
    raceName: weekendRace.race_name ?? "",
    finishDrivers: finishPointsByVehicle.size,
    stageDrivers: stagePointsByVehicle.size,
  });

  return totalPointsByVehicle;
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
    const res = await fetch(url, { headers: LIVE_FEED_HEADERS });
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
        const num = normalizeVehicleNumber(r?.vehicle_number);
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
  if (!a || !b) return false;
  if (a === b) return true;
  if (a.includes(b) || b.includes(a)) return true;
  // Token overlap threshold handles sponsor/tagline differences.
  return raceNameOverlapScore(a, b) >= 0.6;
}
