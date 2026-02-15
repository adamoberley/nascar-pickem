interface WeeklyLeaderboardRow {
  rank: number;
  userId: string;
  points: number;
}

interface SprintLeaderboardRow {
  userId: string;
  total: number;
}

interface StandingsRow {
  id: string;
  displayName: string;
  seasonTotal: number;
  rank: number;
}

interface WeeklyPickerOption {
  id: string | null;
  label: string;
}

interface SprintConfig {
  name: string;
  index: number;
  month: number;
  payout: string;
}

interface Props {
  seasonScoresLoading: boolean;
  allWeeklyScoresLoading: boolean;
  selectedRaceIdForWeekly: string | null;
  setSelectedRaceIdForWeekly: (value: string | null) => void;
  weeklyRacePickerOptions: WeeklyPickerOption[];
  weeklyLeaderboardRows: WeeklyLeaderboardRow[];
  isWeeklyExpanded: boolean;
  setIsWeeklyExpanded: (fn: (v: boolean) => boolean) => void;
  selectedSprintIndex: number;
  setSelectedSprintIndex: (value: number) => void;
  SPRINT_CONFIGS: readonly SprintConfig[];
  currentSprintIndex: number;
  sprintLeaderboardRows: SprintLeaderboardRow[];
  isMonthlyExpanded: boolean;
  setIsMonthlyExpanded: (fn: (v: boolean) => boolean) => void;
  mergedStandingsRows: StandingsRow[];
  isSeasonExpanded: boolean;
  setIsSeasonExpanded: (fn: (v: boolean) => boolean) => void;
  memberById: Record<string, { displayName: string }>;
  userId: string | undefined;
}

