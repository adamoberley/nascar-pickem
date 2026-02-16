function getZonedDateParts(
  timestampMs: number,
  timeZone: string,
): { year: number; month: number; day: number; hour: number; minute: number; second: number } {
  const formatter = new Intl.DateTimeFormat("en-US", {
    timeZone,
    hour12: false,
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
    hour: "2-digit",
    minute: "2-digit",
    second: "2-digit",
  });
  const parts = formatter.formatToParts(new Date(timestampMs));
  const get = (type: Intl.DateTimeFormatPartTypes) =>
    Number(parts.find((part) => part.type === type)?.value ?? "0");
  return {
    year: get("year"),
    month: get("month"),
    day: get("day"),
    hour: get("hour"),
    minute: get("minute"),
    second: get("second"),
  };
}

function getTimeZoneOffsetMinutes(timestampMs: number, timeZone: string): number {
  const parts = getZonedDateParts(timestampMs, timeZone);
  const asUtcMs = Date.UTC(
    parts.year,
    parts.month - 1,
    parts.day,
    parts.hour,
    parts.minute,
    parts.second,
  );
  return (asUtcMs - timestampMs) / 60000;
}

function zonedTimeToUtcMs(
  year: number,
  month: number,
  day: number,
  hour: number,
  minute: number,
  timeZone: string,
): number {
  const utcGuess = Date.UTC(year, month - 1, day, hour, minute, 0, 0);
  const firstOffset = getTimeZoneOffsetMinutes(utcGuess, timeZone);
  let utcMs = utcGuess - firstOffset * 60_000;
  const secondOffset = getTimeZoneOffsetMinutes(utcMs, timeZone);
  if (secondOffset !== firstOffset) {
    utcMs = utcGuess - secondOffset * 60_000;
  }
  return utcMs;
}

/**
 * Returns UTC millis for 10:00 PM America/New_York on the day after the provided timestamp's NY date.
 */
export function nextDay10pmEasternMs(startTimeMs: number): number {
  const easternDate = getZonedDateParts(startTimeMs, "America/New_York");
  const nextDayUtc = new Date(Date.UTC(easternDate.year, easternDate.month - 1, easternDate.day));
  nextDayUtc.setUTCDate(nextDayUtc.getUTCDate() + 1);
  const year = nextDayUtc.getUTCFullYear();
  const month = nextDayUtc.getUTCMonth() + 1;
  const day = nextDayUtc.getUTCDate();
  return zonedTimeToUtcMs(year, month, day, 22, 0, "America/New_York");
}
