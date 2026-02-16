import type {
  DriverDoc,
  MemberDoc,
  PickDoc,
  RaceDoc,
  RacePointsDoc,
  WeeklyScoreDoc,
} from "../lib/types";
import { PicksTierSummary } from "../components/PicksTierSummary";
import { RaceCard } from "../components/RaceCard";

interface PickState {
  loading: boolean;
  data: PickDoc | null;
}

interface Props {
  /** Race we show for picks (live race while in progress, otherwise next upcoming). */
  primaryRace: (RaceDoc & { id: string }) | null;
  upcomingRace: (RaceDoc & { id: string }) | null;
  liveRace: (RaceDoc & { id: string }) | null;
  liveRacePoints: RacePointsDoc | null;
  liveWeeklyScores: WeeklyScoreDoc[];
  /** When race is live, driverId -> current running position (for showing P1, P2, etc.). */
  driverPositionByDriverId: Record<string, number>;
  /** For locked/completed race picks: driverId -> points to show instead of checkmarks. */
  driverPointsByDriverId: Record<string, number>;
  pickState: PickState;
  driversById: Record<string, DriverDoc>;
  memberById: Record<string, MemberDoc>;
  onOpenPicks: () => void;
}

export function HomeTab({
  primaryRace,
  upcomingRace,
  liveRace,
  liveRacePoints,
  liveWeeklyScores,
  driverPositionByDriverId,
  driverPointsByDriverId,
  pickState,
  driversById,
  memberById,
  onOpenPicks,
}: Props) {
  const allDriverPointRows = (
    Object.keys(driverPointsByDriverId).length > 0
      ? Object.entries(driverPointsByDriverId).map(([driverId, points]) => ({
          driverId,
          points,
        }))
      : (liveRacePoints?.drivers ?? []).map((entry) => ({
          driverId: entry.driverId,
          points: entry.basePoints,
        }))
  ).sort((a, b) => {
    if (b.points !== a.points) return b.points - a.points;
    const aName = driversById[a.driverId]?.name ?? a.driverId;
    const bName = driversById[b.driverId]?.name ?? b.driverId;
    return aName.localeCompare(bName);
  });

  return (
    <section className="panel home-panel">
      {liveRace ? (
        <>
          <div className="app-card race-card race-card--live">
            <span className="live-badge" aria-hidden>LIVE</span>
            <h2 className="race-name">{liveRace.name}</h2>
            <p className="race-meta">{liveRace.track}</p>
            {liveRacePoints?.liveLapNumber != null && liveRacePoints?.liveLapsInRace != null ? (
              <p className="race-meta live-race-progress">
                Lap {liveRacePoints.liveLapNumber}/{liveRacePoints.liveLapsInRace}
                {liveRacePoints.liveStage ? (
                  <> · Stage {liveRacePoints.liveStage.stageNum} (ends lap {liveRacePoints.liveStage.finishAtLap})</>
                ) : null}
              </p>
            ) : null}
            <a
              href={`https://www.nascar.com/live-results/nascar-cup-series/${liveRace.id}/`}
              target="_blank"
              rel="noopener noreferrer"
              className="live-leaderboard-link"
            >
              View live leaderboard &amp; stage results on NASCAR.com
            </a>
          </div>

          {allDriverPointRows.length ? (
            <div className="app-card live-driver-points-card">
              <h2 className="section-title">Live driver points</h2>
              <ul className="live-driver-points-list">
                {allDriverPointRows.map((entry) => (
                  <li key={entry.driverId} className="live-driver-points-row">
                    <span className="live-driver-points-name">
                      {driversById[entry.driverId]?.name ?? entry.driverId}
                    </span>
                    <span className="live-driver-points-pts">{entry.points}</span>
                  </li>
                ))}
              </ul>
            </div>
          ) : null}

          <div className="app-card live-standings-card">
            <h2 className="section-title">Live race standings</h2>
            {liveWeeklyScores.length === 0 ? (
              <p className="race-meta">No scores yet. Points will update as official results come in.</p>
            ) : (
              <div className="live-standings-rows">
                {liveWeeklyScores.map((score, index) => (
                  <div
                    key={score.userId}
                    className="live-standings-row"
                  >
                    <div className="live-standings-row-header">
                      <span className="live-standings-rank">#{index + 1}</span>
                      <span className="live-standings-name">
                        {memberById[score.userId]?.displayName ?? score.userId}
                      </span>
                      <span className="live-standings-total">{score.weeklyTotal}</span>
                    </div>
                    <div className="live-standings-breakdown">
                      {[...score.breakdown]
                        .sort((a, b) => b.finalPointsApplied - a.finalPointsApplied)
                        .map((item) => (
                          <div key={item.driverId} className="live-standings-breakdown-item">
                            <span className="live-standings-driver-name">
                              {driversById[item.driverId]?.name ?? item.driverId}
                            </span>
                            <span className="live-standings-driver-pts">{item.finalPointsApplied}</span>
                          </div>
                        ))}
                    </div>
                  </div>
                ))}
              </div>
            )}
          </div>
        </>
      ) : null}

      {primaryRace ? (
        <>
          {!liveRace ? (
            <RaceCard
              name={primaryRace.name}
              track={primaryRace.track}
              startTime={primaryRace.startTime}
              lockTime={primaryRace.lockTime}
              tvChannel={primaryRace.tvChannel}
            />
          ) : null}

          {!liveRace && allDriverPointRows.length ? (
            <div className="app-card live-driver-points-card">
              <h2 className="section-title">Driver points</h2>
              <ul className="live-driver-points-list">
                {allDriverPointRows.map((entry) => (
                  <li key={entry.driverId} className="live-driver-points-row">
                    <span className="live-driver-points-name">
                      {driversById[entry.driverId]?.name ?? entry.driverId}
                    </span>
                    <span className="live-driver-points-pts">{entry.points}</span>
                  </li>
                ))}
              </ul>
            </div>
          ) : null}

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
            ) : pickState.data && (pickState.data.tierA?.length > 0 || pickState.data.tierB?.length > 0 || pickState.data.tierC?.length > 0) ? (
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
        </>
      ) : !liveRace ? (
        <div className="app-card">
          <p>No upcoming race loaded.</p>
        </div>
      ) : null}
    </section>
  );
}
