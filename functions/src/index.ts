import { Timestamp } from "firebase-admin/firestore";
import { logger } from "firebase-functions/v2";
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
import {
  fetchNascarLiveFeed,
  runNameMatchesRace,
} from "./nascar-live";
import type { FetchLiveFeedResult } from "./nascar-live";
import {
  applyNascarLiveFeedToLeague,
  syncLiveRaceForLeagues,
} from "./live-sync";
import { rescoreRace } from "./scoring";
import { computeTiersForRace, recomputeTiersForUpcomingRaces } from "./tiers";
import type {
  AdjustmentType,
  MemberDoc,
  PickDoc,
  RaceDoc,
  RaceDriverPoints,
  TierDoc,
} from "./types";
import type {
  UpdateLeagueSettingsRequest,
  UpdateMemberPaidStatusRequest,
} from "../../shared/callables";
import {
  pickId,
  requireAuthUid,
  requireNumber,
  requireString,
  requireStringArray,
  toDocId,
} from "./utils";
import { validatePickAgainstTiers } from "./pick-validation";

setGlobalOptions({
  region: "us-central1",
  memory: "512MiB",
  timeoutSeconds: 120,
});

const BASE_LOCK_CHECK_SCHEDULE = "every 15 minutes";
const RACE_HOUR_LOCK_CHECK_SCHEDULE = "every 1 minutes";
const RACE_HOUR_LOOKAHEAD_MS = 60 * 60 * 1000;
const RACE_HOUR_LOOKBACK_MS = 15 * 60 * 1000;
const LIVE_FEED_MATCH_WINDOW_FUTURE_MS = 8 * 60 * 60 * 1000;
const LIVE_FEED_MATCH_WINDOW_PAST_MS = 12 * 60 * 60 * 1000;
const LIVE_FEED_PICK_GUARD_LOOKAHEAD_MS = 24 * 60 * 60 * 1000;

async function assertMember(leagueId: string, userId: string): Promise<MemberDoc> {
  const memberSnap = await membersRef(leagueId).doc(userId).get();
  if (!memberSnap.exists) {
    throw new HttpsError("permission-denied", "You are not a member of this league.");
  }
  return memberSnap.data() as MemberDoc;
}

function isLiveFeedRaceInProgress(feed: FetchLiveFeedResult): boolean {
  return feed.lapNumber > 0 && feed.drivers.length > 0;
}

function getLeagueIdFromRacePath(path: string): string | null {
  const segments = path.split("/");
  if (segments.length !== 4) return null;
  if (segments[0] !== "leagues" || segments[2] !== "races") return null;
  return segments[1];
}

async function getLeagueIdsWithScheduledRaceLockWindow(
  windowStartMs: number,
  windowEndMs: number,
): Promise<string[]> {
  const raceSnap = await db
    .collectionGroup("races")
    .where("lockTime", ">=", Timestamp.fromMillis(windowStartMs))
    .where("lockTime", "<=", Timestamp.fromMillis(windowEndMs))
    .get();

  const leagueIds = new Set<string>();
  raceSnap.forEach((raceDocSnap) => {
    const race = raceDocSnap.data() as Partial<RaceDoc>;
    if (race.status !== "scheduled") return;
    const leagueId = getLeagueIdFromRacePath(raceDocSnap.ref.path);
    if (leagueId) leagueIds.add(leagueId);
  });
  return Array.from(leagueIds);
}

async function lockRaceAndSubmittedPicks(
  leagueId: string,
  raceId: string,
  source: string,
): Promise<void> {
  const now = nowTimestamp();
  await racesRef(leagueId).doc(raceId).set(
    {
      status: "locked",
      lastSyncedAt: now,
    },
    { merge: true },
  );

  const picksSnap = await picksRef(leagueId)
    .where("raceId", "==", raceId)
    .where("lockedAt", "==", null)
    .get();

  const writeOps: Promise<FirebaseFirestore.WriteResult>[] = [];
  picksSnap.forEach((pickDocSnap) => {
    writeOps.push(
      picksRef(leagueId).doc(pickDocSnap.id).set(
        {
          lockedAt: now,
          updatedAt: now,
        },
        { merge: true },
      ),
    );
  });
  await Promise.all(writeOps);
  await rescoreRace(leagueId, raceId);
  logger.info("Race picks locked", {
    leagueId,
    raceId,
    source,
    picksLocked: picksSnap.size,
  });
}

