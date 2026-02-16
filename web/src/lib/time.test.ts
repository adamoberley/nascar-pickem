import { describe, expect, it } from "vitest";
import { nextDay10pmEasternMs } from "./time";

describe("nextDay10pmEasternMs", () => {
  it("handles standard-time offsets (EST)", () => {
    const startMs = Date.parse("2026-01-15T20:00:00.000Z");
    const cutoffMs = nextDay10pmEasternMs(startMs);
    expect(new Date(cutoffMs).toISOString()).toBe("2026-01-17T03:00:00.000Z");
  });

  it("handles daylight-saving offsets (EDT)", () => {
    const startMs = Date.parse("2026-07-01T20:00:00.000Z");
    const cutoffMs = nextDay10pmEasternMs(startMs);
    expect(new Date(cutoffMs).toISOString()).toBe("2026-07-03T02:00:00.000Z");
  });
});
