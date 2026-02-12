import { logger } from "firebase-functions";
import { onDocumentWritten } from "firebase-functions/v2/firestore";
import { HttpsError, onCall } from "firebase-functions/v2/https";
import { onSchedule } from "firebase-functions/v2/scheduler";
import { setGlobalOptions } from "firebase-functions/v2/options";
import {
  assertAdminInLeague,
  db,
  getLeagueIds,
  leagueRef,
  membersRef,
  nowTimestamp,
  picksRef,
  racePointsRef,
  racesRef,
  seasonScoresRef,
} from "./data";
import { ingestScheduleAndStandings, refreshRecentRaceResults } from "./ingest";
import { recomputeSeasonScores, rescoreRace } from "./scoring";
import { computeTiersForRace, recomputeTiersForUpcomingRaces } from "./tiers";
import type {
  AdjustmentType,
  MemberDoc,
  PickDoc,
  RaceDoc,
  RaceDriverPoints,
  TierDoc,
} from "./types";
import {
  assertNoDuplicates,
  pickId,
  requireAuthUid,
  requireNumber,
  requireString,
  requireStringArray,
  toDocId,
} from "./utils";

setGlobalOptions({
  region: "us-central1",
  memory: "512MiB",
  timeoutSeconds: 120,
});

async function assertMember(leagueId: string, userId: string): Promise<MemberDoc> {
  const memberSnap = await membersRef(leagueId).doc(userId).get();
  if (!memberSnap.exists) {
    throw new HttpsError("permission-denied", "You are not a member of this league.");
  }
  return memberSnap.data() as MemberDoc;
}

function validatePickAgainstTiers(
  selection: { tierA: string[]; tierB: string[]; tierC: string[] },
  tiers: TierDoc,
): void {
  selection.tierA.forEach((driverId) => {
    if (!tiers.tierA.includes(driverId)) {
      throw new HttpsError("invalid-argument", `Driver ${driverId} is not in Tier A.`);
    }
  });

  selection.tierB.forEach((driverId) => {
    if (!tiers.tierB.includes(driverId)) {
      throw new HttpsError("invalid-argument", `Driver ${driverId} is not in Tier B.`);
    }
  });

  selection.tierC.forEach((driverId) => {
    if (!tiers.tierC.includes(driverId)) {
      throw new HttpsError("invalid-argument", `Driver ${driverId} is not in Tier C.`);
    }
  });

  assertNoDuplicates(
    [...selection.tierA, ...selection.tierB, ...selection.tierC],
    "Pick tiers",
  );
}

export const createLeague = onCall(async (request) => {
  const userId = requireAuthUid(request.auth?.uid);
  const leagueName = requireString(request.data?.name, "name");
  const inviteCodeRaw = requireString(request.data?.inviteCode, "inviteCode");
  const seasonYear = requireNumber(request.data?.seasonYear, "seasonYear");
  const adminDisplayName =
    typeof request.auth?.token?.name === "string"
      ? request.auth.token.name
      : typeof request.auth?.token?.email === "string"
        ? request.auth.token.email
        : "League Admin";
  const payoutConfigText =
    typeof request.data?.payoutConfigText === "string"
      ? request.data.payoutConfigText.trim()
      : "";

  const inviteCode = inviteCodeRaw.toUpperCase();
  const existingLeague = await db
    .collection("leagues")
    .where("inviteCode", "==", inviteCode)
    .limit(1)
    .get();

  if (!existingLeague.empty) {
    throw new HttpsError("already-exists", "Invite code is already in use.");
  }

  const leagueDocRef = db.collection("leagues").doc();

  await leagueDocRef.set({
    name: leagueName,
    seasonYear,
    inviteCode,
    payoutConfigText,
    lockBehavior: "race_start",
    createdAt: nowTimestamp(),
  });

  await membersRef(leagueDocRef.id).doc(userId).set({
    displayName: adminDisplayName,
    role: "admin",
    paidStatus: "paid",
    joinedAt: nowTimestamp(),
  } satisfies MemberDoc);

  return {
    leagueId: leagueDocRef.id,
    inviteCode,
  };
});

export const joinLeagueByInvite = onCall(async (request) => {
  const userId = requireAuthUid(request.auth?.uid);
  const inviteCode = requireString(request.data?.inviteCode, "inviteCode").toUpperCase();
  const displayName = requireString(request.data?.displayName, "displayName");

  const leagueSnap = await db
    .collection("leagues")
    .where("inviteCode", "==", inviteCode)
    .limit(1)
    .get();

  if (leagueSnap.empty) {
    throw new HttpsError("not-found", "Invite code not found.");
  }

  const leagueId = leagueSnap.docs[0].id;
  const memberDocRef = membersRef(leagueId).doc(userId);
  const memberDoc = await memberDocRef.get();

  if (!memberDoc.exists) {
    await memberDocRef.set({
      displayName,
      role: "player",
      paidStatus: "unpaid",
      joinedAt: nowTimestamp(),
    } satisfies MemberDoc);
  }

  await db.collection("users").doc(userId).set(
    {
      displayName,
      updatedAt: nowTimestamp(),
    },
    { merge: true },
  );

  return { leagueId };
});