export function StandingsTab({
  seasonScoresLoading,
  allWeeklyScoresLoading,
  selectedRaceIdForWeekly,
  setSelectedRaceIdForWeekly,
  weeklyRacePickerOptions,
  weeklyLeaderboardRows,
  isWeeklyExpanded,
  setIsWeeklyExpanded,
  selectedSprintIndex,
  setSelectedSprintIndex,
  SPRINT_CONFIGS,
  currentSprintIndex,
  sprintLeaderboardRows,
  isMonthlyExpanded,
  setIsMonthlyExpanded,
  mergedStandingsRows,
  isSeasonExpanded,
  setIsSeasonExpanded,
  memberById,
  userId,
}: Props) {
  return (
    <section className="panel wide standings-panel">
      {(seasonScoresLoading || allWeeklyScoresLoading) && (
        <p className="race-meta">Loading standings…</p>
      )}
      {/* Weekly Leaderboard */}
      <div className="app-card">
        <h2 className="section-title">Weekly Leaderboard</h2>
        <div className="standings-picker-wrap standings-picker-chevron">
          <select
            className="standings-picker-select"
            value={selectedRaceIdForWeekly ?? ""}
            onChange={(e) => setSelectedRaceIdForWeekly(e.target.value || null)}
            aria-label="Select race for weekly leaderboard"
          >
            {weeklyRacePickerOptions.map((opt) => (
              <option key={opt.id ?? opt.label} value={opt.id ?? ""}>
                {opt.label}
              </option>
            ))}
          </select>
          <span className="standings-chevron" aria-hidden>▼</span>
        </div>
        {weeklyLeaderboardRows.length === 0 ? (
          <p className="race-meta">No scores yet for this race.</p>
        ) : (
          <>
            <div className="standings-rows">
              {(isWeeklyExpanded ? weeklyLeaderboardRows : weeklyLeaderboardRows.slice(0, 3)).map((row) => (
                <div
                  key={row.userId}
                  className={`standings-row standings-row--rank-${Math.min(row.rank, 2)} ${row.userId === userId ? "standings-row--you" : ""} ${row.rank === 1 ? "standings-row--leader" : ""}`}
                >
                  <span className="standings-rank">#{row.rank}</span>
                  <span className="standings-name">
                    {memberById[row.userId]?.displayName ?? row.userId}
                  </span>
                  <span className="standings-total">{row.points}</span>
                </div>
              ))}
            </div>
            {weeklyLeaderboardRows.length > 3 ? (
              <button
                type="button"
                className="standings-expand-chevron"
                onClick={() => setIsWeeklyExpanded((v) => !v)}
                aria-expanded={isWeeklyExpanded}
                aria-label={isWeeklyExpanded ? "Show top 3" : "Show full list"}
              >
                {isWeeklyExpanded ? "▲" : "▼"}
              </button>
            ) : null}
          </>
        )}
      </div>

      {/* Monthly Leaderboard */}
      <div className="app-card">
        <h2 className="section-title">Monthly Leaderboard</h2>
        <div className="standings-picker-wrap standings-picker-chevron">
          <select
            className="standings-picker-select"
            value={selectedSprintIndex}
            onChange={(e) => setSelectedSprintIndex(Number(e.target.value))}
            aria-label="Select sprint"
          >
            <option value={0}>
              Current (
              {SPRINT_CONFIGS.find((c) => c.index === currentSprintIndex)?.name ?? "Sprint"}
              )
            </option>
            {SPRINT_CONFIGS.map((c) => (
              <option key={c.index} value={c.index}>
                {c.name} · {c.payout}
              </option>
            ))}
          </select>
          <span className="standings-chevron" aria-hidden>▼</span>
        </div>
        {sprintLeaderboardRows.length === 0 ? (
          <p className="race-meta">No scores yet for this month.</p>
        ) : (
          <>
            <div className="standings-rows">
              {(isMonthlyExpanded ? sprintLeaderboardRows : sprintLeaderboardRows.slice(0, 3)).map((row, i) => (
                <div
                  key={row.userId}
                  className={`standings-row standings-row--rank-${Math.min(i + 1, 2)} ${row.userId === userId ? "standings-row--you" : ""} ${i === 0 ? "standings-row--leader" : ""}`}
                >
                  <span className="standings-rank">#{i + 1}</span>
                  <span className="standings-name">
                    {memberById[row.userId]?.displayName ?? row.userId}
                  </span>
                  <span className="standings-total">{row.total}</span>
                </div>
              ))}
            </div>
            {sprintLeaderboardRows.length > 3 ? (
              <button
                type="button"
                className="standings-expand-chevron"
                onClick={() => setIsMonthlyExpanded((v) => !v)}
                aria-expanded={isMonthlyExpanded}
                aria-label={isMonthlyExpanded ? "Show top 3" : "Show full list"}
              >
                {isMonthlyExpanded ? "▲" : "▼"}
              </button>
            ) : null}
          </>
        )}
      </div>

      {/* Season Leaderboard */}
      <div className="app-card">
        <h2 className="section-title">Season Leaderboard</h2>
        <p className="standings-section-subtitle">1st $1,000 · 2nd $250 · 3rd $100</p>
        <div className="standings-rows">
          {(isSeasonExpanded ? mergedStandingsRows : mergedStandingsRows.slice(0, 3)).map((row) => (
            <div
              key={row.id}
              className={`standings-row ${row.id === userId ? "standings-row--you" : ""} standings-row--rank-${Math.min(row.rank, 2)}`}
            >
              <span className="standings-rank">#{row.rank}</span>
              <span className="standings-name">{row.displayName}</span>
              <span className="standings-total">{row.seasonTotal}</span>
            </div>
          ))}
        </div>
        {mergedStandingsRows.length > 3 ? (
          <button
            type="button"
            className="standings-expand-chevron"
            onClick={() => setIsSeasonExpanded((v) => !v)}
            aria-expanded={isSeasonExpanded}
            aria-label={isSeasonExpanded ? "Show top 3" : "Show full list"}
          >
            {isSeasonExpanded ? "▲" : "▼"}
          </button>
        ) : null}
      </div>
    </section>
  );
}
