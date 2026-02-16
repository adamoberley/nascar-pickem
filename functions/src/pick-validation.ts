import { HttpsError } from "firebase-functions/v2/https";
import type { TierDoc } from "./types";
import { assertNoDuplicates } from "./utils";

export function validatePickAgainstTiers(
  selection: { tierA: string[]; tierB: string[]; tierC: string[] },
  tiers: TierDoc,
): void {
  selection.tierA.forEach((driverId) => {
    if (!tiers.tierA.includes(driverId)) {
      throw new HttpsError("invalid-argument", `Driver ${driverId} is not in Tier A.`);
    }
  });

  selection.tierB.forEach((driverId) => {
    if (!tiers.tierB.includes(driverId)) {
      throw new HttpsError("invalid-argument", `Driver ${driverId} is not in Tier B.`);
    }
  });

  selection.tierC.forEach((driverId) => {
    if (!tiers.tierC.includes(driverId)) {
      throw new HttpsError("invalid-argument", `Driver ${driverId} is not in Tier C.`);
    }
  });

  assertNoDuplicates(
    [...selection.tierA, ...selection.tierB, ...selection.tierC],
    "Pick tiers",
  );
}
