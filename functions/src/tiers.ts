import { logger } from "firebase-functions";
import { nowTimestamp, racesRef, standingsSnapshotsRef, tiersRef } from "./data";
import type { RaceDoc, StandingsSnapshotDoc } from "./types";

function extractTierDriverIds(snapshot: StandingsSnapshotDoc): {
  tierA: string[];
  tierB: string[];
  tierC: string[];
} {
  const ordered = [...snapshot.drivers].sort((a, b) => a.position - b.position);

  const tierA = ordered.filter((entry) => entry.position >= 1 && entry.position <= 10);
  const tierB = ordered.filter((entry) => entry.position >= 11 && entry.position <= 20);
  const tierC = ordered.filter((entry) => entry.position >= 21 && entry.position <= 30);

  return {
    tierA: tierA.map((entry) => entry.driverId),
    tierB: tierB.map((entry) => entry.driverId),
    tierC: tierC.map((entry) => entry.driverId),
  };
}

export async function computeTiersForRace(
  leagueId: string,
  raceId: string,
  snapshotId?: string,
): Promise<void> {
  let snapshotSnap;

  if (snapshotId) {
    snapshotSnap = await standingsSnapshotsRef(leagueId).doc(snapshotId).get();
  } else {
    const latestSnapshot = await standingsSnapshotsRef(leagueId)
      .orderBy("asOfDate", "desc")
      .limit(1)
      .get();
    snapshotSnap = latestSnapshot.docs[0];
  }

  if (!snapshotSnap || !snapshotSnap.exists) {
    logger.warn("Skipping tier computation due to missing standings snapshot", {
      leagueId,
      raceId,
    });
    return;
  }

  const snapshot = snapshotSnap.data() as StandingsSnapshotDoc;
  const tiers = extractTierDriverIds(snapshot);

  await tiersRef(leagueId).doc(raceId).set(
    {
      ...tiers,
      computedFromSnapshotId: snapshotSnap.id,
      updatedAt: nowTimestamp(),
    },
    { merge: true },
  );
}

export async function recomputeTiersForUpcomingRaces(leagueId: string): Promise<void> {
  // Query without orderBy to avoid requiring a composite index on (status, startTime).
  const raceSnap = await racesRef(leagueId).where("status", "==", "scheduled").get();

  const sorted = raceSnap.docs
    .map((d) => ({ id: d.id, data: d.data() as RaceDoc }))
    .sort((a, b) => a.data.startTime.toMillis() - b.data.startTime.toMillis());

  logger.info("Recomputing tiers for upcoming races", {
    leagueId,
    scheduledRaceCount: sorted.length,
    raceIds: sorted.map((r) => r.id),
  });

  await Promise.all(
    sorted.map(async (race) => {
      await computeTiersForRace(leagueId, race.id);
    }),
  );
}
