import { Timestamp } from "firebase-admin/firestore";
import { getAuth } from "firebase-admin/auth";
import { getMessaging } from "firebase-admin/messaging";
import { logger } from "firebase-functions/v2";
import { HttpsError, onCall } from "firebase-functions/v2/https";
import type { CallableRequest } from "firebase-functions/v2/https";
import { onSchedule } from "firebase-functions/v2/scheduler";
import { setGlobalOptions } from "firebase-functions/v2/options";
import {
  assertAdminInLeague,
  db,
  getLeagueIds,
  leagueRef,
  mailQueueRef,
  membersRef,
  nowTimestamp,
  picksRef,
  racePointsRef,
  racesRef,
  seasonScoresRef,
  userDevicesRef,
  userNotificationsRef,
} from "./data";
import { ingestScheduleAndStandings, refreshRecentRaceResults } from "./ingest";
import {
  applyNascarLiveFeedToLeague,
} from "./live-sync";
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
  UserNotificationDoc,
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

setGlobalOptions({
  region: "us-central1",
  memory: "512MiB",
  timeoutSeconds: 120,
});

const LOCK_CHECK_SCHEDULE = "every 30 minutes";
const PICK_REMINDER_SCHEDULE = "0 13 * * SUN";
const PICK_REMINDER_LOOKAHEAD_HOURS = 168;
const LIVE_SYNC_COOLDOWN_MS = 60 * 1000;
const ENABLE_PUSH_REMINDERS = process.env.ENABLE_PUSH_REMINDERS !== "0";
const ENABLE_EMAIL_REMINDERS = process.env.ENABLE_EMAIL_REMINDERS === "1";
const REMINDER_EMAIL_FROM = process.env.REMINDER_EMAIL_FROM?.trim() ?? "";

type PickReminderBucket = "168h" | "72h" | "24h" | "12h" | "3h";

type CachedDeviceToken = {
  deviceId: string;
  token: string;
};

