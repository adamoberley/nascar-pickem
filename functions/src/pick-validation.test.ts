import { HttpsError } from "firebase-functions/v2/https";
import { describe, expect, it } from "vitest";
import { validatePickAgainstTiers } from "./pick-validation";
import { extractTierDriverIds } from "./tiers";
import type { TierDoc } from "./types";

describe("validatePickAgainstTiers", () => {
  const tiers: TierDoc = {
    tierA: ["a1", "a2", "a3", "a4"],
    tierB: ["b1", "b2", "b3"],
    tierC: ["c1", "c2"],
    computedFromSnapshotId: "snap1",
    updatedAt: {} as FirebaseFirestore.Timestamp,
  };

  it("accepts valid picks", () => {
    expect(() =>
      validatePickAgainstTiers(
        {
          tierA: ["a1", "a2", "a3"],
          tierB: ["b1", "b2"],
          tierC: ["c1"],
        },
        tiers,
      ),
    ).not.toThrow();
  });

  it("rejects drivers outside tier", () => {
    expect(() =>
      validatePickAgainstTiers(
        {
          tierA: ["a1", "a2", "x1"],
          tierB: ["b1", "b2"],
          tierC: ["c1"],
        },
        tiers,
      ),
    ).toThrow(HttpsError);
  });

  it("rejects duplicate driver across tiers", () => {
    expect(() =>
      validatePickAgainstTiers(
        {
          tierA: ["a1", "a2", "a3"],
          tierB: ["b1", "a1"],
          tierC: ["c1"],
        },
        tiers,
      ),
    ).toThrow(HttpsError);
  });
});

describe("extractTierDriverIds", () => {
  it("maps standings positions into A/B/C tiers", () => {
    const snapshot = {
      drivers: [
        { driverId: "d25", position: 25 },
        { driverId: "d01", position: 1 },
        { driverId: "d12", position: 12 },
        { driverId: "d20", position: 20 },
        { driverId: "d30", position: 30 },
      ],
    } as {
      drivers: Array<{ driverId: string; position: number }>;
    };

    const tiers = extractTierDriverIds(snapshot as never);
    expect(tiers.tierA).toEqual(["d01"]);
    expect(tiers.tierB).toEqual(["d12", "d20"]);
    expect(tiers.tierC).toEqual(["d25", "d30"]);
  });
});