async function lockDueRacesForLeague(
  leagueId: string,
  now: Timestamp,
): Promise<number> {
  const raceSnap = await racesRef(leagueId)
    .where("status", "==", "scheduled")
    .where("lockTime", "<=", now)
    .get();

  for (const raceDocSnap of raceSnap.docs) {
    await lockRaceAndSubmittedPicks(leagueId, raceDocSnap.id, "lock-time-reached");
  }
  return raceSnap.size;
}

function findRaceToLockFromLiveFeed(
  raceDocs: FirebaseFirestore.QueryDocumentSnapshot[],
  liveFeed: FetchLiveFeedResult,
): FirebaseFirestore.QueryDocumentSnapshot | null {
  if (!isLiveFeedRaceInProgress(liveFeed)) return null;
  const nowMs = Date.now();
  const candidates = raceDocs
    .map((raceDocSnap) => {
      const race = raceDocSnap.data() as RaceDoc;
      return {
        raceDocSnap,
        race,
        startTimeMs: race.startTime.toMillis(),
      };
    })
    .filter(
      ({ startTimeMs }) =>
        startTimeMs >= nowMs - LIVE_FEED_MATCH_WINDOW_PAST_MS &&
        startTimeMs <= nowMs + LIVE_FEED_MATCH_WINDOW_FUTURE_MS,
    );

  if (candidates.length === 0) return null;

  const matchesByName = candidates.filter(({ race }) =>
    runNameMatchesRace(liveFeed.runName, race.name),
  );
  const pool =
    matchesByName.length > 0
      ? matchesByName
      : candidates.length === 1
        ? candidates
        : [];
  if (pool.length === 0) return null;

  pool.sort(
    (left, right) =>
      Math.abs(left.startTimeMs - nowMs) - Math.abs(right.startTimeMs - nowMs) ||
      left.startTimeMs - right.startTimeMs,
  );
  return pool[0].raceDocSnap;
}

async function lockRaceFromLiveFeedForLeague(
  leagueId: string,
  liveFeed: FetchLiveFeedResult,
): Promise<number> {
  const scheduledSnap = await racesRef(leagueId).where("status", "==", "scheduled").get();
  if (scheduledSnap.empty) return 0;
  const targetRaceDoc = findRaceToLockFromLiveFeed(scheduledSnap.docs, liveFeed);
  if (!targetRaceDoc) return 0;

  await lockRaceAndSubmittedPicks(leagueId, targetRaceDoc.id, "live-feed");
  return 1;
}

async function runLockCycle(options: {
  source: string;
  dueLockLeagueIds: string[];
  liveFeed: FetchLiveFeedResult | null;
  liveFeedLeagueIds?: string[];
}): Promise<void> {
  const scopeByLeague = new Map<string, { due: boolean; live: boolean }>();

  options.dueLockLeagueIds.forEach((leagueId) => {
    const scope = scopeByLeague.get(leagueId) ?? { due: false, live: false };
    scope.due = true;
    scopeByLeague.set(leagueId, scope);
  });

  if (options.liveFeed) {
    const liveLeagueIds =
      options.liveFeedLeagueIds && options.liveFeedLeagueIds.length > 0
        ? options.liveFeedLeagueIds
        : options.dueLockLeagueIds;
    liveLeagueIds.forEach((leagueId) => {
      const scope = scopeByLeague.get(leagueId) ?? { due: false, live: false };
      scope.live = true;
      scopeByLeague.set(leagueId, scope);
    });
  }

  if (scopeByLeague.size === 0) {
    logger.info("Scheduled lock cycle skipped (no leagues in scope)", {
      source: options.source,
    });
    return;
  }

  const now = nowTimestamp();
  let lockedByTime = 0;
  let lockedByLiveFeed = 0;
  for (const [leagueId, scope] of scopeByLeague) {
    if (scope.due) {
      lockedByTime += await lockDueRacesForLeague(leagueId, now);
    }
    if (scope.live && options.liveFeed) {
      lockedByLiveFeed += await lockRaceFromLiveFeedForLeague(leagueId, options.liveFeed);
    }
  }

  logger.info("Scheduled lock cycle complete", {
    source: options.source,
    leaguesChecked: scopeByLeague.size,
    dueLockLeagues: options.dueLockLeagueIds.length,
    liveFeedLeagues: options.liveFeedLeagueIds?.length ?? 0,
    lockedByTime,
    lockedByLiveFeed,
  });
}

