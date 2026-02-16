import { describe, expect, it } from "vitest";
import { applyDriverPoints, buildPickScoreBreakdown } from "./scoring";
import type { PickDoc } from "./types";

describe("applyDriverPoints", () => {
  it("applies positive or zero adjustments", () => {
    expect(applyDriverPoints(20, 5)).toBe(25);
    expect(applyDriverPoints(20, 0)).toBe(20);
  });

  it("never returns negative points", () => {
    expect(applyDriverPoints(4, -10)).toBe(0);
  });
});

describe("buildPickScoreBreakdown", () => {
  it("scores unique picked drivers with adjustments", () => {
    const pick = {
      userId: "u1",
      raceId: "r1",
      tierA: ["d1", "d2", "d3"],
      tierB: ["d4", "d5"],
      tierC: ["d6"],
    } as PickDoc;
    const base = new Map<string, number>([
      ["d1", 40],
      ["d2", 35],
      ["d3", 30],
      ["d4", 20],
      ["d5", 15],
      ["d6", 10],
    ]);
    const adjustments = new Map<string, number>([
      ["d2", -10],
      ["d4", 5],
    ]);

    const scored = buildPickScoreBreakdown(pick, base, adjustments);

    expect(scored.breakdown).toHaveLength(6);
    expect(scored.weeklyTotal).toBe(145);
    expect(scored.hasAdjustments).toBe(true);
    expect(scored.breakdown.find((item) => item.driverId === "d2")?.finalPointsApplied).toBe(25);
    expect(scored.breakdown.find((item) => item.driverId === "d4")?.finalPointsApplied).toBe(25);
  });
});
