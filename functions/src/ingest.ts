import { Timestamp } from "firebase-admin/firestore";
import { logger } from "firebase-functions";
import {
  driversRef,
  leagueRef,
  nowTimestamp,
  racePointsRef,
  racesRef,
  standingsSnapshotsRef,
} from "./data";
import { getProvider, normalizeRaceStatus } from "./provider";
import { rescoreRace } from "./scoring";
import { recomputeTiersForUpcomingRaces } from "./tiers";
import type { DriverDoc, LeagueDoc, RaceDoc, StandingEntry } from "./types";
import { toDocId } from "./utils";

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

  const [schedule, standings] = await Promise.all([
    provider.fetchSchedule(seasonYear),
    provider.fetchStandings(seasonYear),
  ]);

  const scheduleWrites: Promise<FirebaseFirestore.WriteResult>[] = [];
  schedule.forEach((race) => {
    const raceId = toDocId(race.id);
    const startTime = Timestamp.fromDate(new Date(race.startTimeIso));

    scheduleWrites.push(
      racesRef(leagueId).doc(raceId).set(
        {
          name: race.name,
          track: race.track,
          weekIndex: race.weekIndex,
          startTime,
          lockTime: startTime,
          status: normalizeRaceStatus(race.status),
          providerRaceKey: race.id,
          lastSyncedAt: nowTimestamp(),
        } as Partial<RaceDoc>,
        { merge: true },
      ),
    );
  });

  await Promise.all(scheduleWrites);

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

  const [raceSnap, driverSnap] = await Promise.all([
    racesRef(leagueId).get(),
    driversRef(leagueId).get(),
  ]);

  const driverIdByProviderKey = new Map<string, string>();
  driverSnap.forEach((doc) => {
    const driver = doc.data() as DriverDoc;
    if (driver.providerDriverKey) {
      driverIdByProviderKey.set(driver.providerDriverKey, doc.id);
    }
  });

  const now = Date.now();
  const cutoff = now - lookbackDays * 24 * 60 * 60 * 1000;

  for (const raceDocSnap of raceSnap.docs) {
    const race = raceDocSnap.data() as RaceDoc;
    const raceStartMs = race.startTime.toMillis();
    if (!race.providerRaceKey || raceStartMs > now || raceStartMs < cutoff) {
      continue;
    }

    const result = await provider.fetchRaceResult(race.providerRaceKey, seasonYear);
    if (!result) {
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