async function assertMember(leagueId: string, userId: string): Promise<MemberDoc> {
  const memberSnap = await membersRef(leagueId).doc(userId).get();
  if (!memberSnap.exists) {
    throw new HttpsError("permission-denied", "You are not a member of this league.");
  }
  return memberSnap.data() as MemberDoc;
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

function getPickReminderBucket(hoursUntilLock: number): PickReminderBucket | null {
  if (!Number.isFinite(hoursUntilLock) || hoursUntilLock <= 0) return null;
  if (hoursUntilLock <= 3) return "3h";
  if (hoursUntilLock <= 12) return "12h";
  if (hoursUntilLock <= 24) return "24h";
  if (hoursUntilLock <= 72) return "72h";
  if (hoursUntilLock <= 168) return "168h";
  return null;
}

function toReminderMessage(hoursUntilLock: number, raceName: string): string {
  if (hoursUntilLock <= 3) {
    return `Picks lock soon for ${raceName}. Confirm your picks now.`;
  }
  if (hoursUntilLock <= 12) {
    return `Picks lock today for ${raceName}. Confirm your picks now.`;
  }
  if (hoursUntilLock <= 24) {
    return `Reminder: confirm your picks for ${raceName}.`;
  }
  return `Weekly reminder: confirm your picks for ${raceName}.`;
}

function toReminderEmailBody(input: {
  leagueName: string;
  raceName: string;
  lockTime: Timestamp;
  message: string;
}): string {
  return [
    `${input.message}`,
    "",
    `League: ${input.leagueName}`,
    `Race: ${input.raceName}`,
    `Lock time (UTC): ${input.lockTime.toDate().toISOString()}`,
    "",
    "Open NASCAR Pick'Em to submit your picks.",
  ].join("\n");
}

function isInvalidMessagingTokenError(errorCode: string | undefined): boolean {
  return (
    errorCode === "messaging/registration-token-not-registered" ||
    errorCode === "messaging/invalid-registration-token"
  );
}

async function fetchUserDeviceTokens(
  userId: string,
  tokenCache: Map<string, CachedDeviceToken[]>,
): Promise<CachedDeviceToken[]> {
  const cached = tokenCache.get(userId);
  if (cached) return cached;

  const devicesSnap = await userDevicesRef(userId).get();
  const tokens: CachedDeviceToken[] = devicesSnap.docs
    .map((docSnap) => {
      const token = (docSnap.data() as { token?: string }).token?.trim() ?? "";
      if (!token) return null;
      return { deviceId: docSnap.id, token };
    })
    .filter((entry): entry is CachedDeviceToken => entry !== null);

  tokenCache.set(userId, tokens);
  return tokens;
}

async function sendPushReminder(input: {
  userId: string;
  reminderDocId: string;
  payload: UserNotificationDoc;
  tokenCache: Map<string, CachedDeviceToken[]>;
}): Promise<number> {
  if (!ENABLE_PUSH_REMINDERS) return 0;

  const deviceTokens = await fetchUserDeviceTokens(input.userId, input.tokenCache);
  if (deviceTokens.length === 0) return 0;

  const response = await getMessaging().sendEachForMulticast({
    tokens: deviceTokens.map((entry) => entry.token),
    notification: {
      title: input.payload.title || "Picks due",
      body: input.payload.message,
    },
    data: {
      type: input.payload.type,
      leagueId: input.payload.leagueId,
      raceId: input.payload.raceId,
      notificationId: input.reminderDocId,
      lockTimeMs: String(input.payload.lockTime.toMillis()),
    },
    apns: {
      payload: {
        aps: {
          sound: "default",
        },
      },
    },
  });

  const invalidTokenDeletes: Promise<FirebaseFirestore.WriteResult>[] = [];
  response.responses.forEach((result, index) => {
    if (result.success) return;
    if (!isInvalidMessagingTokenError(result.error?.code)) return;
    invalidTokenDeletes.push(
      userDevicesRef(input.userId).doc(deviceTokens[index].deviceId).delete(),
    );
  });
  if (invalidTokenDeletes.length > 0) {
    await Promise.all(invalidTokenDeletes);
  }

  return response.successCount;
}

async function fetchUserEmail(
  userId: string,
  emailCache: Map<string, string | null>,
): Promise<string | null> {
  const cached = emailCache.get(userId);
  if (cached !== undefined) return cached;

  let email: string | null = null;
  try {
    const authUser = await getAuth().getUser(userId);
    const normalized = authUser.email?.trim().toLowerCase() ?? "";
    email = normalized || null;
  } catch (error) {
    logger.warn("Unable to load auth user for reminder email", {
      userId,
      error: error instanceof Error ? error.message : String(error),
    });
  }
  emailCache.set(userId, email);
  return email;
}

async function queueReminderEmail(input: {
  userId: string;
  leagueId: string;
  raceId: string;
  bucket: PickReminderBucket;
  leagueName: string;
  raceName: string;
  payload: UserNotificationDoc;
  emailCache: Map<string, string | null>;
}): Promise<number> {
  if (!ENABLE_EMAIL_REMINDERS) return 0;

  const userEmail = await fetchUserEmail(input.userId, input.emailCache);
  if (!userEmail) return 0;

  const mailDocId = `pick-reminder_${input.userId}_${input.leagueId}_${input.raceId}_${input.bucket}`;
  const mailRef = mailQueueRef().doc(mailDocId);
  const existingMailSnap = await mailRef.get();
  if (existingMailSnap.exists) return 0;

  const subject = `${input.leagueName}: picks due for ${input.raceName}`;
  const textBody = toReminderEmailBody({
    leagueName: input.leagueName,
    raceName: input.raceName,
    lockTime: input.payload.lockTime,
    message: input.payload.message,
  });
  const message: Record<string, unknown> = {
    subject,
    text: textBody,
  };
  if (REMINDER_EMAIL_FROM) {
    message.from = REMINDER_EMAIL_FROM;
  }

  await mailRef.set({
    to: [userEmail],
    message,
    meta: {
      type: "pick_reminder",
      userId: input.userId,
      leagueId: input.leagueId,
      raceId: input.raceId,
      bucket: input.bucket,
    },
    createdAt: nowTimestamp(),
  });

  return 1;
}

async function queueMissingPickRemindersForLeague(
  leagueId: string,
  now: Timestamp,
): Promise<{ remindersCreated: number; racesChecked: number; pushSent: number; emailsQueued: number }> {
  const nowMs = now.toMillis();
  const lockHorizon = Timestamp.fromMillis(
    nowMs + PICK_REMINDER_LOOKAHEAD_HOURS * 60 * 60 * 1000,
  );

  const racesSnap = await racesRef(leagueId)
    .where("lockTime", "<=", lockHorizon)
    .get();
  const dueRaces = racesSnap.docs.filter((raceDocSnap) => {
    const race = raceDocSnap.data() as RaceDoc;
    if (race.status !== "scheduled") return false;
    const lockMs = race.lockTime?.toMillis?.() ?? 0;
    return lockMs > nowMs;
  });

  if (dueRaces.length === 0) {
    return { remindersCreated: 0, racesChecked: 0, pushSent: 0, emailsQueued: 0 };
  }

  const leagueSnap = await leagueRef(leagueId).get();
  const leagueName = leagueSnap.exists
    ? ((leagueSnap.data() as { name?: string }).name ?? "Your league")
    : "Your league";
  const tokenCache = new Map<string, CachedDeviceToken[]>();
  const emailCache = new Map<string, string | null>();

  let remindersCreated = 0;
  let pushSent = 0;
  let emailsQueued = 0;
  for (const raceDocSnap of dueRaces) {
    const raceId = raceDocSnap.id;
    const race = raceDocSnap.data() as RaceDoc;
    const lockMs = race.lockTime.toMillis();
    const hoursUntilLock = (lockMs - nowMs) / (60 * 60 * 1000);
    const bucket = getPickReminderBucket(hoursUntilLock);
    if (!bucket) continue;

    const [membersSnap, picksSnap] = await Promise.all([
      membersRef(leagueId).get(),
      picksRef(leagueId).where("raceId", "==", raceId).get(),
    ]);
    const pickedUserIds = new Set<string>();
    picksSnap.forEach((pickDocSnap) => {
      const pick = pickDocSnap.data() as PickDoc;
      pickedUserIds.add(pick.userId);
    });

    const reminderWrites: Promise<void>[] = [];
    membersSnap.forEach((memberDocSnap) => {
      const userId = memberDocSnap.id;
      if (pickedUserIds.has(userId)) return;

      const reminderDocId = `pick-reminder_${leagueId}_${raceId}_${bucket}`;
      const reminderRef = userNotificationsRef(userId).doc(reminderDocId);
      reminderWrites.push(
        reminderRef.get().then(async (reminderSnap) => {
          if (reminderSnap.exists) return;
          const payload: UserNotificationDoc = {
            type: "pick_reminder",
            leagueId,
            raceId,
            title: `${leagueName}: picks due`,
            message: toReminderMessage(hoursUntilLock, race.name),
            lockTime: race.lockTime,
            createdAt: nowTimestamp(),
          };
          remindersCreated += 1;
          await reminderRef.set(payload);
          const [pushCount, emailCount] = await Promise.all([
            sendPushReminder({
              userId,
              reminderDocId,
              payload,
              tokenCache,
            }).catch((error) => {
              logger.warn("sendPushReminder failed", {
                userId,
                leagueId,
                raceId,
                error: error instanceof Error ? error.message : String(error),
              });
              return 0;
            }),
            queueReminderEmail({
              userId,
              leagueId,
              raceId,
              bucket,
              leagueName,
              raceName: race.name,
              payload,
              emailCache,
            }).catch((error) => {
              logger.warn("queueReminderEmail failed", {
                userId,
                leagueId,
                raceId,
                error: error instanceof Error ? error.message : String(error),
              });
              return 0;
            }),
          ]);
          pushSent += pushCount;
          emailsQueued += emailCount;
        }),
      );
    });
    await Promise.all(reminderWrites);
  }

  return { remindersCreated, racesChecked: dueRaces.length, pushSent, emailsQueued };
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

export const getLeaguePreviewByInviteCode = onCall({ invoker: "public" }, withHttpsErrorHandling("getLeaguePreviewByInviteCode", async (request) => {
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

export const upsertPushToken = onCall({ invoker: "public" }, withHttpsErrorHandling("upsertPushToken", async (request) => {
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

export const removePushToken = onCall({ invoker: "public" }, withHttpsErrorHandling("removePushToken", async (request) => {
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
    schedule: LOCK_CHECK_SCHEDULE,
    timeZone: "America/New_York",
    retryCount: 1,
  },
  async () => {
    const leagueIds = await getLeagueIds();
    const now = nowTimestamp();
    let lockedByTime = 0;
    for (const leagueId of leagueIds) {
      lockedByTime += await lockDueRacesForLeague(leagueId, now);
    }
    logger.info("Scheduled lock cycle complete", {
      source: "lock-check",
      leaguesChecked: leagueIds.length,
      lockedByTime,
    });
  },
);

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

export const ingestLeagueDataDaily = onSchedule(
  {
    schedule: "0 0 * * MON",
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
    schedule: "15 0 * * MON",
    timeZone: "America/New_York",
  },
  async () => {
    const leagueIds = await getLeagueIds();
    await Promise.all(leagueIds.map((leagueId) => refreshRecentRaceResults(leagueId, 365)));
    logger.info("Race result refresh cycle complete", {
      leagues: leagueIds.length,
    });
  },
);

export const sendPickReminders = onSchedule(
  {
    schedule: PICK_REMINDER_SCHEDULE,
    timeZone: "America/New_York",
    retryCount: 1,
  },
  async () => {
    const leagueIds = await getLeagueIds();
    const now = nowTimestamp();
    let remindersCreated = 0;
    let racesChecked = 0;
    let pushSent = 0;
    let emailsQueued = 0;

    for (const leagueId of leagueIds) {
      const result = await queueMissingPickRemindersForLeague(leagueId, now);
      remindersCreated += result.remindersCreated;
      racesChecked += result.racesChecked;
      pushSent += result.pushSent;
      emailsQueued += result.emailsQueued;
    }

    logger.info("Pick reminder cycle complete", {
      leaguesChecked: leagueIds.length,
      racesChecked,
      remindersCreated,
      pushSent,
      emailsQueued,
      pushEnabled: ENABLE_PUSH_REMINDERS,
      emailEnabled: ENABLE_EMAIL_REMINDERS,
    });
  },
);
