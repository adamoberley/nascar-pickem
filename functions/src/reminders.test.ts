import { describe, expect, it } from "vitest";
import {
  isDayBeforeLock,
  leagueDayKey,
  nextDayKey,
  resolveDayBeforeBucket,
  resolveLookaheadBucket,
  toReminderMessage,
  toReminderTitle,
} from "./reminders";

/** Eastern-time helper: 2026-03-01T12:00:00-05:00 style instants. */
function et(iso: string): number {
  return new Date(iso).getTime();
}

describe("leagueDayKey", () => {
  it("uses the league time zone, not UTC", () => {
    // 2026-03-02T02:30:00Z is still Sunday March 1 in New York.
    expect(leagueDayKey(et("2026-03-02T02:30:00Z"))).toBe("2026-03-01");
  });
});

describe("nextDayKey", () => {
  it("advances one calendar day", () => {
    expect(nextDayKey("2026-03-01")).toBe("2026-03-02");
  });

  it("rolls over month and year boundaries", () => {
    expect(nextDayKey("2026-02-28")).toBe("2026-03-01");
    expect(nextDayKey("2026-12-31")).toBe("2027-01-01");
  });
});

describe("isDayBeforeLock", () => {
  it("fires on the calendar day before a Sunday afternoon lock", () => {
    const now = et("2026-03-07T22:00:00Z"); // Sat Mar 7, 5pm ET
    const lock = et("2026-03-08T19:00:00Z"); // Sun Mar 8, 3pm ET
    expect(isDayBeforeLock(lock, now)).toBe(true);
  });

  it("fires for a Saturday night race when run on Friday", () => {
    const now = et("2026-03-06T22:00:00Z"); // Fri Mar 6, 5pm ET
    const lock = et("2026-03-07T23:30:00Z"); // Sat Mar 7, 6:30pm ET
    expect(isDayBeforeLock(lock, now)).toBe(true);
  });

  it("does not fire on race day itself", () => {
    const now = et("2026-03-08T14:00:00Z"); // Sun Mar 8, 10am ET
    const lock = et("2026-03-08T19:00:00Z"); // Sun Mar 8, 3pm ET
    expect(isDayBeforeLock(lock, now)).toBe(false);
  });

  it("does not fire two days out", () => {
    const now = et("2026-03-06T22:00:00Z"); // Fri Mar 6
    const lock = et("2026-03-08T19:00:00Z"); // Sun Mar 8
    expect(isDayBeforeLock(lock, now)).toBe(false);
  });

  it("does not fire after the lock has passed", () => {
    const now = et("2026-03-08T20:00:00Z");
    const lock = et("2026-03-08T19:00:00Z");
    expect(isDayBeforeLock(lock, now)).toBe(false);
  });

  it("handles the spring-forward DST boundary", () => {
    // DST starts Sun Mar 8 2026 in the US; Sat -> Sun is still one calendar day.
    const now = et("2026-03-07T23:00:00Z"); // Sat Mar 7, 6pm EST
    const lock = et("2026-03-08T18:00:00Z"); // Sun Mar 8, 2pm EDT
    expect(isDayBeforeLock(lock, now)).toBe(true);
  });

  it("treats a late-night ET run as the same league day", () => {
    // 2026-03-08T02:00:00Z is Sat Mar 7, 9pm ET -> lock Sunday is still tomorrow.
    const now = et("2026-03-08T02:00:00Z");
    const lock = et("2026-03-08T19:00:00Z");
    expect(isDayBeforeLock(lock, now)).toBe(true);
  });
});

describe("resolveDayBeforeBucket", () => {
  it("returns the day-before bucket only when eligible", () => {
    expect(
      resolveDayBeforeBucket(et("2026-03-08T19:00:00Z"), et("2026-03-07T22:00:00Z")),
    ).toBe("day-before");
    expect(
      resolveDayBeforeBucket(et("2026-03-08T19:00:00Z"), et("2026-03-08T14:00:00Z")),
    ).toBeNull();
  });
});

describe("resolveLookaheadBucket", () => {
  const now = et("2026-03-08T12:00:00Z");
  const hours = (n: number) => now + n * 60 * 60 * 1000;

  it("buckets by hours remaining", () => {
    expect(resolveLookaheadBucket(hours(2), now)).toBe("3h");
    expect(resolveLookaheadBucket(hours(8), now)).toBe("12h");
    expect(resolveLookaheadBucket(hours(20), now)).toBe("24h");
    expect(resolveLookaheadBucket(hours(50), now)).toBe("72h");
    expect(resolveLookaheadBucket(hours(120), now)).toBe("168h");
  });

  it("returns null outside the lookahead window or after lock", () => {
    expect(resolveLookaheadBucket(hours(200), now)).toBeNull();
    expect(resolveLookaheadBucket(hours(-1), now)).toBeNull();
  });
});

describe("reminder copy", () => {
  it("uses tomorrow wording for the day-before bucket", () => {
    expect(toReminderTitle("day-before", "Turn 4 Club")).toBe(
      "Turn 4 Club: picks lock tomorrow",
    );
    expect(toReminderMessage("day-before", "Daytona 500")).toContain("tomorrow");
  });

  it("keeps existing wording for lock-window buckets", () => {
    expect(toReminderTitle("3h", "Turn 4 Club")).toBe("Turn 4 Club: picks due");
    expect(toReminderMessage("3h", "Daytona 500")).toBe(
      "Picks lock soon for Daytona 500. Confirm your picks now.",
    );
  });
});
