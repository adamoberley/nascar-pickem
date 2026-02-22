import { FieldValue } from "firebase-admin/firestore";
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

function raceHasLockedOrStarted(race: RaceDoc, nowMs: number): boolean {
  const lockMs = race.lockTime?.toMillis?.() ?? Number.POSITIVE_INFINITY;
  const startMs = race.startTime?.toMillis?.() ?? Number.POSITIVE_INFINITY;
  return lockMs <= nowMs || startMs <= nowMs;
}

async function clearFutureNascarLiveRacePoints(
  leagueId: string,
  futureRaceDocs: FirebaseFirestore.QueryDocumentSnapshot[],
): Promise<number> {
  if (futureRaceDocs.length === 0) return 0;

  const pointSnaps = await Promise.all(
    futureRaceDocs.map((raceDocSnap) => racePointsRef(leagueId).doc(raceDocSnap.id).get()),
  );
  const writes: Array<Promise<FirebaseFirestore.WriteResult>> = [];

  pointSnaps.forEach((snap, index) => {
    if (!snap.exists) return;
    const data = snap.data() as { source?: string } | undefined;
    if (data?.source !== "nascar-live") return;
    writes.push(
      racePointsRef(leagueId).doc(futureRaceDocs[index].id).set(
        {
          source: FieldValue.delete(),
          drivers: FieldValue.delete(),
          liveLapNumber: FieldValue.delete(),
          liveLapsInRace: FieldValue.delete(),
          liveLapsToGo: FieldValue.delete(),
          liveStage: FieldValue.delete(),
          lastSyncedAt: nowTimestamp(),
        },
        { merge: true },
      ),
    );
  });

  if (writes.length > 0) {
    await Promise.all(writes);
  }
  return writes.length;
}

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

  const liveEligibleRaceDocs = raceDocs.filter((raceDocSnap) =>
    raceHasLockedOrStarted(raceDocSnap.data() as RaceDoc, nowMs),
  );
  const futureRaceDocs = raceDocs.filter(
    (raceDocSnap) => !raceHasLockedOrStarted(raceDocSnap.data() as RaceDoc, nowMs),
  );
  const clearedFutureLiveDocs = await clearFutureNascarLiveRacePoints(leagueId, futureRaceDocs);
  if (clearedFutureLiveDocs > 0) {
    logger.info("Cleared stale nascar-live points from future races", {
      leagueId,
      clearedFutureLiveDocs,
    });
  }
  if (liveEligibleRaceDocs.length === 0) {
    return { updated: false, reason: "No race has reached lock/start time yet." };
  }

  const raceList =
    seasonYear != null ? await fetchNascarRaceListBasic(seasonYear) : [];

  const nascarRaceIdByLeagueRace = new Map<string, number>();
  liveEligibleRaceDocs.forEach((raceDocSnap) => {
    const race = raceDocSnap.data() as RaceDoc;
    const nascarRaceId =
      typeof race.nascarRaceId === "number"
        ? race.nascarRaceId
        : resolveNascarRaceIdForLeagueRace({
            leagueRaceId: raceDocSnap.id,
            leagueRaceName: race.name,
            leagueRaceStartTimeMs: race.startTime.toMillis(),
            raceList,
          });
    if (nascarRaceId != null) {
      nascarRaceIdByLeagueRace.set(raceDocSnap.id, nascarRaceId);
    }
  });

  const singleRaceInLeague = liveEligibleRaceDocs.length === 1;
  const theOnlyRaceId = singleRaceInLeague ? liveEligibleRaceDocs[0].id : null;
  const pastRaces = liveEligibleRaceDocs.filter((d) => (d.data() as RaceDoc).startTime.toMillis() <= nowMs);
  const mostRecentStarted =
    pastRaces.length > 0
      ? pastRaces.reduce((a, b) =>
          (a.data() as RaceDoc).startTime.toMillis() >= (b.data() as RaceDoc).startTime.toMillis() ? a : b,
        )
      : null;
  const fallbackRaceId = mostRecentStarted?.id ?? theOnlyRaceId;
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
    if (!targetRaceId) {
      return { updated: false, reason: "Live feed unavailable and no race is currently lock/start eligible." };
    }
    if (seasonYear == null) {
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

  const candidates = liveEligibleRaceDocs.map((raceDocSnap) => {
    const race = raceDocSnap.data() as RaceDoc;
    const raceId = raceDocSnap.id;
    return {
      raceDocSnap,
      race,
      raceId,
      nameMatches: runNameMatchesRace(feed.runName, race.name),
      isOnlyRace: theOnlyRaceId !== null && raceId === theOnlyRaceId,
      isFallback: fallbackRaceId !== null && raceId === fallbackRaceId,
      matchesNascarRaceId:
        feed.raceId != null && nascarRaceIdByLeagueRace.get(raceId) === feed.raceId,
    };
  });

  const targetCandidate =
    candidates.find((c) => c.matchesNascarRaceId) ??
    candidates.find((c) => c.nameMatches) ??
    candidates.find((c) => c.isOnlyRace || c.isFallback);

  if (!targetCandidate) {
    return { updated: false, reason: "No matching lock/start-eligible race found for this league." };
  }

  const runningPositionByDriverId = new Map<string, number>();
  for (const fd of feed.drivers) {
    const driverId = resolveDriverIdFromVehicleNumber(fd.vehicleNumber, numberToDriverId);
    if (driverId) runningPositionByDriverId.set(driverId, fd.runningPosition);
  }

  const byDriverId = new Map<string, { basePoints: number; runningPosition?: number }>();
  for (const [vehicleNum, stagePts] of stagePointsByVehicle) {
    const driverId = resolveDriverIdFromVehicleNumber(vehicleNum, numberToDriverId);
    if (!driverId) continue;
    byDriverId.set(driverId, {
      basePoints: stagePts,
      runningPosition: runningPositionByDriverId.get(driverId),
    });
  }

  const drivers: RaceDriverPoints[] = Array.from(byDriverId.entries()).map(([driverId, { basePoints, runningPosition }]) =>
    runningPosition != null ? { driverId, basePoints, runningPosition } : { driverId, basePoints },
  );
  if (drivers.length === 0) {
    return { updated: false, reason: "No drivers matched by car number between stage data and league." };
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
  await racePointsRef(leagueId).doc(targetCandidate.raceId).set(racePointsData, { merge: true });
  await rescoreRace(leagueId, targetCandidate.raceId);
  return { updated: true };
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
