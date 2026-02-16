import { Timestamp } from "firebase-admin/firestore";
import { logger } from "firebase-functions";
import {
  driversRef,
  leagueRef,
  nowTimestamp,
  racePointsRef,
  racesRef,
  standingsSnapshotsRef,
  tiersRef,
} from "./data";
import {
  fetchNascarCompletedRaceOfficialResults,
  fetchNascarCompletedRacePoints,
  fetchNascarRaceListBasic,
  resolveNascarRaceIdForLeagueRace,
} from "./nascar-live";
import {
  buildNumberToDriverId,
  mapOfficialResultsToDrivers,
  mapVehiclePointsToDrivers,
} from "./driver-mapping";
import { getProvider, normalizeRaceStatus } from "./provider";
import { rescoreRace } from "./scoring";
import { recomputeTiersForUpcomingRaces } from "./tiers";
import type { DriverDoc, LeagueDoc, RaceDoc, RaceStatus, StandingEntry } from "./types";
import { toDocId } from "./utils";

/** Races that do not award points; excluded from schedule and tier computation. */
const NON_POINTS_RACE_IDS = [
  "2026-cook-out-clash", // Cook Out Clash
  "2026-duel-1", // America 250 Florida Duel 1
  "2026-duel-2", // America 250 Florida Duel 2
  "2026-all-star", // NASCAR All-Star Race
];

const RACE_STATUS_RANK: Record<RaceStatus, number> = {
  scheduled: 0,
  locked: 1,
  completed: 2,
};

function maxRaceStatus(left: RaceStatus, right: RaceStatus): RaceStatus {
  return RACE_STATUS_RANK[left] >= RACE_STATUS_RANK[right] ? left : right;
}

export async function ingestScheduleAndStandings(leagueId: string): Promise<void> {
  const provider = getProvider();
  const leagueSnap = await leagueRef(leagueId).get();
  if (!leagueSnap.exists) {
    logger.warn("League not found while ingesting schedule", { leagueId });
    return;
  }

  const league = leagueSnap.data() as LeagueDoc;
  const seasonYear = league.seasonYear;

  logger.info("Ingesting schedule and standings", {
    leagueId,
    provider: provider.name,
    seasonYear,
  });

  const [rawSchedule, standings, existingRacesSnap] = await Promise.all([
    provider.fetchSchedule(seasonYear),
    provider.fetchStandings(seasonYear),
    racesRef(leagueId).get(),
  ]);
  const existingRaceById = new Map<string, RaceDoc>();
  existingRacesSnap.forEach((docSnap) => {
    existingRaceById.set(docSnap.id, docSnap.data() as RaceDoc);
  });

  const schedule = rawSchedule.filter(
    (race) => !NON_POINTS_RACE_IDS.includes(race.id),
  );

  const scheduleWrites: Promise<FirebaseFirestore.WriteResult>[] = [];
  schedule.forEach((race) => {
    const raceId = toDocId(race.id);
    const providerStartTime = Timestamp.fromDate(new Date(race.startTimeIso));
    const existingRace = existingRaceById.get(raceId);
    const existingStatus = existingRace?.status;
    const existingLockMs = existingRace?.lockTime?.toMillis?.() ?? 0;
    const nowMs = Date.now();
    const hasStarted = existingLockMs > 0 && existingLockMs <= nowMs;
    const providerStatus = normalizeRaceStatus(race.status);
    const status = existingStatus
      ? maxRaceStatus(existingStatus, providerStatus)
      : providerStatus;
    const shouldPreserveTiming =
      existingRace != null &&
      (existingStatus === "completed" || hasStarted || status === "completed");
    const startTime = shouldPreserveTiming
      ? existingRace.startTime
      : providerStartTime;
    const lockTime = shouldPreserveTiming
      ? existingRace.lockTime
      : providerStartTime;

    scheduleWrites.push(
      racesRef(leagueId).doc(raceId).set(
        {
          name: race.name,
          track: race.track,
          weekIndex: race.weekIndex,
          startTime,
          lockTime,
          status,
          providerRaceKey: race.id,
          lastSyncedAt: nowTimestamp(),
        } as Partial<RaceDoc>,
        { merge: true },
      ),
    );
  });

  await Promise.all(scheduleWrites);

  // Remove non-points races from existing leagues so they disappear after refresh
  const deleteWrites: Promise<FirebaseFirestore.WriteResult>[] = [];
  for (const raceId of NON_POINTS_RACE_IDS) {
    const docId = toDocId(raceId);
    deleteWrites.push(racesRef(leagueId).doc(docId).delete());
    deleteWrites.push(tiersRef(leagueId).doc(docId).delete());
  }
  await Promise.all(deleteWrites);

  if (standings.length > 0) {
    const standingsEntries: StandingEntry[] = [];
    const driverWrites: Promise<FirebaseFirestore.WriteResult>[] = [];

    standings.forEach((standing) => {
      const driverId = toDocId(standing.providerDriverKey);
      const driverDoc: DriverDoc = {
        name: standing.name,
        number: standing.number,
        team: standing.team,
        providerDriverKey: standing.providerDriverKey,
      };

      standingsEntries.push({
        driverId,
        position: standing.position,
      });

      driverWrites.push(driversRef(leagueId).doc(driverId).set(driverDoc, { merge: true }));
    });

    await Promise.all(driverWrites);

    const weekIndex = Math.max(1, ...schedule.map((race) => race.weekIndex || 1));

    await standingsSnapshotsRef(leagueId).add({
      asOfDate: nowTimestamp(),
      weekIndex,
      drivers: standingsEntries,
    });

    await recomputeTiersForUpcomingRaces(leagueId);
  } else {
    logger.warn("Standings provider returned no entries; tier update skipped", {
      leagueId,
      provider: provider.name,
    });
  }
}