export const savePick = onCall(async (request) => {
  const userId = requireAuthUid(request.auth?.uid);
  const leagueId = requireString(request.data?.leagueId, "leagueId");
  const raceId = requireString(request.data?.raceId, "raceId");

  await assertMember(leagueId, userId);

  const [raceSnap, tierSnap] = await Promise.all([
    racesRef(leagueId).doc(raceId).get(),
    leagueRef(leagueId).collection("tiers").doc(raceId).get(),
  ]);

  if (!raceSnap.exists) {
    throw new HttpsError("not-found", "Race not found.");
  }

  if (!tierSnap.exists) {
    throw new HttpsError("failed-precondition", "Tiers are not available for this race yet.");
  }

  const race = raceSnap.data() as RaceDoc;
  if (race.status !== "scheduled" || race.lockTime.toMillis() <= Date.now()) {
    throw new HttpsError("failed-precondition", "Picks are locked for this race.");
  }

  const selection = {
    tierA: requireStringArray(request.data?.tierA, "tierA", 3),
    tierB: requireStringArray(request.data?.tierB, "tierB", 2),
    tierC: requireStringArray(request.data?.tierC, "tierC", 1),
  };

  validatePickAgainstTiers(selection, tierSnap.data() as TierDoc);

  const pick: PickDoc = {
    raceId,
    userId,
    ...selection,
    updatedAt: nowTimestamp(),
    lockedAt: null,
  };

  await picksRef(leagueId).doc(pickId(raceId, userId)).set(pick, { merge: true });

  return { ok: true };
});

export const computeRaceTiers = onCall(async (request) => {
  const userId = requireAuthUid(request.auth?.uid);
  const leagueId = requireString(request.data?.leagueId, "leagueId");
  const raceId = requireString(request.data?.raceId, "raceId");

  await assertAdminInLeague(leagueId, userId);
  await computeTiersForRace(leagueId, raceId);

  return { ok: true };
});

export const manualRefreshData = onCall(async (request) => {
  const userId = requireAuthUid(request.auth?.uid);
  const leagueId = requireString(request.data?.leagueId, "leagueId");

  await assertAdminInLeague(leagueId, userId);
  await ingestScheduleAndStandings(leagueId);
  await refreshRecentRaceResults(leagueId, 7);

  return { ok: true };
});

export const manualUpsertRacePoints = onCall(async (request) => {
  const userId = requireAuthUid(request.auth?.uid);
  const leagueId = requireString(request.data?.leagueId, "leagueId");
  const raceId = requireString(request.data?.raceId, "raceId");
  const source =
    typeof request.data?.source === "string" && request.data.source.trim().length > 0
      ? request.data.source.trim()
      : "admin-manual";

  await assertAdminInLeague(leagueId, userId);

  if (!Array.isArray(request.data?.drivers)) {
    throw new HttpsError("invalid-argument", "drivers must be an array.");
  }

  const drivers = request.data.drivers.map((entry: unknown) => {
    const item = entry as Partial<RaceDriverPoints>;
    return {
      driverId: requireString(item.driverId, "drivers[].driverId"),
      basePoints: requireNumber(item.basePoints, "drivers[].basePoints"),
    };
  });

  await racePointsRef(leagueId).doc(raceId).set(
    {
      drivers,
      source,
      lastSyncedAt: nowTimestamp(),
    },
    { merge: true },
  );

  await racesRef(leagueId).doc(raceId).set(
    {
      status: "completed",
      lastSyncedAt: nowTimestamp(),
    },
    { merge: true },
  );

  return { ok: true };
});

export const addAdjustment = onCall(async (request) => {
  const userId = requireAuthUid(request.auth?.uid);
  const leagueId = requireString(request.data?.leagueId, "leagueId");
  await assertAdminInLeague(leagueId, userId);

  const raceId = requireString(request.data?.raceId, "raceId");
  const driverId = requireString(request.data?.driverId, "driverId");
  const reason = requireString(request.data?.reason, "reason");
  const deltaPoints = requireNumber(request.data?.deltaPoints, "deltaPoints");
  const type = requireString(request.data?.type, "type") as AdjustmentType;
  const source =
    typeof request.data?.source === "string" && request.data.source.trim().length > 0
      ? request.data.source.trim()
      : "admin-manual";

  if (type !== "penalty" && type !== "correction") {
    throw new HttpsError("invalid-argument", "type must be 'penalty' or 'correction'.");
  }

  await leagueRef(leagueId)
    .collection("adjustments")
    .doc(toDocId(`${raceId}-${driverId}-${Date.now()}`))
    .set({
      raceId,
      driverId,
      type,
      deltaPoints,
      reason,
      source,
      createdAt: nowTimestamp(),
      createdBy: userId,
    });

  return { ok: true };
});

