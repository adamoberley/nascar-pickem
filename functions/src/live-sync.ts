import { logger } from "firebase-functions/v2";
import {
  driversRef,
  leagueRef,
  nowTimestamp,
  racePointsRef,
  racesRef,
  standingsSnapshotsRef,
} from "./data";
import {
  fetchNascarLiveFeed,
  fetchNascarLiveStagePoints,
  fetchNascarRaceListBasic,
  resolveNascarRaceIdForLeagueRace,
  runNameMatchesRace,
} from "./nascar-live";
import type { FetchLiveFeedResult } from "./nascar-live";
import {
  buildNumberToDriverId,
  resolveDriverIdFromVehicleNumber,
} from "./driver-mapping";
import { rescoreRace } from "./scoring";
import type { DriverDoc, LeagueDoc, RaceDoc, RaceDriverPoints } from "./types";

export type LiveSyncResult = { updated: true } | { updated: false; reason: string };

export async function applyNascarLiveFeedToLeague(
  leagueId: string,
  feedOverride?: FetchLiveFeedResult | null,
): Promise<LiveSyncResult> {
  const feed =
    feedOverride === undefined ? await fetchNascarLiveFeed() : feedOverride;

  const [leagueSnap, lockedSnap, scheduledSnap, driversSnap, latestStandingsSnap] = await Promise.all([
    leagueRef(leagueId).get(),
    racesRef(leagueId).where("status", "==", "locked").get(),
    racesRef(leagueId).where("status", "==", "scheduled").get(),
    driversRef(leagueId).get(),
    standingsSnapshotsRef(leagueId).orderBy("asOfDate", "desc").limit(1).get(),
  ]);
  const league = leagueSnap.exists ? (leagueSnap.data() as LeagueDoc) : null;
  const seasonYear = league?.seasonYear;
  const nowMs = Date.now();
  const raceDocs = [...lockedSnap.docs, ...scheduledSnap.docs];

  if (raceDocs.length === 0) {
    return { updated: false, reason: "No races in this league." };
  }

  const raceList =
    seasonYear != null ? await fetchNascarRaceListBasic(seasonYear) : [];

  const nascarRaceIdByLeagueRace = new Map<string, number>();
  raceDocs.forEach((raceDocSnap) => {
    const race = raceDocSnap.data() as RaceDoc;
    const nascarRaceId = resolveNascarRaceIdForLeagueRace({
      leagueRaceId: raceDocSnap.id,
      leagueRaceName: race.name,
      leagueRaceStartTimeMs: race.startTime.toMillis(),
      raceList,
    });
    if (nascarRaceId != null) {
      nascarRaceIdByLeagueRace.set(raceDocSnap.id, nascarRaceId);
    }
  });

  const singleRaceInLeague = raceDocs.length === 1;
  const theOnlyRaceId = singleRaceInLeague ? raceDocs[0].id : null;
  const pastRaces = raceDocs.filter((d) => (d.data() as RaceDoc).startTime.toMillis() <= nowMs);
  const mostRecentStarted =
    pastRaces.length > 0
      ? pastRaces.reduce((a, b) =>
          (a.data() as RaceDoc).startTime.toMillis() >= (b.data() as RaceDoc).startTime.toMillis() ? a : b,
        )
      : null;
  const futureRaces = raceDocs.filter((d) => (d.data() as RaceDoc).startTime.toMillis() > nowMs);
  const nextUpcoming =
    futureRaces.length > 0
      ? futureRaces.reduce((a, b) =>
          (a.data() as RaceDoc).startTime.toMillis() <= (b.data() as RaceDoc).startTime.toMillis() ? a : b,
        )
      : null;
  const fallbackRaceId = mostRecentStarted?.id ?? nextUpcoming?.id ?? theOnlyRaceId;
  const activeDriverIds = new Set<string>();
  const latestSnapshotDoc = latestStandingsSnap?.docs[0];
  if (latestSnapshotDoc) {
    const snapshot = latestSnapshotDoc.data() as { drivers?: Array<{ driverId?: string }> };
    for (const entry of snapshot.drivers ?? []) {
      if (entry?.driverId) activeDriverIds.add(entry.driverId);
    }
  }
  const numberToDriverId = buildNumberToDriverId(driversSnap, {
    includeDriverIds: activeDriverIds,
  });

  // When live feed is unavailable, try stage points only using the resolved NASCAR race_id for the current league race.
  if (!feed) {
    const targetRaceId = fallbackRaceId;
    if (!targetRaceId || seasonYear == null) {
      return { updated: false, reason: "Live feed unavailable." };
    }
    const nascarRaceId = nascarRaceIdByLeagueRace.get(targetRaceId) ?? null;
    if (nascarRaceId == null) {
      return {
        updated: false,
        reason: "Live feed unavailable and NASCAR race ID could not be resolved for this race.",
      };
    }
    const stagePointsByVehicle = await fetchNascarLiveStagePoints(seasonYear, nascarRaceId);
    if (stagePointsByVehicle.size === 0) {
      return { updated: false, reason: "Live feed unavailable; stage points API returned no data." };
    }
    const byDriverId = new Map<string, { basePoints: number; runningPosition?: number }>();
    for (const [vehicleNum, stagePts] of stagePointsByVehicle) {
      const driverId = resolveDriverIdFromVehicleNumber(vehicleNum, numberToDriverId);
      if (driverId) byDriverId.set(driverId, { basePoints: stagePts });
    }
    const drivers: RaceDriverPoints[] = Array.from(byDriverId.entries()).map(([driverId, { basePoints }]) => ({ driverId, basePoints }));
    if (drivers.length === 0) {
      return { updated: false, reason: "No drivers matched by car number between stage data and league." };
    }
    const racePointsData: Record<string, unknown> = {
      drivers,
      source: "nascar-live",
      lastSyncedAt: nowTimestamp(),
    };
    await racePointsRef(leagueId).doc(targetRaceId).set(racePointsData, { merge: true });
    await rescoreRace(leagueId, targetRaceId);
    logger.info("NASCAR live: applied stage points only (feed unavailable)", {
      leagueId,
      targetRaceId,
      nascarRaceId,
    });
    return { updated: true };
  }

  const stagePointsByVehicle =
    feed.raceId != null && seasonYear != null
      ? await fetchNascarLiveStagePoints(seasonYear, feed.raceId)
      : new Map<string, number>();

  let updated: LiveSyncResult = { updated: false, reason: "No matching race found for this league." };
  for (const raceDocSnap of raceDocs) {
    const race = raceDocSnap.data() as RaceDoc;
    const raceId = raceDocSnap.id;
    const nameMatches = runNameMatchesRace(feed.runName, race.name);
    const isOnlyRace = theOnlyRaceId !== null && raceId === theOnlyRaceId;
    const isFallback = fallbackRaceId !== null && raceId === fallbackRaceId;
    const matchesNascarRaceId =
      feed.raceId != null && nascarRaceIdByLeagueRace.get(raceId) === feed.raceId;
    const useThisRace = nameMatches || isOnlyRace || isFallback || matchesNascarRaceId;
    if (!useThisRace) continue;

    const byDriverId = new Map<string, { basePoints: number; runningPosition?: number }>();
    for (const [vehicleNum, stagePts] of stagePointsByVehicle) {
      const driverId = resolveDriverIdFromVehicleNumber(vehicleNum, numberToDriverId);
      if (driverId) byDriverId.set(driverId, { basePoints: stagePts });
    }
    for (const fd of feed.drivers) {
      const driverId = resolveDriverIdFromVehicleNumber(fd.vehicleNumber, numberToDriverId);
      if (driverId) {
        const normalizedVehicleNum = fd.vehicleNumber.trim();
        const numericVehicleNum = String(Number(fd.vehicleNumber));
        const stagePts =
          stagePointsByVehicle.get(normalizedVehicleNum) ??
          stagePointsByVehicle.get(numericVehicleNum) ??
          0;
        byDriverId.set(driverId, {
          basePoints: fd.basePoints + stagePts,
          runningPosition: fd.runningPosition,
        });
      }
    }

    const drivers: RaceDriverPoints[] = Array.from(byDriverId.entries()).map(([driverId, { basePoints, runningPosition }]) =>
      runningPosition != null ? { driverId, basePoints, runningPosition } : { driverId, basePoints },
    );
    if (drivers.length === 0) {
      updated = { updated: false, reason: "No drivers matched by car number between stage/feed and league." };
      continue;
    }

    const racePointsData: Record<string, unknown> = {
      drivers,
      source: "nascar-live",
      lastSyncedAt: nowTimestamp(),
    };
    if (feed.lapNumber != null) racePointsData.liveLapNumber = feed.lapNumber;
    if (feed.lapsInRace != null) racePointsData.liveLapsInRace = feed.lapsInRace;
    if (feed.lapsToGo != null) racePointsData.liveLapsToGo = feed.lapsToGo;
    if (feed.stage) {
      racePointsData.liveStage = {
        stageNum: feed.stage.stageNum,
        finishAtLap: feed.stage.finishAtLap,
        lapsInStage: feed.stage.lapsInStage,
      };
    }
    await racePointsRef(leagueId).doc(raceId).set(racePointsData, { merge: true });
    await rescoreRace(leagueId, raceId);
    return { updated: true };
  }
  return updated;
}

export async function syncLiveRaceForLeagues(
  leagueIds: string[],
  feed: FetchLiveFeedResult,
  batchSize = 8,
): Promise<void> {
  for (let i = 0; i < leagueIds.length; i += batchSize) {
    const batch = leagueIds.slice(i, i + batchSize);
    await Promise.all(batch.map((leagueId) => applyNascarLiveFeedToLeague(leagueId, feed)));
  }
}
