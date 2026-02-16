import { describe, expect, it } from "vitest";
import {
  buildDriverPointsByDriverId,
  mapOfficialResultsToDriverPoints,
  normalizeOfficialRaceResults,
  normalizeRacePointDrivers,
} from "./race-points";

describe("normalizeRacePointDrivers", () => {
  it("accepts legacy points field for race drivers", () => {
    const rows = normalizeRacePointDrivers({
      drivers: [
        { driverId: "tyler-reddick", points: 58, running_position: 2 },
      ],
    } as any);

    expect(rows).toEqual([
      {
        driverId: "tyler-reddick",
        basePoints: 58,
        runningPosition: 2,
      },
    ]);
  });

  it("accepts map-shaped drivers with numeric strings", () => {
    const rows = normalizeRacePointDrivers({
      drivers: {
        "ross-chastain": "19",
        "tyler-reddick": { points: "58", finish_position: "1" },
      },
    } as any);

    expect(rows).toEqual([
      {
        driverId: "ross-chastain",
        basePoints: 19,
      },
      {
        driverId: "tyler-reddick",
        basePoints: 58,
        finishPosition: 1,
      },
    ]);
  });
});

describe("normalizeOfficialRaceResults", () => {
  it("accepts legacy results field", () => {
    const rows = normalizeOfficialRaceResults({
      results: [
        {
          position: 1,
          driver: "Ross Chastain",
          car: "1",
          points: 40,
        },
      ],
    } as any);

    expect(rows).toEqual([
      {
        finishPosition: 1,
        driverName: "Ross Chastain",
        vehicleNumber: "1",
        points: 40,
      },
    ]);
  });

  it("accepts map-shaped results with numeric strings", () => {
    const rows = normalizeOfficialRaceResults({
      results: {
        "Ross Chastain": { position: "2", car: 1, points: "19" },
      },
    } as any);

    expect(rows).toEqual([
      {
        finishPosition: 2,
        driverName: "Ross Chastain",
        vehicleNumber: "1",
        points: 19,
      },
    ]);
  });
});

describe("mapOfficialResultsToDriverPoints", () => {
  it("maps official rows by car number and driver name", () => {
    const pointsByDriverId = mapOfficialResultsToDriverPoints(
      [
        {
          finishPosition: 1,
          driverName: "Ross Chastain",
          vehicleNumber: "1",
          points: 19,
        },
        {
          finishPosition: 2,
          driverName: "Tyler Reddick",
          vehicleNumber: "45",
          points: 58,
        },
      ],
      {
        "ross-chastain": { name: "Ross Chastain", number: "1", team: "Trackhouse" },
        "tyler-reddick": { name: "Tyler Reddick", number: "45", team: "23XI" },
      },
    );

    expect(pointsByDriverId).toEqual({
      "ross-chastain": 19,
      "tyler-reddick": 58,
    });
  });
});

describe("buildDriverPointsByDriverId", () => {
  it("resolves driver keys using number and provider key aliases", () => {
    const map = buildDriverPointsByDriverId(
      [
        { driverId: "45", basePoints: 58 },
        { driverId: "Ross_Chastain", basePoints: 19 },
      ],
      {
        "tyler-reddick": {
          name: "Tyler Reddick",
          number: "45",
          team: "23XI",
          providerDriverKey: "tyler-reddick",
        } as any,
        "ross-chastain": {
          name: "Ross Chastain",
          number: "1",
          team: "Trackhouse",
          providerDriverKey: "ross-chastain",
        } as any,
      },
    );

    expect(map).toEqual({
      "tyler-reddick": 58,
      "ross-chastain": 19,
    });
  });
});
