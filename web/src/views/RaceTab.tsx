import { useEffect, useMemo, useState } from "react";
import type {
  DriverDoc,
  MemberDoc,
  PickDoc,
  RaceDoc,
  RacePointsDoc,
  TierDoc,
  WeeklyScoreDoc,
} from "../lib/types";
import { CountdownChip } from "../components/CountdownChip";
import { PicksTierSummary } from "../components/PicksTierSummary";
import {
  buildDriverPointsByDriverId,
  mapOfficialResultsToDriverPoints,
  normalizeOfficialRaceResults,
  normalizeRacePointDrivers,
} from "../lib/race-points";

interface Props {
  races: (RaceDoc & { id: string })[];
  selectedRace: (RaceDoc & { id: string }) | null;
  selectedRaceId: string | null;
  setSelectedRaceId: (value: string | null) => void;
  selectedRaceTiers: TierDoc | null;
  selectedRaceScoreState: { data: WeeklyScoreDoc | null; loading: boolean };
  selectedRacePickState: {
    data: { tierA: string[]; tierB: string[]; tierC: string[] } | null;
    loading: boolean;
  };
  driversById: Record<string, DriverDoc>;
  selectedRacePointsState: { data: RacePointsDoc | null; loading: boolean };
  selectedRaceAdjustmentsState: { data: Array<{ driverId: string; deltaPoints: number }> };
  selectedRacePicksState: {
    data: Array<PickDoc & { id: string }>;
    loading: boolean;
  };
  selectedRaceWeeklyScores: Array<WeeklyScoreDoc & { id: string }>;
  memberById: Record<string, MemberDoc>;
  canSeeAllPicks: boolean;
}

interface RaceLeaderboardRow {
  userId: string;
  displayName: string;
  pick: (PickDoc & { id: string }) | null;
  weeklyTotal: number;
  driverPointsByDriverId: Record<string, number>;
}

interface RaceResultRow {
  key: string;
  finishPosition: number | null;
  name: string;
  points: number;
}

function RaceLoadingState({
  label,
  rows,
}: {
  label: string;
  rows: number;
}) {
  const widthClasses = ["w100", "w92", "w88", "w96", "w84", "w90", "w86", "w94"];
  return (
    <div className="race-loading-state" aria-live="polite" aria-busy="true">
      <p className="race-loading-label">
        <span className="race-loading-spinner" aria-hidden />
        {label}…
      </p>
      <div className="race-loading-rows">
        {Array.from({ length: rows }).map((_, index) => (
          <div
            // eslint-disable-next-line react/no-array-index-key
            key={`${label}-${index}`}
            className={`race-loading-row race-loading-row--${widthClasses[index % widthClasses.length]}`}
            aria-hidden
          />
        ))}
      </div>
    </div>
  );
}

