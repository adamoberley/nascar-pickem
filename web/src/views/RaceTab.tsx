import type { DriverDoc, RaceDoc, WeeklyScoreDoc } from "../lib/types";
import { CountdownChip } from "../components/CountdownChip";

interface Props {
  races: (RaceDoc & { id: string })[];
  selectedRace: (RaceDoc & { id: string }) | null;
  selectedRaceId: string | null;
  setSelectedRaceId: (value: string | null) => void;
  selectedRaceScoreState: { data: WeeklyScoreDoc | null };
  selectedRacePickState: { data: { tierA: string[]; tierB: string[]; tierC: string[] } | null };
  driversById: Record<string, DriverDoc>;
  selectedRacePointsState: { data: { drivers?: Array<{ driverId: string; basePoints: number }> } | null };
  selectedRaceAdjustmentsState: { data: Array<{ driverId: string; deltaPoints: number }> };
}

export function RaceTab({
  races,
  selectedRace,
  selectedRaceId,
  setSelectedRaceId,
  selectedRaceScoreState,
  selectedRacePickState,
  driversById,
  selectedRacePointsState,
  selectedRaceAdjustmentsState,
}: Props) {
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
              {selectedRaceScoreState.data ? (
                <span className="race-total">
                  <span className="race-total-label">Total</span>
                  <span className="race-total-value">{selectedRaceScoreState.data.weeklyTotal}</span>
                </span>
              ) : null}
            </div>
            {selectedRaceScoreState.data ? (
              <div className="race-breakdown-rows">
                {selectedRaceScoreState.data.breakdown.map((item) => {
                  const pick = selectedRacePickState.data;
                  const tierColor = !pick
                    ? "blue"
                    : pick.tierA.includes(item.driverId)
                      ? "yellow"
                      : pick.tierB.includes(item.driverId)
                        ? "red"
                        : "blue";
                  const driver = driversById[item.driverId];
                  return (
                    <div
                      key={item.driverId}
                      className={`race-breakdown-row race-breakdown-row--${tierColor}`}
                    >
                      <div className="race-breakdown-left">
                        <span className="driver-line">
                          #{driver?.number ?? "--"} {driver?.name ?? item.driverId}
                        </span>
                        <span className="race-breakdown-meta">
                          Base {item.basePoints}, Adj {item.totalAdjustments}
                        </span>
                      </div>
                      <div className="race-breakdown-right">
                        <span className="race-breakdown-pts">{item.finalPointsApplied}</span>
                        {item.adjusted ? (
                          <span className="adjusted-tag">Adjusted</span>
                        ) : null}
                      </div>
                    </div>
                  );
                })}
              </div>
            ) : selectedRace.status === "scheduled" && selectedRace.lockTime.toMillis() > Date.now() ? (
              <p className="race-meta">You can make your picks the week of the race.</p>
            ) : selectedRace.status === "locked" || selectedRace.status === "completed" ? (
              <p className="race-meta">Picks are locked for this race. Points will update as official results are in.</p>
            ) : (
              <p className="race-meta">No score for this race yet.</p>
            )}
          </div>

          <div className="app-card">
            <h2 className="section-title">Results</h2>
            {selectedRacePointsState.data?.drivers?.length ? (
              <ul className="race-results-list">
                {[...(selectedRacePointsState.data.drivers ?? [])]
                  .sort((a, b) => b.basePoints - a.basePoints)
                  .map((entry) => {
                    const points = entry.basePoints + selectedRaceAdjustmentsState.data
                      .filter((adj) => adj.driverId === entry.driverId)
                      .reduce((sum, adj) => sum + adj.deltaPoints, 0);
                    return (
                      <li key={entry.driverId} className="race-result-item">
                        <div>
                          <span className="race-result-name">
                            {driversById[entry.driverId]?.name ?? entry.driverId}
                          </span>
                          <span className="race-result-team">
                            {driversById[entry.driverId]?.team ?? ""}
                          </span>
                        </div>
                        <span className="race-result-pts">{points}</span>
                      </li>
                    );
                  })}
              </ul>
            ) : (
              <p className="race-meta">No official points loaded yet.</p>
            )}
          </div>
        </>
      ) : null}
    </section>
  );
}
