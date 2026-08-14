export const REMINDER_TIME_ZONE = "America/New_York";

export type PickReminderBucket =
  | "168h"
  | "72h"
  | "24h"
  | "12h"
  | "3h"
  | "day-before";

const dayKeyFormatter = new Intl.DateTimeFormat("en-CA", {
  timeZone: REMINDER_TIME_ZONE,
  year: "numeric",
  month: "2-digit",
  day: "2-digit",
});

/** Calendar date (YYYY-MM-DD) of an instant in league time. */
export function leagueDayKey(epochMs: number): string {
  return dayKeyFormatter.format(new Date(epochMs));
}

/** Next calendar date after a YYYY-MM-DD key (DST-safe: pure date math). */
export function nextDayKey(dayKey: string): string {
  const [year, month, day] = dayKey.split("-").map(Number);
  return new Date(Date.UTC(year, month - 1, day + 1)).toISOString().slice(0, 10);
}

/**
 * True when the lock falls on the league-time calendar day after `nowMs`.
 * Calendar-based (not a fixed hour offset) so the reminder always lands on
 * "the day before the race" regardless of when the job runs or the lock time.
 */
export function isDayBeforeLock(lockMs: number, nowMs: number): boolean {
  if (!Number.isFinite(lockMs) || lockMs <= nowMs) return false;
  return leagueDayKey(lockMs) === nextDayKey(leagueDayKey(nowMs));
}

export function resolveDayBeforeBucket(
  lockMs: number,
  nowMs: number,
): PickReminderBucket | null {
  return isDayBeforeLock(lockMs, nowMs) ? "day-before" : null;
}

export function resolveLookaheadBucket(
  lockMs: number,
  nowMs: number,
): PickReminderBucket | null {
  const hoursUntilLock = (lockMs - nowMs) / (60 * 60 * 1000);
  if (!Number.isFinite(hoursUntilLock) || hoursUntilLock <= 0) return null;
  if (hoursUntilLock <= 3) return "3h";
  if (hoursUntilLock <= 12) return "12h";
  if (hoursUntilLock <= 24) return "24h";
  if (hoursUntilLock <= 72) return "72h";
  if (hoursUntilLock <= 168) return "168h";
  return null;
}

export function toReminderTitle(
  bucket: PickReminderBucket,
  leagueName: string,
): string {
  if (bucket === "day-before") return `${leagueName}: picks lock tomorrow`;
  return `${leagueName}: picks due`;
}

export function toReminderMessage(
  bucket: PickReminderBucket,
  raceName: string,
): string {
  switch (bucket) {
    case "3h":
      return `Picks lock soon for ${raceName}. Confirm your picks now.`;
    case "12h":
      return `Picks lock today for ${raceName}. Confirm your picks now.`;
    case "day-before":
      return `${raceName} is tomorrow and you haven't picked yet. Set your picks before they lock.`;
    case "24h":
      return `Reminder: confirm your picks for ${raceName}.`;
    default:
      return `Weekly reminder: confirm your picks for ${raceName}.`;
  }
}
