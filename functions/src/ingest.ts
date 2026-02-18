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
  fetchNascarCupPointsStandings,
  type NascarPointsStandingsEntry,
  type NascarRaceListBasicEntry,
  fetchNascarRaceListBasic,
  parseNascarDateTime,
  resolveNascarRaceIdForLeagueRace,
} from "./nascar-live";
import {
  buildNumberToDriverId,
  mapOfficialResultsToDrivers,
  mapVehiclePointsToDrivers,
} from "./driver-mapping";
import { rescoreRace } from "./scoring";
import { recomputeTiersForUpcomingRaces } from "./tiers";
import type {
  DriverDoc,
  LeagueDoc,
  RaceDoc,
  RaceStatus,
  StandingEntry,
} from "./types";
import { toDocId } from "./utils";

/** Legacy no-points ids used by previous static schedule seeds; removed after refresh. */
const LEGACY_NON_POINTS_RACE_IDS = [
  "2026-cook-out-clash",
  "2026-duel-1",
  "2026-duel-2",
  "2026-all-star",
];

function normalizeDriverName(name: string): string {
  return (name ?? "")
    .normalize("NFKD")
    .replace(/[\u0300-\u036f]/g, "")
    .toLowerCase()
    .replace(/[^a-z0-9]/g, "");
}

function normalizeVehicleNumber(number: string | undefined): string {
  if (!number) return "";
  return String(number).trim();
}

function resolveRaceStartDate(race: NascarRaceListBasicEntry): Date | null {
  return (
    parseNascarDateTime(race.race_date) ??
    parseNascarDateTime(race.date_scheduled) ??
    null
  );
}

function deriveRaceStatusFromNascarRace(
  race: NascarRaceListBasicEntry,
  raceStartMs: number,
  nowMs: number,
): RaceStatus {
  const scheduledLaps =
    typeof race.scheduled_laps === "number" ? race.scheduled_laps : 0;
  const actualLaps = typeof race.actual_laps === "number" ? race.actual_laps : 0;
  if (actualLaps > 0 && (scheduledLaps === 0 || actualLaps >= scheduledLaps)) {
    return "completed";
  }
  if (raceStartMs <= nowMs) {
    return "locked";
  }
  return "scheduled";
}

function reconcileRaceStatus(params: {
  existingStatus?: RaceStatus;
  derivedStatus: RaceStatus;
  raceStartMs: number;
  nowMs: number;
}): RaceStatus {
  const { existingStatus, derivedStatus, raceStartMs, nowMs } = params;
  // Future races should never remain locked/completed due to stale state.
  if (raceStartMs > nowMs) {
    return "scheduled";
  }
  if (derivedStatus === "completed" || existingStatus === "completed") {
    return "completed";
  }
  if (derivedStatus === "locked" || existingStatus === "locked") {
    return "locked";
  }
  return "scheduled";
}

function buildDefaultRaceDocIds(
  seasonYear: number,
  pointsRaces: Array<NascarRaceListBasicEntry & { race_id: number }>,
): Map<number, string> {
  const used = new Set<string>();
  const byRaceId = new Map<number, string>();

  for (const race of pointsRaces) {
    const baseId = toDocId(`${seasonYear}-${race.race_name ?? `race-${race.race_id}`}`);
    let candidate = baseId || `${seasonYear}-race-${race.race_id}`;

    if (used.has(candidate)) {
      const withTrack = toDocId(`${candidate}-${race.track_name ?? ""}`);
      candidate = withTrack || `${candidate}-${race.race_id}`;
    }
    if (used.has(candidate)) {
      candidate = toDocId(`${candidate}-${race.race_id}`) || `${seasonYear}-race-${race.race_id}`;
    }
    while (used.has(candidate)) {
      candidate = `${candidate}-${race.race_id}`;
    }

    used.add(candidate);
    byRaceId.set(race.race_id, candidate);
  }

  return byRaceId;
}

