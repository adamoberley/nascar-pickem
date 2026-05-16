import "./setup";

import { Timestamp } from "firebase-admin/firestore";
import { logger } from "firebase-functions/v2";
import { HttpsError, onCall } from "firebase-functions/v2/https";
import type { CallableRequest } from "firebase-functions/v2/https";
import {
  assertAdminInLeague,
  db,
  leagueRef,
  membersRef,
  nowTimestamp,
  picksRef,
  racePointsRef,
  racesRef,
  userDevicesRef,
} from "./data";
import { ingestScheduleAndStandings, refreshRecentRaceResults } from "./ingest";
import { applyNascarLiveFeedToLeague } from "./live-sync";
import { rescoreRace } from "./scoring";
import { computeTiersForRace } from "./tiers";
import type {
  AdjustmentType,
  LeagueDoc,
  MemberDoc,
  PickDoc,
  RaceDoc,
  RaceDriverPoints,
  TierDoc,
} from "./types";
import type {
  GetLeaguePreviewByInviteCodeRequest,
  GetLeaguePreviewByInviteCodeResponse,
  RemovePushTokenRequest,
  UpsertPushTokenRequest,
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

const LIVE_SYNC_COOLDOWN_MS = 60 * 1000;

async function assertMember(leagueId: string, userId: string): Promise<MemberDoc> {
  const memberSnap = await membersRef(leagueId).doc(userId).get();
  if (!memberSnap.exists) {
    throw new HttpsError("permission-denied", "You are not a member of this league.");
  }
  return memberSnap.data() as MemberDoc;
}

function normalizeDeviceId(input: string): string {
  const normalized = toDocId(input);
  if (normalized.length > 0) return normalized;
  return toDocId(`${Date.now()}-${Math.random()}`);
}

function normalizePlatform(raw: string): "ios" | "web" {
  const lower = raw.trim().toLowerCase();
  if (lower !== "ios" && lower !== "web") {
    throw new HttpsError("invalid-argument", "platform must be 'ios' or 'web'.");
  }
  return lower;
}

async function reserveLiveSyncCooldownWindow(
  leagueId: string,
  userId: string,
): Promise<{ allowed: true } | { allowed: false; retryAfterSeconds: number }> {
  const throttleRef = leagueRef(leagueId).collection("meta").doc("liveSync");
  const now = nowTimestamp();
  const nowMs = now.toMillis();

  return db.runTransaction(async (transaction) => {
    const throttleSnap = await transaction.get(throttleRef);
    const throttleData = throttleSnap.data() as { lastRequestedAt?: Timestamp } | undefined;
    const lastRequestedAtMs = throttleData?.lastRequestedAt?.toMillis?.() ?? 0;

    if (lastRequestedAtMs > 0) {
      const elapsedMs = nowMs - lastRequestedAtMs;
      if (elapsedMs < LIVE_SYNC_COOLDOWN_MS) {
        const retryAfterSeconds = Math.max(
          1,
          Math.ceil((LIVE_SYNC_COOLDOWN_MS - elapsedMs) / 1000),
        );
        return { allowed: false as const, retryAfterSeconds };
      }
    }

    transaction.set(
      throttleRef,
      {
        lastRequestedAt: now,
        lastRequestedBy: userId,
        updatedAt: now,
      },
      { merge: true },
    );
    return { allowed: true as const };
  });
}

function withHttpsErrorHandling<TResponse, TData extends Record<string, unknown> = Record<string, unknown>>(
  callableName: string,
  handler: (request: CallableRequest<TData>) => Promise<TResponse>,
): (request: CallableRequest<TData>) => Promise<TResponse> {
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

export const createLeague = onCall({ invoker: "public", memory: "256MiB" }, withHttpsErrorHandling("createLeague", async (request) => {
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

  const userEmail =
    typeof request.auth?.token?.email === "string" ? request.auth.token.email.trim().toLowerCase() : "";
  await db.collection("users").doc(userId).set(
    {
      displayName: adminDisplayName,
      ...(userEmail ? { email: userEmail } : {}),
      updatedAt: nowTimestamp(),
    },
    { merge: true },
  );

  return {
    leagueId: leagueDocRef.id,
    inviteCode,
  };
}));

export const joinLeagueByInvite = onCall({ invoker: "public", memory: "256MiB" }, withHttpsErrorHandling("joinLeagueByInvite", async (request) => {
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
  const userEmail =
    typeof request.auth?.token?.email === "string" ? request.auth.token.email.trim().toLowerCase() : "";
  await db.collection("users").doc(userId).set(
    {
      displayName,
      ...(userEmail ? { email: userEmail } : {}),
      updatedAt: nowTimestamp(),
    },
    { merge: true },
  );
  logger.info("User document updated successfully");

  return { leagueId, displayName };
}));

export const getLeaguePreviewByInviteCode = onCall({ invoker: "public", memory: "256MiB" }, withHttpsErrorHandling("getLeaguePreviewByInviteCode", async (request) => {
  requireAuthUid(request.auth?.uid);
  const data = (request.data ?? {}) as Partial<GetLeaguePreviewByInviteCodeRequest>;
  const inviteCode = requireString(data.inviteCode, "inviteCode").toUpperCase();

  const leagueSnap = await db
    .collection("leagues")
    .where("inviteCode", "==", inviteCode)
    .limit(1)
    .get();
  if (leagueSnap.empty) {
    throw new HttpsError("not-found", "Invite code not found.");
  }

  const leagueDoc = leagueSnap.docs[0];
  const league = leagueDoc.data() as LeagueDoc;
  let memberNames =
    (Array.isArray(league.memberNames) ? league.memberNames : [])
      .map((name) => String(name ?? "").trim())
      .filter((name) => name.length > 0);

  if (memberNames.length === 0) {
    const membersSnap = await membersRef(leagueDoc.id).orderBy("displayName", "asc").get();
    memberNames = membersSnap.docs
      .map((memberDocSnap) => {
        const member = memberDocSnap.data() as MemberDoc;
        return String(member.displayName ?? "").trim();
      })
      .filter((name) => name.length > 0);
  }

  const response: GetLeaguePreviewByInviteCodeResponse = {
    leagueId: leagueDoc.id,
    name: league.name,
    memberNames,
  };
  return response;
}));

export const upsertPushToken = onCall({ invoker: "public", memory: "256MiB" }, withHttpsErrorHandling("upsertPushToken", async (request) => {
  const userId = requireAuthUid(request.auth?.uid);
  const data = (request.data ?? {}) as Partial<UpsertPushTokenRequest>;
  const token = requireString(data.token, "token");
  const platform = normalizePlatform(requireString(data.platform, "platform"));
  const requestedDeviceId =
    typeof data.deviceId === "string" && data.deviceId.trim().length > 0
      ? data.deviceId
      : token.slice(0, 80);
  const deviceId = normalizeDeviceId(requestedDeviceId);
  const now = nowTimestamp();

  await userDevicesRef(userId).doc(deviceId).set(
    {
      token,
      platform,
      createdAt: now,
      updatedAt: now,
      lastSeenAt: now,
    },
    { merge: true },
  );

  return { ok: true, deviceId };
}));

export const removePushToken = onCall({ invoker: "public", memory: "256MiB" }, withHttpsErrorHandling("removePushToken", async (request) => {
  const userId = requireAuthUid(request.auth?.uid);
  const data = (request.data ?? {}) as Partial<RemovePushTokenRequest>;
  const token = requireString(data.token, "token");
  const now = nowTimestamp();

  if (typeof data.deviceId === "string" && data.deviceId.trim().length > 0) {
    const deviceId = normalizeDeviceId(data.deviceId);
    await userDevicesRef(userId).doc(deviceId).set(
      {
        token: "",
        disabledAt: now,
        updatedAt: now,
      },
      { merge: true },
    );
    return { ok: true };
  }

  const devicesSnap = await userDevicesRef(userId)
    .where("token", "==", token)
    .get();
  const writes: Promise<FirebaseFirestore.WriteResult>[] = [];
  devicesSnap.forEach((docSnap) => {
    writes.push(docSnap.ref.set(
      {
        token: "",
        disabledAt: now,
        updatedAt: now,
      },
      { merge: true },
    ));
  });
  await Promise.all(writes);
  return { ok: true };
}));

export const savePick = onCall({ invoker: "public", memory: "256MiB" }, withHttpsErrorHandling("savePick", async (request) => {
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

export const computeRaceTiers = onCall({ invoker: "public", memory: "256MiB" }, withHttpsErrorHandling("computeRaceTiers", async (request) => {
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

export const updateLeagueSettings = onCall({ invoker: "public", memory: "256MiB" }, withHttpsErrorHandling("updateLeagueSettings", async (request) => {
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

export const updateMemberPaidStatus = onCall({ invoker: "public", memory: "256MiB" }, withHttpsErrorHandling("updateMemberPaidStatus", async (request) => {
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

export const syncLiveRaceNow = onCall({ invoker: "public" }, withHttpsErrorHandling("syncLiveRaceNow", async (request) => {
  const userId = requireAuthUid(request.auth?.uid);
  const leagueId = requireString(request.data?.leagueId, "leagueId");
  logger.info("syncLiveRaceNow called", { leagueId, userId });
  await assertMember(leagueId, userId);

  const cooldownWindow = await reserveLiveSyncCooldownWindow(leagueId, userId);
  if (!cooldownWindow.allowed) {
    logger.info("syncLiveRaceNow throttled", {
      leagueId,
      userId,
      retryAfterSeconds: cooldownWindow.retryAfterSeconds,
    });
    return {
      ok: true,
      updated: false,
      throttled: true,
      retryAfterSeconds: cooldownWindow.retryAfterSeconds,
      reason: `Please wait ${cooldownWindow.retryAfterSeconds}s before refreshing live data again.`,
    };
  }

  const result = await applyNascarLiveFeedToLeague(leagueId);
  const cooldownSeconds = Math.ceil(LIVE_SYNC_COOLDOWN_MS / 1000);
  return result.updated
    ? { ok: true, updated: true, throttled: false, retryAfterSeconds: cooldownSeconds }
    : {
        ok: true,
        updated: false,
        throttled: false,
        retryAfterSeconds: cooldownSeconds,
        reason: result.reason,
      };
}));
