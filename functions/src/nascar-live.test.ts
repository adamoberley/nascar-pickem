import { describe, expect, it } from "vitest";
import {
  resolveNascarRaceIdForLeagueRace,
  runNameMatchesRace,
} from "./nascar-live";

describe("runNameMatchesRace", () => {
  it("matches equivalent race names with different casing/sponsor text", () => {
    expect(runNameMatchesRace("DAYTONA 500", "Daytona 500")).toBe(true);
    expect(
      runNameMatchesRace(
        "Pennzoil 400 presented by Jiffy Lube",
        "Pennzoil 400",
      ),
    ).toBe(true);
  });

  it("does not match unrelated race names", () => {
    expect(runNameMatchesRace("Daytona 500", "Coca-Cola 600")).toBe(false);
  });
});

describe("resolveNascarRaceIdForLeagueRace", () => {
  it("prefers same-date race when available", () => {
    const raceId = resolveNascarRaceIdForLeagueRace({
      leagueRaceId: "2026-sample-race",
      leagueRaceName: "Sample 400",
      leagueRaceStartTimeMs: Date.parse("2026-03-01T19:30:00.000Z"),
      raceList: [
        {
          race_id: 101,
          race_name: "Other 500",
          race_date: "2026-02-22",
          race_type_id: 1,
          series_id: 1,
        },
        {
          race_id: 202,
          race_name: "Sample 400 presented by Sponsor",
          race_date: "2026-03-01",
          race_type_id: 1,
          series_id: 1,
        },
      ],
    });

    expect(raceId).toBe(202);
  });
});
