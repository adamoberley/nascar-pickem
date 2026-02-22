import { useEffect, useMemo, useState } from "react";
import type {
  DriverDoc,
  MemberDoc,
  PickDoc,
  RaceDoc,
  RacePointsDoc,
  UserNotificationDoc,
  WeeklyScoreDoc,
} from "../lib/types";
import { PicksTierSummary } from "../components/PicksTierSummary";
import { RaceCard } from "../components/RaceCard";
import { syncLiveRaceNow } from "../lib/api";
import { buildPickTierLookups, getPickTierForDriverId } from "../lib/pick-tiers";

const LIVE_REFRESH_COOLDOWN_MS = 60 * 1000;

interface PickState {
  loading: boolean;
  data: PickDoc | null;
}

interface LiveRacePicksState {
  loading: boolean;
  data: Array<PickDoc & { id: string }>;
}

interface LiveRaceLeaderboardRow {
  userId: string;
  displayName: string;
  pick: (PickDoc & { id: string }) | null;
  weeklyTotal: number;
}

interface Props {
  selectedLeagueId: string | null;
  userId: string | null;
  /** Race we show for picks (live race while in progress, otherwise next upcoming). */
  primaryRace: (RaceDoc & { id: string }) | null;
  upcomingRace: (RaceDoc & { id: string }) | null;
  liveRace: (RaceDoc & { id: string }) | null;
  liveRacePoints: RacePointsDoc | null;
  liveWeeklyScores: WeeklyScoreDoc[];
  liveRacePicksState: LiveRacePicksState;
  canSeeAllLiveRacePicks: boolean;
  /** When race is live, driverId -> current running position. */
  driverPositionByDriverId: Record<string, number>;
  /** For locked/completed race picks: driverId -> points to show instead of checkmarks. */
  driverPointsByDriverId: Record<string, number>;
  pickState: PickState;
  driversById: Record<string, DriverDoc>;
  memberById: Record<string, MemberDoc>;
  onOpenPicks: () => void;
  notifications: Array<UserNotificationDoc & { id: string }>;
  onMarkNotificationRead: (notificationId: string) => void;
}

