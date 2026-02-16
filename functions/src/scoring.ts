import { logger } from "firebase-functions";
import {
  adjustmentsRef,
  membersRef,
  nowTimestamp,
  picksRef,
  racePointsRef,
  seasonScoresRef,
  weeklyScoresRef,
} from "./data";
import { pickId } from "./utils";
import type {
  AdjustmentDoc,
  MemberDoc,
  PickDoc,
  RacePointsDoc,
  SeasonScoreDoc,
  WeeklyScoreDoc,
} from "./types";

export function applyDriverPoints(basePoints: number, adjustmentDelta: number): number {
  return Math.max(0, basePoints + adjustmentDelta);
}

export function buildPickScoreBreakdown(
  pick: PickDoc,
  basePointsByDriver: Map<string, number>,
  adjustmentsByDriver: Map<string, number>,
): {
  breakdown: WeeklyScoreDoc["breakdown"];
  weeklyTotal: number;
  hasAdjustments: boolean;
} {
  const selectedDrivers = Array.from(
    new Set([...pick.tierA, ...pick.tierB, ...pick.tierC]),
  );

  const breakdown = selectedDrivers.map((driverId) => {
    const basePoints = basePointsByDriver.get(driverId) ?? 0;
    const totalAdjustments = adjustmentsByDriver.get(driverId) ?? 0;
    const finalPointsApplied = applyDriverPoints(basePoints, totalAdjustments);

    return {
      driverId,
      basePoints,
      totalAdjustments,
      finalPointsApplied,
      adjusted: totalAdjustments !== 0,
    };
  });

  const weeklyTotal = breakdown.reduce(
    (total, item) => total + item.finalPointsApplied,
    0,
  );

  return {
    breakdown,
    weeklyTotal,
    hasAdjustments: breakdown.some((item) => item.adjusted),
  };
}

export async function rescoreRace(leagueId: string, raceId: string): Promise<void> {
  logger.info("Rescoring race", { leagueId, raceId });

  const [racePointsSnap, adjustmentsSnap, picksSnap] = await Promise.all([
    racePointsRef(leagueId).doc(raceId).get(),
    adjustmentsRef(leagueId).where("raceId", "==", raceId).get(),
    picksRef(leagueId).where("raceId", "==", raceId).get(),
  ]);

  const basePointsByDriver = new Map<string, number>();
  if (racePointsSnap.exists) {
    const racePoints = racePointsSnap.data() as RacePointsDoc;
    racePoints.drivers.forEach((entry) => {
      basePointsByDriver.set(entry.driverId, entry.basePoints);
    });
  }

  const adjustmentsByDriver = new Map<string, number>();
  adjustmentsSnap.forEach((doc) => {
    const adjustment = doc.data() as AdjustmentDoc;
    const current = adjustmentsByDriver.get(adjustment.driverId) ?? 0;
    adjustmentsByDriver.set(adjustment.driverId, current + adjustment.deltaPoints);
  });

  const updateOps: Promise<FirebaseFirestore.WriteResult>[] = [];
  picksSnap.forEach((pickDocSnap) => {
    const pick = pickDocSnap.data() as PickDoc;
    const scored = buildPickScoreBreakdown(
      pick,
      basePointsByDriver,
      adjustmentsByDriver,
    );

    const weeklyScore: WeeklyScoreDoc = {
      raceId,
      userId: pick.userId,
      breakdown: scored.breakdown,
      weeklyTotal: scored.weeklyTotal,
      hasAdjustments: scored.hasAdjustments,
      updatedAt: nowTimestamp(),
    };

    updateOps.push(
      weeklyScoresRef(leagueId)
        .doc(pickId(raceId, pick.userId))
        .set(weeklyScore, { merge: true }),
    );
  });

  await Promise.all(updateOps);
  await recomputeSeasonScores(leagueId);
  logger.info("Race scoring complete", {
    leagueId,
    raceId,
    picksScored: picksSnap.size,
  });
}

export async function recomputeSeasonScores(leagueId: string): Promise<void> {
  logger.info("Recomputing season totals", { leagueId });

  const [membersSnap, weeklyScoresSnap] = await Promise.all([
    membersRef(leagueId).get(),
    weeklyScoresRef(leagueId).get(),
  ]);

  const memberMap = new Map<string, MemberDoc>();
  const totals = new Map<string, number>();

  membersSnap.forEach((memberDocSnap) => {
    const member = memberDocSnap.data() as MemberDoc;
    memberMap.set(memberDocSnap.id, member);
    totals.set(memberDocSnap.id, 0);
  });

  weeklyScoresSnap.forEach((weeklyDocSnap) => {
    const weekly = weeklyDocSnap.data() as WeeklyScoreDoc;
    const current = totals.get(weekly.userId) ?? 0;
    totals.set(weekly.userId, current + weekly.weeklyTotal);
  });

  const ordered = [...totals.entries()].sort((a, b) => {
    if (b[1] !== a[1]) {
      return b[1] - a[1];
    }

    const aName = memberMap.get(a[0])?.displayName ?? a[0];
    const bName = memberMap.get(b[0])?.displayName ?? b[0];
    return aName.localeCompare(bName);
  });

  const writeOps: Promise<FirebaseFirestore.WriteResult>[] = [];
  ordered.forEach(([userId, seasonTotal], index) => {
    const seasonScore: SeasonScoreDoc = {
      seasonTotal,
      rank: index + 1,
      updatedAt: nowTimestamp(),
    };

    writeOps.push(seasonScoresRef(leagueId).doc(userId).set(seasonScore, { merge: true }));
  });

  await Promise.all(writeOps);

  logger.info("Season ranking update complete", {
    leagueId,
    members: ordered.length,
  });
}
