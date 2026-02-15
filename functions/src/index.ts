import { logger } from "firebase-functions/v2";
import { onDocumentWritten } from "firebase-functions/v2/firestore";
import { HttpsError, onCall } from "firebase-functions/v2/https";
import { onSchedule } from "firebase-functions/v2/scheduler";
import { setGlobalOptions } from "firebase-functions/v2/options";
import {
  assertAdminInLeague,
  db,
  driversRef,
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
import {
  fetchNascarLiveFeed,
  fetchNascarLiveStagePoints,
  getNascarRaceIdForLeagueRace,
  runNameMatchesRace,
} from "./nascar-live";
import { recomputeSeasonScores, rescoreRace } from "./scoring";
import { computeTiersForRace, recomputeTiersForUpcomingRaces } from "./tiers";
import type {
  AdjustmentType,
  DriverDoc,
  LeagueDoc,
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

export const createLeague = onCall({ invoker: "public" }, async (request) => {
  try {
    const userId = requireAuthUid(request.auth?.uid);
    logger.info("createLeague called", { userId });
    
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
    logger.info("Checking for existing league with invite code", { inviteCode });
    
    const existingLeague = await db
      .collection("leagues")
      .where("inviteCode", "==", inviteCode)
      .limit(1)
      .get();

    if (!existingLeague.empty) {
      throw new HttpsError("already-exists", "Invite code is already in use.");
    }

    const leagueDocRef = db.collection("leagues").doc();
    logger.info("Creating league document", { leagueId: leagueDocRef.id });

    await leagueDocRef.set({
      name: leagueName,
      seasonYear,
      inviteCode,
      payoutConfigText,
      lockBehavior: "race_start",
      createdAt: nowTimestamp(),
    });
    logger.info("League document created successfully");

    logger.info("Creating member document", { leagueId: leagueDocRef.id, userId });
    await membersRef(leagueDocRef.id).doc(userId).set({
      userId, // Store userId as field to enable collection group queries
      displayName: adminDisplayName,
      role: "admin",
      paidStatus: "paid",
      joinedAt: nowTimestamp(),
    } satisfies MemberDoc);
    logger.info("Member document created with userId field", { leagueId: leagueDocRef.id, userId });
    logger.info("Member document created successfully");

    return {
      leagueId: leagueDocRef.id,
      inviteCode,
    };
  } catch (error) {
    logger.error("Error in createLeague", { error: error instanceof Error ? error.message : String(error), stack: error instanceof Error ? error.stack : undefined });
    if (error instanceof HttpsError) {
      throw error;
    }
    throw new HttpsError("internal", `Failed to create league: ${error instanceof Error ? error.message : String(error)}`);
  }
});

export const joinLeagueByInvite = onCall({ invoker: "public" }, async (request) => {
  try {
    const userId = requireAuthUid(request.auth?.uid);
    logger.info("joinLeagueByInvite called", { userId });

    const inviteCode = requireString(request.data?.inviteCode, "inviteCode").toUpperCase();
    const clientDisplayName = requireString(request.data?.displayName, "displayName");

    logger.info("Looking up league by invite code", { inviteCode });
    const leagueSnap = await db
      .collection("leagues")
      .where("inviteCode", "==", inviteCode)
      .limit(1)
      .get();

    if (leagueSnap.empty) {
      throw new HttpsError("not-found", "Invite code not found.");
    }

    const leagueDoc = leagueSnap.docs[0];
    const leagueId = leagueDoc.id;
    logger.info("League found", { leagueId });

    const memberDocRef = membersRef(leagueId).doc(userId);
    const memberDoc = await memberDocRef.get();

    let displayName = clientDisplayName.trim();
    if (!displayName) {
      const userEmail = typeof request.auth?.token?.email === "string" ? request.auth.token.email : "";
      displayName = userEmail || "Player";
    }

    if (!memberDoc.exists) {
      logger.info("Creating member document", { leagueId, userId, displayName });
      await memberDocRef.set({
        userId, // Store userId as field to enable collection group queries
        displayName,
        role: "player",
        paidStatus: "unpaid",
        joinedAt: nowTimestamp(),
      } satisfies MemberDoc);
      logger.info("Member document created successfully");
    } else {
      logger.info("User already a member", { leagueId, userId });
      displayName = (memberDoc.data() as MemberDoc).displayName;
    }

    logger.info("Updating user document", { userId });
    await db.collection("users").doc(userId).set(
      {
        displayName,
        updatedAt: nowTimestamp(),
      },
      { merge: true },
    );
    logger.info("User document updated successfully");

    return { leagueId, displayName };
  } catch (error) {
    logger.error("Error in joinLeagueByInvite", { error: error instanceof Error ? error.message : String(error), stack: error instanceof Error ? error.stack : undefined });
    if (error instanceof HttpsError) {
      throw error;
    }
    throw new HttpsError("internal", `Failed to join league: ${error instanceof Error ? error.message : String(error)}`);
  }
});

export const savePick = onCall({ invoker: "public" }, async (request) => {
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

  let tierSnapFinal = tierSnap;
  if (!tierSnap.exists) {
    await computeTiersForRace(leagueId, raceId);
    tierSnapFinal = await leagueRef(leagueId).collection("tiers").doc(raceId).get();
  }
  if (!tierSnapFinal.exists) {
    throw new HttpsError("failed-precondition", "Tiers are not available for this race yet. Run \"Refresh data\" in Admin.");
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

  validatePickAgainstTiers(selection, tierSnapFinal.data() as TierDoc);

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

export const computeRaceTiers = onCall({ invoker: "public" }, async (request) => {
  const userId = requireAuthUid(request.auth?.uid);
  const leagueId = requireString(request.data?.leagueId, "leagueId");
  const raceId = requireString(request.data?.raceId, "raceId");

  await assertAdminInLeague(leagueId, userId);
  await computeTiersForRace(leagueId, raceId);

  return { ok: true };
});

export const manualRefreshData = onCall({ invoker: "public" }, async (request) => {
  const userId = requireAuthUid(request.auth?.uid);
  const leagueId = requireString(request.data?.leagueId, "leagueId");

  await assertAdminInLeague(leagueId, userId);
  await ingestScheduleAndStandings(leagueId);
  await refreshRecentRaceResults(leagueId, 7);

  return { ok: true };
});

export const manualUpsertRacePoints = onCall({ invoker: "public" }, async (request) => {
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

export const addAdjustment = onCall({ invoker: "public" }, async (request) => {
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

type LiveSyncResult = { updated: true } | { updated: false; reason: string };

async function applyNascarLiveFeedToLeague(leagueId: string): Promise<LiveSyncResult> {
  const feed = await fetchNascarLiveFeed();

  const [leagueSnap, lockedSnap, scheduledSnap, driversSnap] = await Promise.all([
    leagueRef(leagueId).get(),
    racesRef(leagueId).where("status", "==", "locked").get(),
    racesRef(leagueId).where("status", "==", "scheduled").get(),
    driversRef(leagueId).get(),
  ]);
  const league = leagueSnap.exists ? (leagueSnap.data() as LeagueDoc) : null;
  const seasonYear = league?.seasonYear;
  const nowMs = Date.now();
  const raceDocs = [...lockedSnap.docs, ...scheduledSnap.docs];

  if (raceDocs.length === 0) {
    return { updated: false, reason: "No races in this league." };
  }

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

  // When live feed is unavailable, try stage points only using a known NASCAR race_id for the current league race.
  if (!feed) {
    const targetRaceId = fallbackRaceId;
    if (!targetRaceId || seasonYear == null) {
      return { updated: false, reason: "Live feed unavailable." };
    }
    const nascarRaceId = getNascarRaceIdForLeagueRace(targetRaceId);
    if (nascarRaceId == null) {
      return {
        updated: false,
        reason: "Live feed unavailable and no known NASCAR race ID for this race (add to NASCAR_RACE_ID_BY_LEAGUE_RACE for stage-only refresh).",
      };
    }
    const stagePointsByVehicle = await fetchNascarLiveStagePoints(seasonYear, nascarRaceId);
    if (stagePointsByVehicle.size === 0) {
      return { updated: false, reason: "Live feed unavailable; stage points API returned no data." };
    }
    const numberToDriverId = buildNumberToDriverId(driversSnap);
    const byDriverId = new Map<string, { basePoints: number; runningPosition?: number }>();
    for (const [vehicleNum, stagePts] of stagePointsByVehicle) {
      const driverId = resolveDriverId(vehicleNum, numberToDriverId);
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
    logger.info("NASCAR live: applied stage points only (feed unavailable)", { leagueId, targetRaceId, nascarRaceId });
    return { updated: true };
  }

  const stagePointsByVehicle =
    feed.raceId != null && seasonYear != null
      ? await fetchNascarLiveStagePoints(seasonYear, feed.raceId)
      : new Map<string, number>();

  const racesSnap = { docs: raceDocs };
  const numberToDriverId = buildNumberToDriverId(driversSnap);

  let updated: LiveSyncResult = { updated: false, reason: "No matching race found for this league." };
  for (const raceDocSnap of racesSnap.docs) {
    const race = raceDocSnap.data() as RaceDoc;
    const raceId = raceDocSnap.id;
    const nameMatches = runNameMatchesRace(feed.runName, race.name);
    const isOnlyRace = theOnlyRaceId !== null && raceId === theOnlyRaceId;
    const isFallback = fallbackRaceId !== null && raceId === fallbackRaceId;
    const matchesNascarRaceId =
      feed.raceId != null && getNascarRaceIdForLeagueRace(raceId) === feed.raceId;
    const useThisRace = nameMatches || isOnlyRace || isFallback || matchesNascarRaceId;
    if (!useThisRace) continue;

    const byDriverId = new Map<string, { basePoints: number; runningPosition?: number }>();
    for (const [vehicleNum, stagePts] of stagePointsByVehicle) {
      const driverId = resolveDriverId(vehicleNum, numberToDriverId);
      if (driverId) byDriverId.set(driverId, { basePoints: stagePts });
    }
    for (const fd of feed.drivers) {
      const driverId = resolveDriverId(fd.vehicleNumber, numberToDriverId);
      if (driverId) {
        const stagePts = stagePointsByVehicle.get(fd.vehicleNumber.trim()) ?? stagePointsByVehicle.get(String(Number(fd.vehicleNumber))) ?? 0;
        byDriverId.set(driverId, { basePoints: fd.basePoints + stagePts, runningPosition: fd.runningPosition });
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

function buildNumberToDriverId(driversSnap: FirebaseFirestore.QuerySnapshot): Map<string, string> {
  const numberToDriverId = new Map<string, string>();
  driversSnap.forEach((docSnap) => {
    const d = docSnap.data() as DriverDoc;
    if (d.number != null && d.number !== "") {
      const key = String(d.number).trim();
      numberToDriverId.set(key, docSnap.id);
      const num = Number(key);
      if (!Number.isNaN(num)) numberToDriverId.set(String(num), docSnap.id);
    }
  });
  return numberToDriverId;
}

function resolveDriverId(vehicleKey: string, numberToDriverId: Map<string, string>): string | null {
  const k = vehicleKey.trim();
  let id = numberToDriverId.get(k);
  if (!id && k) {
    const num = Number(k);
    if (!Number.isNaN(num)) id = numberToDriverId.get(String(num)) ?? null;
  }
  return id ?? null;
}

/** Sync live race points from NASCAR.com live feed for any league with a race in progress. */
export const syncLiveRaceFromNascar = onSchedule(
  {
    schedule: "every 2 minutes",
    timeZone: "America/New_York",
    retryCount: 1,
  },
  async () => {
    const feed = await fetchNascarLiveFeed();
    if (!feed) return;

    const leagueIds = await getLeagueIds();
    for (const leagueId of leagueIds) {
      await applyNascarLiveFeedToLeague(leagueId);
    }
    logger.info("NASCAR live sync cycle complete", {
      runName: feed.runName,
      lapNumber: feed.lapNumber,
      leagues: leagueIds.length,
    });
  },
);

export const syncLiveRaceNow = onCall({ invoker: "public" }, async (request) => {
  const userId = requireAuthUid(request.auth?.uid);
  const leagueId = requireString(request.data?.leagueId, "leagueId");
  await assertAdminInLeague(leagueId, userId);
  const result = await applyNascarLiveFeedToLeague(leagueId);
  return result.updated ? { ok: true, updated: true } : { ok: true, updated: false, reason: result.reason };
});

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
