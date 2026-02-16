import { describe, expect, it } from "vitest";
import { buildNumberToDriverId } from "./driver-mapping";
import type { DriverDoc } from "./types";

interface DriverFixture {
  id: string;
  number: string;
}

function makeDriversSnap(fixtures: DriverFixture[]): FirebaseFirestore.QuerySnapshot {
  const docs = fixtures.map((fixture) => ({
    id: fixture.id,
    data: () =>
      ({
        name: fixture.id,
        number: fixture.number,
        team: "Team",
      }) as DriverDoc,
  }));

  return {
    forEach: (callback: (doc: FirebaseFirestore.QueryDocumentSnapshot) => void) => {
      for (const doc of docs) {
        callback(doc as unknown as FirebaseFirestore.QueryDocumentSnapshot);
      }
    },
  } as unknown as FirebaseFirestore.QuerySnapshot;
}

describe("buildNumberToDriverId", () => {
  it("keeps first mapping when duplicate car numbers exist", () => {
    const snap = makeDriversSnap([
      { id: "chase-briscoe", number: "19" },
      { id: "martin-truex-jr", number: "19" },
    ]);

    const byNumber = buildNumberToDriverId(snap);

    expect(byNumber.get("19")).toBe("chase-briscoe");
  });

  it("can restrict mapping to active standings drivers", () => {
    const snap = makeDriversSnap([
      { id: "martin-truex-jr", number: "19" },
      { id: "chase-briscoe", number: "19" },
      { id: "kyle-larson", number: "5" },
    ]);

    const byNumber = buildNumberToDriverId(snap, {
      includeDriverIds: new Set(["chase-briscoe", "kyle-larson"]),
    });

    expect(byNumber.get("19")).toBe("chase-briscoe");
    expect(byNumber.get("5")).toBe("kyle-larson");
    expect(byNumber.get("56")).toBeUndefined();
  });
});