function resolveExistingRaceIdByNascarRaceId(
  raceDocSnap: FirebaseFirestore.QueryDocumentSnapshot,
  raceList: NascarRaceListBasicEntry[],
): number | null {
  const race = raceDocSnap.data() as RaceDoc;
  if (typeof race.nascarRaceId === "number") {
    return race.nascarRaceId;
  }
  const startTimeMs = race.startTime?.toMillis?.();
  if (!Number.isFinite(startTimeMs)) return null;
  return resolveNascarRaceIdForLeagueRace({
    leagueRaceId: raceDocSnap.id,
    leagueRaceName: race.name,
    leagueRaceStartTimeMs: startTimeMs,
    raceList,
  });
}

function parseStandings(
  rows: NascarPointsStandingsEntry[],
): Array<{
  position: number;
  driverName: string;
  vehicleNumber: string;
  nascarDriverId: number | null;
  manufacturer: string;
  providerDriverKey: string;
}> {
  return rows
    .map((row) => {
      const position =
        typeof row.position === "number" && Number.isFinite(row.position)
          ? row.position
          : Number(row.position);
      const driverName = String(row.driver_name ?? "").trim();
      const vehicleNumber = normalizeVehicleNumber(row.car_no);
      const nascarDriverId =
        typeof row.driver_id === "number" && Number.isFinite(row.driver_id)
          ? row.driver_id
          : null;
      const manufacturer = String(row.manufacturer ?? "").trim();
      const providerDriverKey = toDocId(driverName);
      if (!Number.isFinite(position) || position <= 0) return null;
      if (!driverName || !vehicleNumber) return null;
      if (!providerDriverKey) return null;

      return {
        position,
        driverName,
        vehicleNumber,
        nascarDriverId,
        manufacturer,
        providerDriverKey,
      };
    })
    .filter(
      (
        row,
      ): row is {
        position: number;
        driverName: string;
        vehicleNumber: string;
        nascarDriverId: number | null;
        manufacturer: string;
        providerDriverKey: string;
      } => row !== null,
    )
    .sort((a, b) => a.position - b.position);
}