export async function refreshRecentRaceResults(
  leagueId: string,
  lookbackDays = 5,
): Promise<void> {
  const provider = getProvider();
  const leagueSnap = await leagueRef(leagueId).get();
  if (!leagueSnap.exists) {
    return;
  }

  const league = leagueSnap.data() as LeagueDoc;
  const seasonYear = league.seasonYear;

  const [raceSnap, driverSnap, latestStandingsSnap] = await Promise.all([
    racesRef(leagueId).get(),
    driversRef(leagueId).get(),
    standingsSnapshotsRef(leagueId).orderBy("asOfDate", "desc").limit(1).get(),
  ]);
  const raceList = await fetchNascarRaceListBasic(seasonYear);

  const driverIdByProviderKey = new Map<string, string>();
  driverSnap.forEach((doc) => {
    const driver = doc.data() as DriverDoc;
    if (driver.providerDriverKey) {
      driverIdByProviderKey.set(driver.providerDriverKey, doc.id);
    }
  });
  const activeDriverIds = new Set<string>();
  const latestSnapshotDoc = latestStandingsSnap.docs[0];
  if (latestSnapshotDoc) {
    const snapshot = latestSnapshotDoc.data() as { drivers?: Array<{ driverId?: string }> };
    for (const entry of snapshot.drivers ?? []) {
      if (entry?.driverId) activeDriverIds.add(entry.driverId);
    }
  }
  const driverIdByNumber = buildNumberToDriverId(driverSnap, {
    includeDriverIds: activeDriverIds,
  });

  const now = Date.now();
  const cutoff = now - lookbackDays * 24 * 60 * 60 * 1000;

  for (const raceDocSnap of raceSnap.docs) {
    const race = raceDocSnap.data() as RaceDoc;
    const raceStartMs = race.startTime.toMillis();
    if (raceStartMs > now || raceStartMs < cutoff) {
      continue;
    }

    const nascarRaceId = resolveNascarRaceIdForLeagueRace({
      leagueRaceId: raceDocSnap.id,
      leagueRaceName: race.name,
      leagueRaceStartTimeMs: raceStartMs,
      raceList,
    });
    if (nascarRaceId != null) {
      const nascarOfficialResults = await fetchNascarCompletedRaceOfficialResults(
        seasonYear,
        nascarRaceId,
      );
      const nascarOfficialResultsForDoc = nascarOfficialResults.map((row) => ({
        finishPosition: row.finishPosition,
        driverName: row.driverName,
        points: row.points,
        vehicleNumber: row.vehicleNumber,
      }));
      const nascarPointsFromOfficial = mapOfficialResultsToDrivers(
        nascarOfficialResults,
        driverIdByNumber,
      );
      const nascarPoints =
        nascarPointsFromOfficial.length > 0
          ? nascarPointsFromOfficial
          : mapVehiclePointsToDrivers(
              await fetchNascarCompletedRacePoints(
                seasonYear,
                nascarRaceId,
              ),
              driverIdByNumber,
            );
      if (nascarPoints.length >= 20) {
        await Promise.all([
          racePointsRef(leagueId).doc(raceDocSnap.id).set(
            {
              drivers: nascarPoints,
              officialResults: nascarOfficialResultsForDoc,
              source: "nascar-cf-cacher",
              lastSyncedAt: nowTimestamp(),
            },
            { merge: true },
          ),
          racesRef(leagueId).doc(raceDocSnap.id).set(
            {
              status: "completed",
              lastSyncedAt: nowTimestamp(),
            },
            { merge: true },
          ),
        ]);
        await rescoreRace(leagueId, raceDocSnap.id);
        continue;
      }
      if (nascarOfficialResultsForDoc.length > 0) {
        await Promise.all([
          racePointsRef(leagueId).doc(raceDocSnap.id).set(
            {
              officialResults: nascarOfficialResultsForDoc,
              source: "nascar-cf-cacher",
              lastSyncedAt: nowTimestamp(),
            },
            { merge: true },
          ),
          racesRef(leagueId).doc(raceDocSnap.id).set(
            {
              status: "completed",
              lastSyncedAt: nowTimestamp(),
            },
            { merge: true },
          ),
        ]);
      }
      if (nascarPoints.length > 0) {
        logger.warn("NASCAR points mapped to too few league drivers; skipping update", {
          leagueId,
          raceId: raceDocSnap.id,
          nascarRaceId,
          mappedDrivers: nascarPoints.length,
        });
      }
    }

    if (!race.providerRaceKey) {
      continue;
    }

    const result = await provider.fetchRaceResult(race.providerRaceKey, seasonYear);
    if (!result) continue;
    if (result.points.length === 0) {
      logger.info("Provider returned empty points; skipping race status update", {
        leagueId,
        raceId: raceDocSnap.id,
        provider: provider.name,
      });
      continue;
    }

    const points = result.points
      .map((entry) => {
        const driverId = driverIdByProviderKey.get(entry.providerDriverKey);
        if (!driverId) {
          return null;
        }
        return {
          driverId,
          basePoints: entry.points,
        };
      })
      .filter((entry): entry is { driverId: string; basePoints: number } => entry !== null);
    if (points.length === 0) {
      logger.warn("Provider returned points but none mapped to league drivers", {
        leagueId,
        raceId: raceDocSnap.id,
        provider: provider.name,
      });
      continue;
    }

    await Promise.all([
      racePointsRef(leagueId).doc(raceDocSnap.id).set(
        {
          drivers: points,
          source: provider.name,
          lastSyncedAt: nowTimestamp(),
        },
        { merge: true },
      ),
      racesRef(leagueId).doc(raceDocSnap.id).set(
        {
          status: normalizeRaceStatus(result.status),
          lastSyncedAt: nowTimestamp(),
        },
        { merge: true },
      ),
    ]);

    await rescoreRace(leagueId, raceDocSnap.id);
  }
}