export const lockPicksAtRaceStart = onSchedule(
  {
    schedule: "every 1 minutes",
    timeZone: "America/New_York",
    retryCount: 1,
  },
  async () => {
    const now = nowTimestamp();
    const leagueIds = await getLeagueIds();

    for (const leagueId of leagueIds) {
      const raceSnap = await racesRef(leagueId)
        .where("status", "==", "scheduled")
        .where("lockTime", "<=", now)
        .get();

      for (const raceDocSnap of raceSnap.docs) {
        await racesRef(leagueId).doc(raceDocSnap.id).set(
          {
            status: "locked",
            lastSyncedAt: nowTimestamp(),
          },
          { merge: true },
        );

        const picksSnap = await picksRef(leagueId)
          .where("raceId", "==", raceDocSnap.id)
          .where("lockedAt", "==", null)
          .get();

        const writeOps: Promise<FirebaseFirestore.WriteResult>[] = [];
        picksSnap.forEach((pickDocSnap) => {
          writeOps.push(
            picksRef(leagueId).doc(pickDocSnap.id).set(
              {
                lockedAt: nowTimestamp(),
                updatedAt: nowTimestamp(),
              },
              { merge: true },
            ),
          );
        });

        await Promise.all(writeOps);
        await rescoreRace(leagueId, raceDocSnap.id);
      }
    }

    logger.info("Scheduled lock cycle complete");
  },
);

export const ingestLeagueDataDaily = onSchedule(
  {
    schedule: "0 6 * * *",
    timeZone: "America/New_York",
  },
  async () => {
    const leagueIds = await getLeagueIds();
    await Promise.all(leagueIds.map((leagueId) => ingestScheduleAndStandings(leagueId)));
    logger.info("Daily schedule + standings ingest complete", {
      leagues: leagueIds.length,
    });
  },
);

export const refreshRaceResults = onSchedule(
  {
    schedule: "every 6 hours",
    timeZone: "America/New_York",
  },
  async () => {
    const leagueIds = await getLeagueIds();
    await Promise.all(leagueIds.map((leagueId) => refreshRecentRaceResults(leagueId, 5)));
    logger.info("Race result refresh cycle complete", {
      leagues: leagueIds.length,
    });
  },
);

export const onStandingsSnapshotWrite = onDocumentWritten(
  "leagues/{leagueId}/standingsSnapshots/{snapshotId}",
  async (event) => {
    const leagueId = event.params.leagueId;
    await recomputeTiersForUpcomingRaces(leagueId);
  },
);

export const onRacePointsWrite = onDocumentWritten(
  "leagues/{leagueId}/racePoints/{raceId}",
  async (event) => {
    if (!event.data?.after.exists) {
      return;
    }
    await rescoreRace(event.params.leagueId, event.params.raceId);
  },
);

export const onAdjustmentWrite = onDocumentWritten(
  "leagues/{leagueId}/adjustments/{adjustmentId}",
  async (event) => {
    const afterData = event.data?.after.data();
    const beforeData = event.data?.before.data();
    const raceId = (afterData?.raceId || beforeData?.raceId) as string | undefined;
    if (!raceId) {
      return;
    }

    await rescoreRace(event.params.leagueId, raceId);
  },
);

export const onPickWrite = onDocumentWritten(
  "leagues/{leagueId}/picks/{pickDocumentId}",
  async (event) => {
    const pickAfter = event.data?.after.data() as PickDoc | undefined;
    const pickBefore = event.data?.before.data() as PickDoc | undefined;
    const raceId = pickAfter?.raceId || pickBefore?.raceId;
    if (!raceId) {
      return;
    }

    await rescoreRace(event.params.leagueId, raceId);
  },
);

export const onWeeklyScoreWrite = onDocumentWritten(
  "leagues/{leagueId}/weeklyScores/{weeklyScoreId}",
  async (event) => {
    if (!event.data?.after.exists && !event.data?.before.exists) {
      return;
    }

    const before = event.data?.before.data() as { weeklyTotal?: number } | undefined;
    const after = event.data?.after.data() as { weeklyTotal?: number } | undefined;

    if (before?.weeklyTotal === after?.weeklyTotal) {
      return;
    }

    await recomputeSeasonScores(event.params.leagueId);
  },
);

export const pruneSeasonScores = onSchedule(
  {
    schedule: "every 24 hours",
    timeZone: "America/New_York",
  },
  async () => {
    const leagueIds = await getLeagueIds();
    for (const leagueId of leagueIds) {
      const membersSnap = await membersRef(leagueId).get();
      const memberIds = new Set(membersSnap.docs.map((doc) => doc.id));
      const seasonScoresSnap = await seasonScoresRef(leagueId).get();
      const deletes: Promise<FirebaseFirestore.WriteResult>[] = [];
      seasonScoresSnap.forEach((scoreDoc) => {
        if (!memberIds.has(scoreDoc.id)) {
          deletes.push(seasonScoresRef(leagueId).doc(scoreDoc.id).delete());
        }
      });
      await Promise.all(deletes);
    }
  },
);