function withHttpsErrorHandling<TResponse>(
  callableName: string,
  handler: (request: any) => Promise<TResponse>,
): (request: any) => Promise<TResponse> {
  return async (request) => {
    try {
      return await handler(request);
    } catch (error) {
      if (error instanceof HttpsError) throw error;
      logger.error(`${callableName} failed`, {
        error: error instanceof Error ? error.message : String(error),
        stack: error instanceof Error ? error.stack : undefined,
      });
      throw new HttpsError("internal", "Internal server error.");
    }
  };
}

export const createLeague = onCall({ invoker: "public" }, withHttpsErrorHandling("createLeague", async (request) => {
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
}));

export const joinLeagueByInvite = onCall({ invoker: "public" }, withHttpsErrorHandling("joinLeagueByInvite", async (request) => {
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
}));

export const savePick = onCall({ invoker: "public" }, withHttpsErrorHandling("savePick", async (request) => {
  const userId = requireAuthUid(request.auth?.uid);
  const leagueId = requireString(request.data?.leagueId, "leagueId");
  const raceId = requireString(request.data?.raceId, "raceId");
  logger.info("savePick called", { leagueId, raceId, userId });

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
  const nowMs = Date.now();
  if (race.status !== "scheduled" || race.lockTime.toMillis() <= nowMs) {
    throw new HttpsError("failed-precondition", "Picks are locked for this race.");
  }
  if (race.lockTime.toMillis() - nowMs <= LIVE_FEED_PICK_GUARD_LOOKAHEAD_MS) {
    const liveFeed = await fetchNascarLiveFeed();
    if (
      liveFeed &&
      isLiveFeedRaceInProgress(liveFeed) &&
      runNameMatchesRace(liveFeed.runName, race.name)
    ) {
      await lockRaceAndSubmittedPicks(leagueId, raceId, "save-pick-live-feed-guard");
      throw new HttpsError("failed-precondition", "Picks are locked for this race.");
    }
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
}));

export const computeRaceTiers = onCall({ invoker: "public" }, withHttpsErrorHandling("computeRaceTiers", async (request) => {
  const userId = requireAuthUid(request.auth?.uid);
  const leagueId = requireString(request.data?.leagueId, "leagueId");
  const raceId = requireString(request.data?.raceId, "raceId");
  logger.info("computeRaceTiers called", { leagueId, raceId, userId });

  await assertAdminInLeague(leagueId, userId);
  await computeTiersForRace(leagueId, raceId);

  return { ok: true };
}));

export const manualRefreshData = onCall({ invoker: "public" }, withHttpsErrorHandling("manualRefreshData", async (request) => {
  const userId = requireAuthUid(request.auth?.uid);
  const leagueId = requireString(request.data?.leagueId, "leagueId");
  logger.info("manualRefreshData called", { leagueId, userId });

  await assertAdminInLeague(leagueId, userId);
  await ingestScheduleAndStandings(leagueId);
  // Manual refresh should backfill official results for the full season.
  await refreshRecentRaceResults(leagueId, 365);

  return { ok: true };
}));

export const updateLeagueSettings = onCall({ invoker: "public" }, withHttpsErrorHandling("updateLeagueSettings", async (request) => {
  const data = (request.data ?? {}) as Partial<UpdateLeagueSettingsRequest>;
  const userId = requireAuthUid(request.auth?.uid);
  const leagueId = requireString(data.leagueId, "leagueId");
  logger.info("updateLeagueSettings called", { leagueId, userId });
  await assertAdminInLeague(leagueId, userId);

  const name = requireString(data.name, "name");
  const seasonYear = requireNumber(data.seasonYear, "seasonYear");
  const payoutConfigText =
    typeof data.payoutConfigText === "string"
      ? data.payoutConfigText.trim()
      : "";

  await leagueRef(leagueId).set(
    {
      name,
      seasonYear,
      payoutConfigText,
      updatedAt: nowTimestamp(),
    },
    { merge: true },
  );
  return { ok: true };
}));

export const updateMemberPaidStatus = onCall({ invoker: "public" }, withHttpsErrorHandling("updateMemberPaidStatus", async (request) => {
  const data = (request.data ?? {}) as Partial<UpdateMemberPaidStatusRequest>;
  const userId = requireAuthUid(request.auth?.uid);
  const leagueId = requireString(data.leagueId, "leagueId");
  const memberUserId = requireString(data.userId, "userId");
  const paidStatus = requireString(data.paidStatus, "paidStatus");
  logger.info("updateMemberPaidStatus called", {
    leagueId,
    memberUserId,
    paidStatus,
    userId,
  });
  await assertAdminInLeague(leagueId, userId);
  if (paidStatus !== "paid" && paidStatus !== "unpaid") {
    throw new HttpsError("invalid-argument", "paidStatus must be 'paid' or 'unpaid'.");
  }

  await membersRef(leagueId).doc(memberUserId).set(
    {
      paidStatus,
      updatedAt: nowTimestamp(),
    },
    { merge: true },
  );
  return { ok: true };
}));

export const manualUpsertRacePoints = onCall({ invoker: "public" }, withHttpsErrorHandling("manualUpsertRacePoints", async (request) => {
  const userId = requireAuthUid(request.auth?.uid);
  const leagueId = requireString(request.data?.leagueId, "leagueId");
  const raceId = requireString(request.data?.raceId, "raceId");
  logger.info("manualUpsertRacePoints called", { leagueId, raceId, userId });
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
  await rescoreRace(leagueId, raceId);

  return { ok: true };
}));

export const addAdjustment = onCall({ invoker: "public" }, withHttpsErrorHandling("addAdjustment", async (request) => {
  const userId = requireAuthUid(request.auth?.uid);
  const leagueId = requireString(request.data?.leagueId, "leagueId");
  logger.info("addAdjustment called", { leagueId, userId });
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
  await rescoreRace(leagueId, raceId);

  return { ok: true };
}));

export const lockPicksAtRaceStart = onSchedule(
  {
    schedule: BASE_LOCK_CHECK_SCHEDULE,
    timeZone: "America/New_York",
    retryCount: 1,
  },
  async () => {
    const [leagueIds, liveFeed] = await Promise.all([
      getLeagueIds(),
      fetchNascarLiveFeed(),
    ]);

    await runLockCycle({
      source: "baseline",
      dueLockLeagueIds: leagueIds,
      liveFeed,
      liveFeedLeagueIds: leagueIds,
    });
  },
);

export const lockPicksAtRaceStartRaceHour = onSchedule(
  {
    schedule: RACE_HOUR_LOCK_CHECK_SCHEDULE,
    timeZone: "America/New_York",
    retryCount: 1,
  },
  async () => {
    const nowMs = Date.now();
    const [dueLockLeagueIds, liveFeed] = await Promise.all([
      getLeagueIdsWithScheduledRaceLockWindow(
        nowMs - RACE_HOUR_LOOKBACK_MS,
        nowMs + RACE_HOUR_LOOKAHEAD_MS,
      ),
      fetchNascarLiveFeed(),
    ]);

    let liveFeedLeagueIds: string[] = [];
    if (liveFeed) {
      liveFeedLeagueIds = await getLeagueIdsWithScheduledRaceLockWindow(
        nowMs - LIVE_FEED_MATCH_WINDOW_PAST_MS,
        nowMs + LIVE_FEED_MATCH_WINDOW_FUTURE_MS,
      );
      if (liveFeedLeagueIds.length === 0) {
        liveFeedLeagueIds = await getLeagueIds();
      }
    }

    await runLockCycle({
      source: "race-hour",
      dueLockLeagueIds,
      liveFeed,
      liveFeedLeagueIds,
    });
  },
);

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
    await syncLiveRaceForLeagues(leagueIds, feed, 8);
    logger.info("NASCAR live sync cycle complete", {
      runName: feed.runName,
      lapNumber: feed.lapNumber,
      leagues: leagueIds.length,
    });
  },
);

export const syncLiveRaceNow = onCall({ invoker: "public" }, withHttpsErrorHandling("syncLiveRaceNow", async (request) => {
  const userId = requireAuthUid(request.auth?.uid);
  const leagueId = requireString(request.data?.leagueId, "leagueId");
  logger.info("syncLiveRaceNow called", { leagueId, userId });
  await assertAdminInLeague(leagueId, userId);
  const result = await applyNascarLiveFeedToLeague(leagueId);
  return result.updated ? { ok: true, updated: true } : { ok: true, updated: false, reason: result.reason };
}));

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