export async function ingestScheduleAndStandings(leagueId: string): Promise<void> {
  const leagueSnap = await leagueRef(leagueId).get();
  if (!leagueSnap.exists) {
    logger.warn("League not found while ingesting schedule", { leagueId });
    return;
  }

  const league = leagueSnap.data() as LeagueDoc;
  const seasonYear = league.seasonYear;

  logger.info("Ingesting schedule and standings from NASCAR CF feeds", {
    leagueId,
    seasonYear,
  });

  const [raceList, standingsRaw, existingRacesSnap, existingDriversSnap] = await Promise.all([
    fetchNascarRaceListBasic(seasonYear),
    fetchNascarCupPointsStandings(seasonYear),
    racesRef(leagueId).get(),
    driversRef(leagueId).get(),
  ]);

  const pointsRaces = raceList
    .filter(
      (
        race,
      ): race is NascarRaceListBasicEntry & {
        race_id: number;
      } => typeof race.race_id === "number",
    )
    .filter((race) => (race.series_id ?? 1) === 1)
    .filter((race) => (race.race_type_id ?? 1) === 1)
    .sort((a, b) => {
      const aDateMs = resolveRaceStartDate(a)?.getTime() ?? Number.MAX_SAFE_INTEGER;
      const bDateMs = resolveRaceStartDate(b)?.getTime() ?? Number.MAX_SAFE_INTEGER;
      return aDateMs - bDateMs || a.race_id - b.race_id;
    });

  const pointsRaceIdSet = new Set(pointsRaces.map((race) => race.race_id));
  const defaultRaceIdByNascarRaceId = buildDefaultRaceDocIds(seasonYear, pointsRaces);

  const existingRaceById = new Map<string, RaceDoc>();
  existingRacesSnap.forEach((docSnap) => {
    existingRaceById.set(docSnap.id, docSnap.data() as RaceDoc);
  });

  const existingRaceIdByNascarRaceId = new Map<number, string>();
  for (const raceDocSnap of existingRacesSnap.docs) {
    const nascarRaceId = resolveExistingRaceIdByNascarRaceId(raceDocSnap, raceList);
    if (nascarRaceId == null) continue;
    if (!existingRaceIdByNascarRaceId.has(nascarRaceId)) {
      existingRaceIdByNascarRaceId.set(nascarRaceId, raceDocSnap.id);
      continue;
    }
    if (existingRaceIdByNascarRaceId.get(nascarRaceId) !== raceDocSnap.id) {
      logger.warn("Multiple league races resolved to same NASCAR race_id", {
        leagueId,
        nascarRaceId,
        keptRaceId: existingRaceIdByNascarRaceId.get(nascarRaceId),
        ignoredRaceId: raceDocSnap.id,
      });
    }
  }

  const nowMs = Date.now();
  const scheduleWrites: Promise<FirebaseFirestore.WriteResult>[] = [];
  pointsRaces.forEach((race, index) => {
    const raceId =
      existingRaceIdByNascarRaceId.get(race.race_id) ??
      defaultRaceIdByNascarRaceId.get(race.race_id) ??
      `${seasonYear}-race-${race.race_id}`;
    const existingRace = existingRaceById.get(raceId);

    const raceStartDate = resolveRaceStartDate(race);
    const providerStartTime = raceStartDate
      ? Timestamp.fromDate(raceStartDate)
      : null;
    // Prefer provider schedule to avoid drifting toward stale seed dates.
    const startTime = providerStartTime ?? existingRace?.startTime ?? Timestamp.now();
    const lockTime = providerStartTime ?? existingRace?.lockTime ?? startTime;
    const raceStartMs = startTime.toMillis();

    const derivedStatus = deriveRaceStatusFromNascarRace(
      race,
      raceStartMs,
      nowMs,
    );
    const status = reconcileRaceStatus({
      existingStatus: existingRace?.status,
      derivedStatus,
      raceStartMs,
      nowMs,
    });

    scheduleWrites.push(
      racesRef(leagueId).doc(raceId).set(
        {
          name: race.race_name ?? `Race ${index + 1}`,
          track: race.track_name ?? "",
          weekIndex: index + 1,
          startTime,
          lockTime,
          status,
          nascarRaceId: race.race_id,
          tvChannel: race.television_broadcaster ?? existingRace?.tvChannel ?? undefined,
          lastSyncedAt: nowTimestamp(),
        } as Partial<RaceDoc>,
        { merge: true },
      ),
    );
  });
  await Promise.all(scheduleWrites);

  // Remove legacy no-points races and any race doc that resolves to a non-points NASCAR race.
  const deleteWrites: Promise<FirebaseFirestore.WriteResult>[] = [];
  for (const raceDocSnap of existingRacesSnap.docs) {
    const raceId = raceDocSnap.id;
    if (LEGACY_NON_POINTS_RACE_IDS.includes(raceId)) {
      deleteWrites.push(racesRef(leagueId).doc(raceId).delete());
      deleteWrites.push(tiersRef(leagueId).doc(raceId).delete());
      continue;
    }
    const nascarRaceId = resolveExistingRaceIdByNascarRaceId(raceDocSnap, raceList);
    if (nascarRaceId != null && !pointsRaceIdSet.has(nascarRaceId)) {
      deleteWrites.push(racesRef(leagueId).doc(raceId).delete());
      deleteWrites.push(tiersRef(leagueId).doc(raceId).delete());
    }
  }
  await Promise.all(deleteWrites);

  const parsedStandings = parseStandings(standingsRaw);
  if (parsedStandings.length === 0) {
    logger.warn("NASCAR standings feed returned no usable entries; tier update skipped", {
      leagueId,
      seasonYear,
    });
    return;
  }

  const driverIdByNascarDriverId = new Map<number, string>();
  const driverIdByVehicleNumber = new Map<string, string>();
  const driverIdByName = new Map<string, string>();
  existingDriversSnap.forEach((docSnap) => {
    const driver = docSnap.data() as DriverDoc;
    if (typeof driver.nascarDriverId === "number") {
      driverIdByNascarDriverId.set(driver.nascarDriverId, docSnap.id);
    }
    const vehicleNumber = normalizeVehicleNumber(driver.number);
    if (vehicleNumber && !driverIdByVehicleNumber.has(vehicleNumber)) {
      driverIdByVehicleNumber.set(vehicleNumber, docSnap.id);
    }
    if (vehicleNumber) {
      const numeric = Number(vehicleNumber);
      if (
        !Number.isNaN(numeric) &&
        !driverIdByVehicleNumber.has(String(numeric))
      ) {
        driverIdByVehicleNumber.set(String(numeric), docSnap.id);
      }
    }
    const nameKey = normalizeDriverName(driver.name);
    if (nameKey && !driverIdByName.has(nameKey)) {
      driverIdByName.set(nameKey, docSnap.id);
    }
  });

  const standingsEntries: StandingEntry[] = [];
  const driverWrites: Promise<FirebaseFirestore.WriteResult>[] = [];
  const seenDriverIds = new Set<string>();

  for (const standing of parsedStandings) {
    let driverId: string | null = null;
    if (
      standing.nascarDriverId != null &&
      driverIdByNascarDriverId.has(standing.nascarDriverId)
    ) {
      driverId = driverIdByNascarDriverId.get(standing.nascarDriverId) ?? null;
    }
    if (!driverId) {
      driverId =
        driverIdByVehicleNumber.get(standing.vehicleNumber) ??
        null;
    }
    if (!driverId) {
      const numeric = Number(standing.vehicleNumber);
      if (!Number.isNaN(numeric)) {
        driverId = driverIdByVehicleNumber.get(String(numeric)) ?? null;
      }
    }
    if (!driverId) {
      driverId =
        driverIdByName.get(normalizeDriverName(standing.driverName)) ??
        null;
    }
    if (!driverId) {
      driverId = standing.providerDriverKey;
    }
    if (seenDriverIds.has(driverId)) {
      continue;
    }
    seenDriverIds.add(driverId);

    if (standing.nascarDriverId != null) {
      driverIdByNascarDriverId.set(standing.nascarDriverId, driverId);
    }
    driverIdByVehicleNumber.set(standing.vehicleNumber, driverId);
    const numericVehicle = Number(standing.vehicleNumber);
    if (!Number.isNaN(numericVehicle)) {
      driverIdByVehicleNumber.set(String(numericVehicle), driverId);
    }
    driverIdByName.set(normalizeDriverName(standing.driverName), driverId);

    const driverDoc: DriverDoc = {
      name: standing.driverName,
      number: standing.vehicleNumber,
      // racinginsights feed includes manufacturer but not team; keep non-empty for UI compatibility.
      team: standing.manufacturer || "Unknown Team",
      providerDriverKey: standing.providerDriverKey,
      nascarDriverId: standing.nascarDriverId ?? undefined,
    };

    standingsEntries.push({
      driverId,
      position: standing.position,
    });
    driverWrites.push(
      driversRef(leagueId).doc(driverId).set(driverDoc, { merge: true }),
    );
  }

  await Promise.all(driverWrites);

  const completedRaceCount = pointsRaces.filter((race) => {
    const raceStartMs = resolveRaceStartDate(race)?.getTime() ?? Number.MAX_SAFE_INTEGER;
    return deriveRaceStatusFromNascarRace(race, raceStartMs, nowMs) === "completed";
  }).length;

  await standingsSnapshotsRef(leagueId).doc("latest").set({
    asOfDate: nowTimestamp(),
    weekIndex: Math.max(1, completedRaceCount || 1),
    drivers: standingsEntries,
  }, { merge: true });

  await recomputeTiersForUpcomingRaces(leagueId);
}

export async function refreshRecentRaceResults(
  leagueId: string,
  lookbackDays = 5,
): Promise<void> {
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

    const nascarRaceId =
      typeof race.nascarRaceId === "number"
        ? race.nascarRaceId
        : resolveNascarRaceIdForLeagueRace({
            leagueRaceId: raceDocSnap.id,
            leagueRaceName: race.name,
            leagueRaceStartTimeMs: raceStartMs,
            raceList,
          });
    if (nascarRaceId == null) {
      continue;
    }

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
            source: "nascar-cf",
            lastSyncedAt: nowTimestamp(),
          },
          { merge: true },
        ),
        racesRef(leagueId).doc(raceDocSnap.id).set(
          {
            status: "completed",
            nascarRaceId,
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
            source: "nascar-cf",
            lastSyncedAt: nowTimestamp(),
          },
          { merge: true },
        ),
        racesRef(leagueId).doc(raceDocSnap.id).set(
          {
            status: "completed",
            nascarRaceId,
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
}