export function HomeTab({
  selectedLeagueId,
  userId,
  primaryRace,
  upcomingRace,
  liveRace,
  liveRacePoints,
  liveWeeklyScores,
  liveRacePicksState,
  canSeeAllLiveRacePicks,
  driverPositionByDriverId,
  driverPointsByDriverId,
  pickState,
  driversById,
  memberById,
  onOpenPicks,
  notifications,
  onMarkNotificationRead,
}: Props) {
  const [expandedLiveLeaderboardUserId, setExpandedLiveLeaderboardUserId] = useState<string | null>(
    null,
  );
  const [liveRefreshBusy, setLiveRefreshBusy] = useState(false);
  const [liveRefreshUpdated, setLiveRefreshUpdated] = useState(false);
  const [liveRefreshError, setLiveRefreshError] = useState<string | null>(null);
  const [liveRefreshCooldownUntilMs, setLiveRefreshCooldownUntilMs] = useState(0);
  const [cooldownNowMs, setCooldownNowMs] = useState(() => Date.now());

  useEffect(() => {
    setExpandedLiveLeaderboardUserId(userId);
    setLiveRefreshBusy(false);
    setLiveRefreshUpdated(false);
    setLiveRefreshError(null);
    setLiveRefreshCooldownUntilMs(0);
    setCooldownNowMs(Date.now());
  }, [liveRace?.id, userId]);
  useEffect(() => {
    if (liveRefreshCooldownUntilMs <= Date.now()) {
      setCooldownNowMs(Date.now());
      return;
    }
    const intervalId = window.setInterval(() => {
      setCooldownNowMs(Date.now());
    }, 1000);
    return () => window.clearInterval(intervalId);
  }, [liveRefreshCooldownUntilMs]);

  const liveRefreshSecondsRemaining = Math.max(
    0,
    Math.ceil((liveRefreshCooldownUntilMs - cooldownNowMs) / 1000),
  );
  const liveRefreshDisabled = liveRefreshBusy || liveRefreshSecondsRemaining > 0 || !selectedLeagueId;
  const liveRefreshButtonLabel = liveRefreshBusy
    ? "REFRESHING"
    : liveRefreshSecondsRemaining > 0 && liveRefreshUpdated
      ? "UPDATED"
      : "REFRESH";

  const liveProgressText = useMemo(() => {
    if (liveRacePoints?.liveLapNumber == null || liveRacePoints?.liveLapsInRace == null) {
      return null;
    }
    const inferredStage = (() => {
      const stage = liveRacePoints.liveStage;
      if (!stage) return null;
      if (liveRacePoints.liveLapNumber <= stage.finishAtLap) {
        return {
          stageNum: stage.stageNum,
          finishAtLap: stage.finishAtLap,
        };
      }

      const nextStageNum = Math.min(stage.stageNum + 1, 3);
      const nextFinishAtLap =
        nextStageNum === 3 ? liveRacePoints.liveLapsInRace : stage.finishAtLap;
      return {
        stageNum: nextStageNum,
        finishAtLap: nextFinishAtLap,
      };
    })();

    return `Lap ${liveRacePoints.liveLapNumber}/${liveRacePoints.liveLapsInRace}${
      inferredStage
        ? ` · Stage ${inferredStage.stageNum} (ends lap ${inferredStage.finishAtLap})`
        : ""
    }`;
  }, [
    liveRacePoints?.liveLapNumber,
    liveRacePoints?.liveLapsInRace,
    liveRacePoints?.liveStage,
  ]);

  const handleRefreshLiveData = async () => {
    if (!selectedLeagueId || liveRefreshBusy || liveRefreshSecondsRemaining > 0) return;
    setLiveRefreshBusy(true);
    setLiveRefreshError(null);
    setLiveRefreshUpdated(false);
    try {
      const result = await syncLiveRaceNow({ leagueId: selectedLeagueId });
      const cooldownSeconds =
        typeof result.retryAfterSeconds === "number" && result.retryAfterSeconds > 0
          ? result.retryAfterSeconds
          : Math.ceil(LIVE_REFRESH_COOLDOWN_MS / 1000);
      setLiveRefreshCooldownUntilMs(Date.now() + cooldownSeconds * 1000);
      setLiveRefreshUpdated(result.updated);
    } catch (error) {
      setLiveRefreshError((error as Error).message);
    } finally {
      setLiveRefreshBusy(false);
    }
  };

  const allDriverPointRows = useMemo(
    () => {
      const rows =
        Object.keys(driverPointsByDriverId).length > 0
          ? Object.entries(driverPointsByDriverId).map(([driverId, points]) => ({
              driverId,
              points,
              position: driverPositionByDriverId[driverId] ?? null,
            }))
          : (liveRacePoints?.drivers ?? []).map((entry) => ({
              driverId: entry.driverId,
              points: entry.basePoints,
              position:
                entry.runningPosition ??
                entry.finishPosition ??
                driverPositionByDriverId[entry.driverId] ??
                null,
            }));

      return rows.sort((a, b) => {
        const aPosition = a.position ?? Number.MAX_SAFE_INTEGER;
        const bPosition = b.position ?? Number.MAX_SAFE_INTEGER;
        if (aPosition !== bPosition) return aPosition - bPosition;
        if (b.points !== a.points) return b.points - a.points;
        const aName = driversById[a.driverId]?.name ?? a.driverId;
        const bName = driversById[b.driverId]?.name ?? b.driverId;
        return aName.localeCompare(bName);
      });
    },
    [driverPointsByDriverId, driverPositionByDriverId, driversById, liveRacePoints?.drivers],
  );
  const showDriverPositions = useMemo(
    () => allDriverPointRows.some((entry) => entry.position != null),
    [allDriverPointRows],
  );
  const pickTierLookups = useMemo(
    () => buildPickTierLookups(pickState.data, driversById),
    [driversById, pickState.data],
  );
  const liveRaceLeaderboardRows = useMemo((): LiveRaceLeaderboardRow[] => {
    const pickByUserId = new Map(
      liveRacePicksState.data.map((pick) => [pick.userId, pick] as const),
    );
    const scoreByUserId = new Map(
      liveWeeklyScores.map((score) => [score.userId, score] as const),
    );

    const userIds = new Set<string>();
    if (canSeeAllLiveRacePicks) {
      Object.keys(memberById).forEach((userId) => userIds.add(userId));
    }
    pickByUserId.forEach((_, userId) => userIds.add(userId));
    scoreByUserId.forEach((_, userId) => userIds.add(userId));

    const rows: LiveRaceLeaderboardRow[] = Array.from(userIds).map((userId) => {
      const pick = pickByUserId.get(userId) ?? null;
      const score = scoreByUserId.get(userId);
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
      };
    });

    return [...rows].sort((a, b) => {
      const hasPickDelta = Number(Boolean(b.pick)) - Number(Boolean(a.pick));
      if (hasPickDelta !== 0) return hasPickDelta;
      if (b.weeklyTotal !== a.weeklyTotal) return b.weeklyTotal - a.weeklyTotal;
      return a.displayName.localeCompare(b.displayName);
    });
  }, [
    canSeeAllLiveRacePicks,
    driverPointsByDriverId,
    liveRacePicksState.data,
    liveWeeklyScores,
    memberById,
  ]);

  const remindersCard =
    notifications.length > 0 ? (
      <div className="app-card">
        <h2 className="section-title">Reminders</h2>
        <div className="live-standings-rows">
          {notifications.slice(0, 3).map((notification) => (
            <div key={notification.id} className="live-standings-row">
              <div className="live-standings-row-header">
                <span className="live-standings-name">
                  {notification.title || "Pick reminder"}
                </span>
              </div>
              <div className="live-standings-breakdown">
                <p className="race-meta">{notification.message}</p>
                {notification.lockTime ? (
                  <p className="race-meta">
                    Locks{" "}
                    {new Intl.DateTimeFormat("en-US", {
                      dateStyle: "medium",
                      timeStyle: "short",
                    }).format(new Date(notification.lockTime.toMillis()))}
                  </p>
                ) : null}
                {!notification.readAt ? (
                  <button
                    type="button"
                    className="secondary-button"
                    onClick={() => onMarkNotificationRead(notification.id)}
                  >
                    Mark read
                  </button>
                ) : null}
              </div>
            </div>
          ))}
        </div>
      </div>
    ) : null;

  const yourPicksCard = primaryRace ? (
    <button
      type="button"
      className="app-card your-picks-card"
      onClick={onOpenPicks}
    >
      <div className="your-picks-head">
        <h2 className="section-title">Your Picks</h2>
        <span className="chevron" aria-hidden>›</span>
      </div>
      {pickState.loading ? (
        <p className="your-picks-loading" aria-busy="true">
          <span className="your-picks-spinner" aria-hidden />
          Loading your picks…
        </p>
      ) : pickState.data &&
        (pickState.data.tierA?.length > 0 ||
          pickState.data.tierB?.length > 0 ||
          pickState.data.tierC?.length > 0) ? (
        <div className="your-picks-tiers">
          {pickState.data.tierA?.length ? (
            <PicksTierSummary
              title="Tier A"
              limit={3}
              driverIds={pickState.data.tierA}
              driversById={driversById}
              tierColor="yellow"
              driverPositionByDriverId={driverPositionByDriverId}
              driverPointsByDriverId={driverPointsByDriverId}
            />
          ) : null}
          {pickState.data.tierB?.length ? (
            <PicksTierSummary
              title="Tier B"
              limit={2}
              driverIds={pickState.data.tierB}
              driversById={driversById}
              tierColor="red"
              driverPositionByDriverId={driverPositionByDriverId}
              driverPointsByDriverId={driverPointsByDriverId}
            />
          ) : null}
          {pickState.data.tierC?.length ? (
            <PicksTierSummary
              title="Tier C"
              limit={1}
              driverIds={pickState.data.tierC}
              driversById={driversById}
              tierColor="blue"
              driverPositionByDriverId={driverPositionByDriverId}
              driverPointsByDriverId={driverPointsByDriverId}
            />
          ) : null}
        </div>
      ) : (
        <p className="your-picks-empty">
          <span className="icon" aria-hidden>☑</span>
          {liveRace ? "No picks for this race." : "No picks selected — tap to make your picks"}
        </p>
      )}
    </button>
  ) : null;

  return (
    <section className="panel home-panel">
      {liveRace ? (
        <>
          <div className="app-card race-card race-card--live">
            <h2 className="race-name">{liveRace.name}</h2>
            <div className="live-race-track-row">
              <p className="race-meta live-race-track">{liveRace.track}</p>
              <span className="live-badge" aria-hidden>LIVE</span>
            </div>
            {liveProgressText ? (
              <p className="race-meta live-race-progress">{liveProgressText}</p>
            ) : null}
            <div className="live-link-refresh-row">
              <a
                href={`https://www.nascar.com/live-results/nascar-cup-series/${liveRace.id}/`}
                target="_blank"
                rel="noopener noreferrer"
                className="live-leaderboard-link"
              >
                Live leaderboard on NASCAR.com
              </a>
              <button
                type="button"
                className="live-badge live-refresh-button"
                onClick={() => void handleRefreshLiveData()}
                disabled={liveRefreshDisabled}
                aria-label="Refresh live race data"
                title="Refresh live race data"
              >
                {liveRefreshButtonLabel}
              </button>
            </div>
            {liveRefreshError ? (
              <p className="error-text live-refresh-feedback">{liveRefreshError}</p>
            ) : null}
          </div>

          {allDriverPointRows.length ? (
            <div className="app-card live-driver-points-card">
              <h2 className="section-title">Live results</h2>
              <ul className="live-driver-points-list">
                {allDriverPointRows.map((entry) => {
                  const tierColor = getPickTierForDriverId(entry.driverId, pickTierLookups);
                  return (
                    <li
                      key={entry.driverId}
                      className={`live-driver-points-row${
                        tierColor ? ` live-driver-points-row--${tierColor}` : ""
                      }`}
                    >
                      <span className="live-driver-points-main">
                        {showDriverPositions ? (
                          <span
                            className="live-driver-points-pos"
                            aria-label={
                              entry.position != null
                                ? `Position ${entry.position}`
                                : "Position unavailable"
                            }
                          >
                            {entry.position != null ? entry.position : "—"}
                          </span>
                        ) : null}
                        <span className="live-driver-points-name">
                          {driversById[entry.driverId]?.name ?? entry.driverId}
                        </span>
                      </span>
                      <span className="live-driver-points-pts">{entry.points}</span>
                    </li>
                  );
                })}
              </ul>
            </div>
          ) : null}

          <div className="app-card">
            <h2 className="section-title">Live Leaderboard</h2>
            {!canSeeAllLiveRacePicks ? (
              <p className="race-meta">All picks become visible when the race starts.</p>
            ) : liveRacePicksState.loading ? (
              <p className="race-meta" aria-busy="true">Loading race picks…</p>
            ) : liveRaceLeaderboardRows.length === 0 ? (
              <p className="race-meta">No picks submitted for this race yet.</p>
            ) : (
              <div className="race-leaderboard-rows">
                {liveRaceLeaderboardRows.map((row, index) => {
                  const isExpanded = expandedLiveLeaderboardUserId === row.userId;
                  return (
                    <div key={row.userId} className="race-leaderboard-row">
                      <button
                        type="button"
                        className="race-leaderboard-trigger"
                        onClick={() =>
                          setExpandedLiveLeaderboardUserId(isExpanded ? null : row.userId)
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
                                driverPointsByDriverId={driverPointsByDriverId}
                              />
                              <PicksTierSummary
                                title="Tier B"
                                limit={2}
                                driverIds={row.pick.tierB}
                                driversById={driversById}
                                tierColor="red"
                                driverPointsByDriverId={driverPointsByDriverId}
                              />
                              <PicksTierSummary
                                title="Tier C"
                                limit={1}
                                driverIds={row.pick.tierC}
                                driversById={driversById}
                                tierColor="blue"
                                driverPointsByDriverId={driverPointsByDriverId}
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

          {yourPicksCard}

          {remindersCard}
        </>
      ) : null}

      {!liveRace && primaryRace ? (
        <>
          {remindersCard}
          <RaceCard
            name={primaryRace.name}
            track={primaryRace.track}
            startTime={primaryRace.startTime}
            lockTime={primaryRace.lockTime}
            tvChannel={primaryRace.tvChannel}
          />
          {allDriverPointRows.length ? (
            <div className="app-card live-driver-points-card">
              <h2 className="section-title">Driver points</h2>
              <ul className="live-driver-points-list">
                {allDriverPointRows.map((entry) => {
                  const tierColor = getPickTierForDriverId(entry.driverId, pickTierLookups);
                  return (
                    <li
                      key={entry.driverId}
                      className={`live-driver-points-row${
                        tierColor ? ` live-driver-points-row--${tierColor}` : ""
                      }`}
                    >
                      <span className="live-driver-points-main">
                        {showDriverPositions ? (
                          <span
                            className="live-driver-points-pos"
                            aria-label={
                              entry.position != null
                                ? `Position ${entry.position}`
                                : "Position unavailable"
                            }
                          >
                            {entry.position != null ? entry.position : "—"}
                          </span>
                        ) : null}
                        <span className="live-driver-points-name">
                          {driversById[entry.driverId]?.name ?? entry.driverId}
                        </span>
                      </span>
                      <span className="live-driver-points-pts">{entry.points}</span>
                    </li>
                  );
                })}
              </ul>
            </div>
          ) : null}
          {yourPicksCard}
        </>
      ) : null}

      {!liveRace && !primaryRace ? (
        <>
          {remindersCard}
          <div className="app-card">
            <p>No upcoming race loaded.</p>
          </div>
        </>
      ) : null}
    </section>
  );
}
