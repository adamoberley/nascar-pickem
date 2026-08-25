import { describe, expect, it } from "vitest";
import {
  buildDriverLookup,
  buildNumberToDriverId,
  mapOfficialResultsToDrivers,
  normalizeDriverNameKey,
  resolveDriverIdsForIdentity,
} from "./driver-mapping";
import type { DriverDoc } from "./types";

interface DriverFixture {
  id: string;
  number: string;
  name?: string;
  nascarDriverId?: number;
}

function makeDriversSnap(fixtures: DriverFixture[]): FirebaseFirestore.QuerySnapshot {
  const docs = fixtures.map((fixture) => ({
    id: fixture.id,
    data: () =>
      ({
        name: fixture.name ?? fixture.id,
        number: fixture.number,
        team: "Team",
        nascarDriverId: fixture.nascarDriverId,
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

describe("normalizeDriverNameKey", () => {
  it("matches names across punctuation and accent differences", () => {
    expect(normalizeDriverNameKey("John H. Nemechek")).toBe(
      normalizeDriverNameKey("John H Nemechek"),
    );
    expect(normalizeDriverNameKey("Daniel Suárez")).toBe(
      normalizeDriverNameKey("Daniel Suarez"),
    );
  });
});

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

describe("resolveDriverIdsForIdentity", () => {
  it("resolves by nascarDriverId when the doc's car number is stale", () => {
    // Standings feed listed Nemechek as #40 while race results use #42.
    const lookup = buildDriverLookup(
      makeDriversSnap([
        { id: "john-hunter-nemechek", number: "40", name: "John H Nemechek", nascarDriverId: 4092 },
      ]),
    );

    expect(
      resolveDriverIdsForIdentity(
        { vehicleNumber: "42", driverName: "John H. Nemechek", nascarDriverId: 4092 },
        lookup,
      ),
    ).toEqual(["john-hunter-nemechek"]);
  });

  it("resolves by name even when the driver is excluded from the active number map", () => {
    // Kyle Busch dropped out of the standings feed, so his number is not in the
    // active-restricted number map, but his points must still land on his doc.
    const lookup = buildDriverLookup(
      makeDriversSnap([
        { id: "kyle-busch", number: "8", name: "Kyle Busch" },
        { id: "kyle-larson", number: "5", name: "Kyle Larson", nascarDriverId: 4030 },
      ]),
      { includeDriverIds: new Set(["kyle-larson"]) },
    );

    expect(
      resolveDriverIdsForIdentity(
        { vehicleNumber: "8", driverName: "Kyle Busch", nascarDriverId: 454 },
        lookup,
      ),
    ).toEqual(["kyle-busch"]);
  });

  it("resolves duplicate docs sharing a name so either doc scores", () => {
    const lookup = buildDriverLookup(
      makeDriversSnap([
        { id: "corey-lajoie", number: "7", name: "Daniel Suárez", nascarDriverId: 4113 },
        { id: "daniel-suarez", number: "7", name: "Daniel Suárez" },
      ]),
    );

    expect(
      resolveDriverIdsForIdentity(
        { vehicleNumber: "7", driverName: "Daniel Suárez", nascarDriverId: 4113 },
        lookup,
      ).sort(),
    ).toEqual(["corey-lajoie", "daniel-suarez"]);
  });

  it("falls back to vehicle number when identity fields do not match", () => {
    const lookup = buildDriverLookup(
      makeDriversSnap([{ id: "kyle-larson", number: "5", name: "K. Larson Jr." }]),
    );

    expect(
      resolveDriverIdsForIdentity(
        { vehicleNumber: "5", driverName: "Kyle Larson", nascarDriverId: 4030 },
        lookup,
      ),
    ).toEqual(["kyle-larson"]);
  });
});

describe("mapOfficialResultsToDrivers", () => {
  it("assigns points by driver identity, not just car number", () => {
    const lookup = buildDriverLookup(
      makeDriversSnap([
        { id: "john-hunter-nemechek", number: "40", name: "John H Nemechek", nascarDriverId: 4092 },
        { id: "kyle-busch", number: "8", name: "Kyle Busch", nascarDriverId: 454 },
        { id: "kyle-larson", number: "5", name: "Kyle Larson", nascarDriverId: 4030 },
      ]),
      { includeDriverIds: new Set(["john-hunter-nemechek", "kyle-larson"]) },
    );

    const mapped = mapOfficialResultsToDrivers(
      [
        { finishPosition: 1, vehicleNumber: "5", points: 55, driverName: "Kyle Larson", nascarDriverId: 4030 },
        { finishPosition: 2, vehicleNumber: "8", points: 43, driverName: "Kyle Busch", nascarDriverId: 454 },
        { finishPosition: 3, vehicleNumber: "42", points: 41, driverName: "John H. Nemechek", nascarDriverId: 4092 },
      ],
      lookup,
    );

    const byId = new Map(mapped.map((entry) => [entry.driverId, entry]));
    expect(byId.get("kyle-larson")?.basePoints).toBe(55);
    expect(byId.get("kyle-busch")?.basePoints).toBe(43);
    expect(byId.get("john-hunter-nemechek")?.basePoints).toBe(41);
    expect(byId.get("john-hunter-nemechek")?.finishPosition).toBe(3);
  });

  it("keeps the best finish when two rows map to the same driver doc", () => {
    const lookup = buildDriverLookup(
      makeDriversSnap([{ id: "kyle-larson", number: "5", name: "Kyle Larson", nascarDriverId: 4030 }]),
    );

    const mapped = mapOfficialResultsToDrivers(
      [
        { finishPosition: 4, vehicleNumber: "5", points: 33, driverName: "Kyle Larson", nascarDriverId: 4030 },
        { finishPosition: 9, vehicleNumber: "5", points: 28, driverName: "Kyle Larson", nascarDriverId: 4030 },
      ],
      lookup,
    );

    expect(mapped).toEqual([
      { driverId: "kyle-larson", basePoints: 33, finishPosition: 4 },
    ]);
  });
});
