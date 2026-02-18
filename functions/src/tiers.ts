import { logger } from "firebase-functions";
import { nowTimestamp, racesRef, standingsSnapshotsRef, tiersRef } from "./data";
import type { RaceDoc, StandingsSnapshotDoc } from "./types";

export function extractTierDriverIds(snapshot: StandingsSnapshotDoc): {
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
  const [raceSnap, tiersSnap] = await Promise.all([
    racesRef(leagueId).where("status", "==", "scheduled").get(),
    tiersRef(leagueId).get(),
  ]);

  const sorted = raceSnap.docs
    .map((d) => ({ id: d.id, data: d.data() as RaceDoc }))
    .sort((a, b) => a.data.startTime.toMillis() - b.data.startTime.toMillis());

  const nowMs = Date.now();
  const nextRace =
    sorted.find((r) => r.data.lockTime.toMillis() > nowMs) ??
    sorted[0] ??
    null;
  const targetRaceId = nextRace?.id ?? null;

  logger.info("Recomputing tiers for next race only", {
    leagueId,
    scheduledRaceCount: sorted.length,
    targetRaceId,
  });

  if (targetRaceId) {
    await computeTiersForRace(leagueId, targetRaceId);
  }

  const staleTierDeletes: Promise<FirebaseFirestore.WriteResult>[] = [];
  tiersSnap.forEach((docSnap) => {
    if (targetRaceId && docSnap.id === targetRaceId) return;
    staleTierDeletes.push(tiersRef(leagueId).doc(docSnap.id).delete());
  });
  await Promise.all(staleTierDeletes);
}
