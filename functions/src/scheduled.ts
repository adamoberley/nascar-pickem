import "./setup";

import { Timestamp } from "firebase-admin/firestore";
import { getAuth } from "firebase-admin/auth";
import { getMessaging } from "firebase-admin/messaging";
import { logger } from "firebase-functions/v2";
import { onSchedule } from "firebase-functions/v2/scheduler";
import {
  getLeagueIds,
  leagueRef,
  mailQueueRef,
  membersRef,
  nowTimestamp,
  picksRef,
  racesRef,
  userDevicesRef,
  userNotificationsRef,
} from "./data";
import { ingestScheduleAndStandings, refreshRecentRaceResults } from "./ingest";
import { rescoreRace } from "./scoring";
import type {
  PickDoc,
  RaceDoc,
  UserNotificationDoc,
} from "./types";

const LOCK_CHECK_SCHEDULE = "every 30 minutes";
const PICK_REMINDER_SCHEDULE = "0 13 * * SUN";
const PICK_REMINDER_LOOKAHEAD_HOURS = 168;
const ENABLE_PUSH_REMINDERS = process.env.ENABLE_PUSH_REMINDERS !== "0";
const ENABLE_EMAIL_REMINDERS = process.env.ENABLE_EMAIL_REMINDERS === "1";
const REMINDER_EMAIL_FROM = process.env.REMINDER_EMAIL_FROM?.trim() ?? "";

type PickReminderBucket = "168h" | "72h" | "24h" | "12h" | "3h";

type CachedDeviceToken = {
  deviceId: string;
  token: string;
};

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
