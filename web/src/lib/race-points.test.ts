import { describe, expect, it } from "vitest";
import {
  buildDriverPointsByDriverId,
  mapOfficialResultsToDriverPoints,
  normalizeOfficialRaceResults,
  normalizeRacePointDrivers,
} from "./race-points";

describe("normalizeRacePointDrivers", () => {
  it("normalizes strict racePoints.drivers rows", () => {
    const rows = normalizeRacePointDrivers({
      drivers: [
        { driverId: "tyler-reddick", basePoints: 58, runningPosition: 2 },
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

  it("ignores malformed driver rows", () => {
    const rows = normalizeRacePointDrivers({
      drivers: [{ driverId: "ross-chastain" }, { basePoints: 19 }],
    } as any);

    expect(rows).toEqual([]);
  });

  it("accepts legacy race-point keys", () => {
    const rows = normalizeRacePointDrivers({
      drivers: [
        {
          driver_id: "45",
          points: 58,
          running_position: 2,
          finish_position: 3,
        },
      ],
    } as any);

    expect(rows).toEqual([
      {
        driverId: "45",
        basePoints: 58,
        runningPosition: 2,
        finishPosition: 3,
      },
    ]);
  });

  it("accepts legacy drivers object maps", () => {
    const rows = normalizeRacePointDrivers({
      drivers: {
        "ross-chastain": 19,
        "tyler-reddick": "58",
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
      },
    ]);
  });
});

describe("normalizeOfficialRaceResults", () => {
  it("normalizes strict officialResults rows", () => {
    const rows = normalizeOfficialRaceResults({
      officialResults: [
        {
          finishPosition: 1,
          driverName: "Ross Chastain",
          vehicleNumber: "1",
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

  it("ignores malformed official rows", () => {
    const rows = normalizeOfficialRaceResults({
      officialResults: [{ finishPosition: 2, driverName: "Ross Chastain" }],
    } as any);

    expect(rows).toEqual([]);
  });

  it("reads legacy official_results rows", () => {
    const rows = normalizeOfficialRaceResults({
      official_results: [
        {
          finishing_position: 1,
          driver_name: "Ross Chastain",
          official_car_number: "1",
          points: "40",
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
  it("resolves driver keys using direct ids and car numbers", () => {
    const map = buildDriverPointsByDriverId(
      [
        { driverId: "45", basePoints: 58 },
        { driverId: "ross-chastain", basePoints: 19 },
      ],
      {
        "tyler-reddick": {
          name: "Tyler Reddick",
          number: "45",
          team: "23XI",
        } as any,
        "ross-chastain": {
          name: "Ross Chastain",
          number: "1",
          team: "Trackhouse",
        } as any,
      },
    );

    expect(map).toEqual({
      "tyler-reddick": 58,
      "ross-chastain": 19,
    });
  });
});