export function RaceTab({
  races,
  selectedRace,
  selectedRaceId,
  setSelectedRaceId,
  selectedRaceTiers,
  selectedRaceScoreState,
  selectedRacePickState,
  driversById,
  selectedRacePointsState,
  selectedRaceAdjustmentsState,
  selectedRacePicksState,
  selectedRaceWeeklyScores,
  memberById,
  canSeeAllPicks,
}: Props) {
  const [expandedLeaderboardUserId, setExpandedLeaderboardUserId] = useState<string | null>(null);
  useEffect(() => {
    setExpandedLeaderboardUserId(null);
  }, [selectedRaceId]);

  const isRaceDataLoading =
    selectedRacePickState.loading ||
    selectedRaceScoreState.loading ||
    selectedRacePointsState.loading;
  const adjustmentByDriverId = useMemo(() => {
    const map = new Map<string, number>();
    for (const adjustment of selectedRaceAdjustmentsState.data) {
      map.set(
        adjustment.driverId,
        (map.get(adjustment.driverId) ?? 0) + adjustment.deltaPoints,
      );
    }
    return map;
  }, [selectedRaceAdjustmentsState.data]);
  const normalizedRacePointDrivers = useMemo(
    () => normalizeRacePointDrivers(selectedRacePointsState.data),
    [selectedRacePointsState.data],
  );
  const normalizedOfficialResults = useMemo(
    () => normalizeOfficialRaceResults(selectedRacePointsState.data),
    [selectedRacePointsState.data],
  );
  const officialResultPointsByDriverId = useMemo(
    () => mapOfficialResultsToDriverPoints(normalizedOfficialResults, driversById),
    [normalizedOfficialResults, driversById],
  );
  const raceDriverPointsByDriverId = useMemo(() => {
    const rawMap = buildDriverPointsByDriverId(normalizedRacePointDrivers, driversById);
    const map: Record<string, number> = {};
    for (const [driverId, basePoints] of Object.entries(rawMap)) {
      map[driverId] = basePoints + (adjustmentByDriverId.get(driverId) ?? 0);
    }
    for (const [driverId, points] of Object.entries(officialResultPointsByDriverId)) {
      if (map[driverId] == null) {
        map[driverId] = points + (adjustmentByDriverId.get(driverId) ?? 0);
      }
    }
    return map;
  }, [
    adjustmentByDriverId,
    driversById,
    normalizedRacePointDrivers,
    officialResultPointsByDriverId,
  ]);
  const selectedRacePickTotal = useMemo(() => {
    if (selectedRacePickState.loading || selectedRacePointsState.loading) return null;
    const pick = selectedRacePickState.data;
    if (!pick) return null;
    return [...pick.tierA, ...pick.tierB, ...pick.tierC].reduce(
      (sum, driverId) => sum + (raceDriverPointsByDriverId[driverId] ?? 0),
      0,
    );
  }, [
    raceDriverPointsByDriverId,
    selectedRacePickState.data,
    selectedRacePickState.loading,
    selectedRacePointsState.loading,
  ]);
  const selectedRaceIsFuture =
    Boolean(selectedRace) &&
    selectedRace?.status === "scheduled" &&
    selectedRace.lockTime.toMillis() > Date.now();
  const selectedRaceHasScoringData =
    Boolean(selectedRaceScoreState.data) ||
    normalizedOfficialResults.length > 0 ||
    normalizedRacePointDrivers.length > 0;
  const selectedRaceDisplayTotal =
    isRaceDataLoading || (selectedRaceIsFuture && !selectedRaceHasScoringData)
      ? null
      : selectedRaceScoreState.data?.weeklyTotal ?? selectedRacePickTotal;
  const selectedRaceHasPick =
    !selectedRacePickState.loading &&
    Boolean(selectedRacePickState.data) &&
    (selectedRacePickState.data?.tierA.length ?? 0) +
      (selectedRacePickState.data?.tierB.length ?? 0) +
      (selectedRacePickState.data?.tierC.length ?? 0) >
      0;
  const raceLeaderboardRows = useMemo((): RaceLeaderboardRow[] => {
    const pickByUserId = new Map(
      selectedRacePicksState.data.map((pick) => [pick.userId, pick] as const),
    );
    const scoreByUserId = new Map(
      selectedRaceWeeklyScores.map((score) => [score.userId, score] as const),
    );

    const userIds = new Set<string>();
    if (canSeeAllPicks) {
      Object.keys(memberById).forEach((userId) => userIds.add(userId));
    }
    pickByUserId.forEach((_, userId) => userIds.add(userId));
    scoreByUserId.forEach((_, userId) => userIds.add(userId));

    const rows: RaceLeaderboardRow[] = Array.from(userIds).map((userId) => {
      const pick = pickByUserId.get(userId) ?? null;
      const score = scoreByUserId.get(userId);
      const driverPointsByDriverId = raceDriverPointsByDriverId;
      const weeklyTotal =
        score?.weeklyTotal ??
        (pick
          ? [...pick.tierA, ...pick.tierB, ...pick.tierC].reduce(
              (sum, driverId) => sum + (driverPointsByDriverId[driverId] ?? 0),
              0,
            )
          : 0);
      return {
        userId,
        displayName: memberById[userId]?.displayName ?? userId,
        pick,
        weeklyTotal,
        driverPointsByDriverId,
      };
    });

    const sorted = [...rows].sort((a, b) => {
      const hasPickDelta = Number(Boolean(b.pick)) - Number(Boolean(a.pick));
      if (hasPickDelta !== 0) return hasPickDelta;
      if (b.weeklyTotal !== a.weeklyTotal) return b.weeklyTotal - a.weeklyTotal;
      return a.displayName.localeCompare(b.displayName);
    });
    return sorted;
  }, [
    canSeeAllPicks,
    memberById,
    raceDriverPointsByDriverId,
    selectedRacePicksState.data,
    selectedRaceWeeklyScores,
  ]);
  const raceResultRows = useMemo((): RaceResultRow[] => {
    const officialRows = normalizedOfficialResults;
    if (officialRows.length > 0) {
      return [...officialRows]
        .filter((row) => Number.isFinite(row.points))
        .sort((a, b) => {
          const aFinish = a.finishPosition ?? Number.MAX_SAFE_INTEGER;
          const bFinish = b.finishPosition ?? Number.MAX_SAFE_INTEGER;
          if (aFinish !== bFinish) return aFinish - bFinish;
          if (b.points !== a.points) return b.points - a.points;
          return a.driverName.localeCompare(b.driverName);
        })
        .map((row) => ({
          key:
            row.vehicleNumber != null
              ? `car-${row.vehicleNumber}`
              : `official-${row.finishPosition}-${row.driverName}`,
          finishPosition: row.finishPosition,
          name: row.driverName || row.vehicleNumber || "Unknown Driver",
          points: row.points,
        }));
    }

    if (normalizedRacePointDrivers.length === 0) {
      return [];
    }

    return normalizedRacePointDrivers
      .map((entry) => ({
        key: entry.driverId,
        finishPosition: entry.finishPosition ?? entry.runningPosition ?? null,
        name: driversById[entry.driverId]?.name ?? entry.driverId,
        points: entry.basePoints,
      }))
      .sort((a, b) => {
        const aFinish = a.finishPosition ?? Number.MAX_SAFE_INTEGER;
        const bFinish = b.finishPosition ?? Number.MAX_SAFE_INTEGER;
        if (aFinish !== bFinish) return aFinish - bFinish;
        if (b.points !== a.points) return b.points - a.points;
        return a.name.localeCompare(b.name);
      });
  }, [
    normalizedOfficialResults,
    normalizedRacePointDrivers,
    driversById,
  ]);
  const maxPossibleRacePoints = useMemo(() => {
    const bestTierTotal = (driverIds: string[], pickCount: number): number | null => {
      const sortedTierPoints = driverIds
        .map((driverId) => raceDriverPointsByDriverId[driverId])
        .filter((points): points is number => typeof points === "number")
        .sort((a, b) => b - a);
      if (sortedTierPoints.length < pickCount) return null;
      return sortedTierPoints.slice(0, pickCount).reduce((sum, points) => sum + points, 0);
    };

    if (selectedRaceTiers) {
      const tierATotal = bestTierTotal(selectedRaceTiers.tierA, 3);
      const tierBTotal = bestTierTotal(selectedRaceTiers.tierB, 2);
      const tierCTotal = bestTierTotal(selectedRaceTiers.tierC, 1);
      if (tierATotal != null && tierBTotal != null && tierCTotal != null) {
        return tierATotal + tierBTotal + tierCTotal;
      }
    }

    // Fallback when tier data is missing: best 6 overall race points.
    const topSixOverall = Object.values(raceDriverPointsByDriverId)
      .sort((a, b) => b - a)
      .slice(0, 6);
    if (topSixOverall.length < 6) return null;
    return topSixOverall.reduce((sum, points) => sum + points, 0);
  }, [raceDriverPointsByDriverId, selectedRaceTiers]);

  return (
    <section className="panel wide race-panel">
      <div className="app-card race-selector-card">
        <div className="race-selector-inner">
          <div>
            {selectedRace ? (
              <>
                <h3 className="race-name">{selectedRace.name}</h3>
                <p className="race-meta">{selectedRace.track}</p>
                <p className="race-meta">
                  {new Intl.DateTimeFormat("en-US", { dateStyle: "medium" }).format(new Date(selectedRace.startTime.toMillis()))}
                  {" – "}
                  {new Intl.DateTimeFormat("en-US", { timeStyle: "short" }).format(new Date(selectedRace.startTime.toMillis()))}
                  {selectedRace.tvChannel ? ` · ${selectedRace.tvChannel}` : ""}
                </p>
                <div className="countdown-wrap">
                  <CountdownChip lockTime={selectedRace.lockTime} />
                </div>
              </>
            ) : (
              <p className="race-meta">Select a race</p>
            )}
          </div>
          <span className="chevron" aria-hidden>›</span>
        </div>
        <select
          className="race-select-native"
          value={selectedRaceId ?? ""}
          onChange={(e) => setSelectedRaceId(e.target.value || null)}
          aria-label="Select race"
        >
          <option value="">Select a race</option>
          {races.map((race) => (
            <option key={race.id} value={race.id}>
              {race.name} · {race.track}
            </option>
          ))}
        </select>
      </div>

      {selectedRaceId && selectedRace ? (
        <>
          <div className="app-card">
            <div className="race-your-picks-head">
              <h2 className="section-title">Your Picks</h2>
              {isRaceDataLoading ? (
                <span className="race-total race-total--loading" aria-hidden>
                  <span className="race-loading-pill" />
                </span>
              ) : selectedRaceDisplayTotal != null ? (
                <span className="race-total">
                  <span className="race-total-label">Total</span>
                  <span className="race-total-value">{selectedRaceDisplayTotal}</span>
                </span>
              ) : null}
            </div>
            {selectedRacePickState.loading ? (
              <RaceLoadingState label="Loading your pick" rows={3} />
            ) : selectedRaceHasPick && selectedRacePickState.data ? (
              <div className="your-picks-tiers">
                <PicksTierSummary
                  title="Tier A"
                  limit={3}
                  driverIds={selectedRacePickState.data.tierA}
                  driversById={driversById}
                  tierColor="yellow"
                  driverPointsByDriverId={raceDriverPointsByDriverId}
                />
                <PicksTierSummary
                  title="Tier B"
                  limit={2}
                  driverIds={selectedRacePickState.data.tierB}
                  driversById={driversById}
                  tierColor="red"
                  driverPointsByDriverId={raceDriverPointsByDriverId}
                />
                <PicksTierSummary
                  title="Tier C"
                  limit={1}
                  driverIds={selectedRacePickState.data.tierC}
                  driversById={driversById}
                  tierColor="blue"
                  driverPointsByDriverId={raceDriverPointsByDriverId}
                />
              </div>
            ) : selectedRace.status === "scheduled" && selectedRace.lockTime.toMillis() > Date.now() ? (
              <p className="race-meta">You can make your picks the week of the race.</p>
            ) : selectedRace.status === "locked" || selectedRace.status === "completed" ? (
              <p className="race-meta">No pick submitted for this race.</p>
            ) : (
              <p className="race-meta">No score for this race yet.</p>
            )}
          </div>

          <div className="app-card">
            <div className="race-your-picks-head">
              <h2 className="section-title">Race Leaderboard</h2>
              {maxPossibleRacePoints != null ? (
                <span className="race-total">
                  <span className="race-total-label">Max</span>
                  <span className="race-total-value">{maxPossibleRacePoints}</span>
                </span>
              ) : null}
            </div>
            {!canSeeAllPicks ? (
              <p className="race-meta">All picks become visible when the race starts.</p>
            ) : selectedRacePicksState.loading ? (
              <RaceLoadingState label="Loading race picks" rows={4} />
            ) : raceLeaderboardRows.length === 0 ? (
              <p className="race-meta">No picks submitted for this race yet.</p>
            ) : (
              <div className="race-leaderboard-rows">
                {raceLeaderboardRows.map((row, index) => {
                  const isExpanded = expandedLeaderboardUserId === row.userId;
                  return (
                    <div key={row.userId} className="race-leaderboard-row">
                      <button
                        type="button"
                        className="race-leaderboard-trigger"
                        onClick={() =>
                          setExpandedLeaderboardUserId(isExpanded ? null : row.userId)
                        }
                        aria-expanded={isExpanded}
                      >
                        <span className="race-leaderboard-rank">#{index + 1}</span>
                        <span className="race-leaderboard-name">{row.displayName}</span>
                        <span className="race-leaderboard-total">{row.weeklyTotal}</span>
                        <span className="race-leaderboard-chevron" aria-hidden>
                          {isExpanded ? "▼" : "▶"}
                        </span>
                      </button>

                      {isExpanded ? (
                        <div
                          className={`race-leaderboard-dropdown ${
                            row.pick ? "" : "race-leaderboard-dropdown--empty"
                          }`}
                        >
                          {row.pick ? (
                            <div className="your-picks-tiers">
                              <PicksTierSummary
                                title="Tier A"
                                limit={3}
                                driverIds={row.pick.tierA}
                                driversById={driversById}
                                tierColor="yellow"
                                driverPointsByDriverId={row.driverPointsByDriverId}
                              />
                              <PicksTierSummary
                                title="Tier B"
                                limit={2}
                                driverIds={row.pick.tierB}
                                driversById={driversById}
                                tierColor="red"
                                driverPointsByDriverId={row.driverPointsByDriverId}
                              />
                              <PicksTierSummary
                                title="Tier C"
                                limit={1}
                                driverIds={row.pick.tierC}
                                driversById={driversById}
                                tierColor="blue"
                                driverPointsByDriverId={row.driverPointsByDriverId}
                              />
                            </div>
                          ) : (
                            <p className="race-meta">No pick submitted for this race.</p>
                          )}
                        </div>
                      ) : null}
                    </div>
                  );
                })}
              </div>
            )}
          </div>

          <div className="app-card">
            <h2 className="section-title">Results</h2>
            {selectedRacePointsState.loading ? (
              <RaceLoadingState label="Loading results" rows={6} />
            ) : raceResultRows.length ? (
              <>
                <div className="race-results-headings" aria-hidden>
                  <span className="race-result-finish">Finish</span>
                  <span className="race-result-name">Name</span>
                  <span className="race-result-pts">Points</span>
                </div>
                <ul className="race-results-list">
                  {raceResultRows.map((entry) => (
                    <li key={entry.key} className="race-result-item">
                      <span className="race-result-finish">
                        {entry.finishPosition != null ? entry.finishPosition : "—"}
                      </span>
                      <span className="race-result-name">{entry.name}</span>
                      <span className="race-result-pts">{entry.points}</span>
                    </li>
                  ))}
                </ul>
              </>
            ) : (
              <p className="race-meta">No official points loaded yet.</p>
            )}
          </div>
        </>
      ) : null}
    </section>
  );
}
