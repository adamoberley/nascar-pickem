import type { DriverDoc, MemberDoc, PickDoc, RaceDoc } from "../lib/types";
import {
  addAdjustment,
  manualRefreshData,
  manualUpsertRacePoints,
  setLeagueSettings,
  setMemberPaidStatus,
  syncLiveRaceNow,
} from "../lib/api";
import { PicksTierSummary } from "../components/PicksTierSummary";

interface MemberWithId extends MemberDoc {
  id: string;
}

interface Props {
  selectedLeagueId: string | null;
  settingsDraft: { name: string; seasonYear: number; payoutConfigText: string };
  setSettingsDraft: React.Dispatch<React.SetStateAction<{ name: string; seasonYear: number; payoutConfigText: string }>>;
  adminBusy: boolean;
  setAdminBusy: (v: boolean) => void;
  setAdminError: (v: string | null) => void;
  setAdminMessage: (v: string) => void;
  monitorRaceId: string | null;
  raceMonitorPicksState: { data: PickDoc[] };
  membersState: { data: MemberWithId[] };
  expandedPickUserId: string | null;
  setExpandedPickUserId: (v: string | null) => void;
  driversById: Record<string, DriverDoc>;
  races: (RaceDoc & { id: string })[];
  manualResultsRaceId: string;
  setManualResultsRaceId: (v: string) => void;
  manualResultsSource: string;
  setManualResultsSource: (v: string) => void;
  manualResultsRows: Array<{ driverId: string; basePoints: number }>;
  setManualResultsRows: React.Dispatch<React.SetStateAction<Array<{ driverId: string; basePoints: number }>>>;
  driversState: { data: Array<DriverDoc & { id: string }> };
  adjustmentDraft: {
    raceId: string;
    driverId: string;
    type: "penalty" | "correction";
    deltaPoints: number;
    reason: string;
    source: string;
  };
  setAdjustmentDraft: React.Dispatch<React.SetStateAction<{
    raceId: string;
    driverId: string;
    type: "penalty" | "correction";
    deltaPoints: number;
    reason: string;
    source: string;
  }>>;
  adminMessage: string;
  adminError: string | null;
}

export function AdminTab({
  selectedLeagueId,
  settingsDraft,
  setSettingsDraft,
  adminBusy,
  setAdminBusy,
  setAdminError,
  setAdminMessage,
  monitorRaceId,
  raceMonitorPicksState,
  membersState,
  expandedPickUserId,
  setExpandedPickUserId,
  driversById,
  races,
  manualResultsRaceId,
  setManualResultsRaceId,
  manualResultsSource,
  setManualResultsSource,
  manualResultsRows,
  setManualResultsRows,
  driversState,
  adjustmentDraft,
  setAdjustmentDraft,
  adminMessage,
  adminError,
}: Props) {
  return (
    <section className="panel wide">
      <h2>Admin Dashboard</h2>

      <article className="callout">
        <h4>League Settings</h4>
        <form
          className="stack-form"
          onSubmit={(event) => {
            event.preventDefault();
            if (!selectedLeagueId) return;

            setAdminBusy(true);
            setAdminError(null);
            setAdminMessage("");

            void setLeagueSettings(selectedLeagueId, settingsDraft)
              .then(() => setAdminMessage("League settings saved."))
              .catch((error) => setAdminError((error as Error).message))
              .finally(() => setAdminBusy(false));
          }}
        >
          <label htmlFor="admin-league-name">League Name</label>
          <input
            id="admin-league-name"
            value={settingsDraft.name}
            onChange={(event) =>
              setSettingsDraft((current) => ({ ...current, name: event.target.value }))
            }
            placeholder="League Name"
            required
          />
          <label htmlFor="admin-season-year">Season Year</label>
          <input
            id="admin-season-year"
            type="number"
            value={settingsDraft.seasonYear}
            onChange={(event) =>
              setSettingsDraft((current) => ({
                ...current,
                seasonYear: Number(event.target.value),
              }))
            }
            required
          />
          <label htmlFor="admin-payout-config">Payout Notes (Optional)</label>
          <textarea
            id="admin-payout-config"
            rows={4}
            value={settingsDraft.payoutConfigText}
            onChange={(event) =>
              setSettingsDraft((current) => ({
                ...current,
                payoutConfigText: event.target.value,
              }))
            }
            placeholder="1st: $1,000 · 2nd: $250"
          />
          <button type="submit" disabled={adminBusy}>
            Save Settings
          </button>
        </form>
      </article>

      <article className="callout">
        <h4>Pick Monitoring <span className="admin-heading-meta">({monitorRaceId ?? "No race"})</span></h4>
        <p>
          Submitted {raceMonitorPicksState.data.length}/{membersState.data.length} picks
        </p>
        <div className="pick-monitoring-groups">
          <div className="pick-monitoring-group">
            <h5 className="pick-monitoring-label submitted">Submitted</h5>
            <ul className="results-list pick-monitoring-names">
              {membersState.data
                .filter((m) => raceMonitorPicksState.data.some((pick) => pick.userId === m.id))
                .map((member) => {
                  const pick = raceMonitorPicksState.data.find((p) => p.userId === member.id);
                  const isExpanded = expandedPickUserId === member.id;
                  return (
                    <li key={member.id} className="pick-monitoring-name-item">
                      <button
                        type="button"
                        className="pick-monitoring-name-trigger"
                        onClick={() =>
                          setExpandedPickUserId(isExpanded ? null : member.id)
                        }
                        aria-expanded={isExpanded}
                      >
                        {member.displayName}
                        <span className="pick-monitoring-chevron" aria-hidden>
                          {isExpanded ? "▼" : "▶"}
                        </span>
                      </button>
                      {isExpanded && pick ? (
                        <div className="pick-monitoring-picks-dropdown">
                          <PicksTierSummary
                            title="Tier A"
                            limit={3}
                            driverIds={pick.tierA}
                            driversById={driversById}
                            tierColor="yellow"
                          />
                          <PicksTierSummary
                            title="Tier B"
                            limit={2}
                            driverIds={pick.tierB}
                            driversById={driversById}
                            tierColor="red"
                          />
                          <PicksTierSummary
                            title="Tier C"
                            limit={1}
                            driverIds={pick.tierC}
                            driversById={driversById}
                            tierColor="blue"
                          />
                        </div>
                      ) : null}
                    </li>
                  );
                })}
            </ul>
          </div>
          <div className="pick-monitoring-group">
            <h5 className="pick-monitoring-label missing">Missing</h5>
            <ul className="results-list">
              {membersState.data
                .filter((m) => !raceMonitorPicksState.data.some((pick) => pick.userId === m.id))
                .map((member) => (
                  <li key={member.id}>{member.displayName}</li>
                ))}
            </ul>
          </div>
        </div>
      </article>

      <article className="callout">
        <h4>Data Operations</h4>
        <div className="button-row">
          <button
            type="button"
            disabled={adminBusy || !selectedLeagueId}
            onClick={() => {
              if (!selectedLeagueId) return;
              setAdminBusy(true);
              setAdminError(null);
              setAdminMessage("");
              void manualRefreshData({ leagueId: selectedLeagueId })
                .then(() => setAdminMessage("Data refresh requested."))
                .catch((error) => setAdminError((error as Error).message))
                .finally(() => setAdminBusy(false));
            }}
          >
            Refresh Data Now
          </button>
          <button
            type="button"
            disabled={adminBusy || !selectedLeagueId}
            onClick={() => {
              if (!selectedLeagueId) return;
              setAdminBusy(true);
              setAdminError(null);
              setAdminMessage("");
              void syncLiveRaceNow({ leagueId: selectedLeagueId })
                .then((r) =>
                  setAdminMessage(
                    r.updated ? "Live points updated from NASCAR.com." : r.reason ?? "No live race in progress or feed unavailable.",
                  ),
                )
                .catch((error) => setAdminError((error as Error).message))
                .finally(() => setAdminBusy(false));
            }}
          >
            Refresh Live (NASCAR.com)
          </button>
        </div>

        <form
          className="stack-form"
          onSubmit={(event) => {
            event.preventDefault();
            if (!selectedLeagueId) return;

            const drivers = manualResultsRows.filter(
              (row) => row.driverId.trim() !== "" && Number.isFinite(row.basePoints),
            );
            if (drivers.length === 0) {
              setAdminError("Add at least one driver with points.");
              return;
            }

            setAdminBusy(true);
            setAdminError(null);
            setAdminMessage("");

            void manualUpsertRacePoints({
              leagueId: selectedLeagueId,
              raceId: manualResultsRaceId,
              source: manualResultsSource,
              drivers,
            })
              .then(() => setAdminMessage("Manual race points saved."))
              .catch((error) => setAdminError((error as Error).message))
              .finally(() => setAdminBusy(false));
          }}
        >
          <h5>Manual Results / Override</h5>
          <p className="form-hint">
            Enter or override finish-order points for a race. Pick the race, then add each
            driver and their base points.
          </p>
          <label>
            <span className="label-text">Race</span>
            <select
              value={manualResultsRaceId}
              onChange={(event) => setManualResultsRaceId(event.target.value)}
              required
            >
              <option value="">— Select race —</option>
              {races.map((race) => (
                <option key={race.id} value={race.id}>
                  {race.name} · {race.track}
                </option>
              ))}
            </select>
          </label>
          <label>
            <span className="label-text">Source (optional)</span>
            <input
              value={manualResultsSource}
              onChange={(event) => setManualResultsSource(event.target.value)}
              placeholder="e.g. admin-manual"
            />
          </label>
          <fieldset className="manual-results-rows">
            <span className="label-text">Driver results</span>
            {manualResultsRows.map((row, index) => (
              <div key={index} className="manual-result-row">
                <select
                  value={row.driverId}
                  onChange={(event) => {
                    setManualResultsRows((prev) => {
                      const next = [...prev];
                      next[index] = { ...next[index], driverId: event.target.value };
                      return next;
                    });
                  }}
                >
                  <option value="">— Select driver —</option>
                  {driversState.data.map((d) => (
                    <option key={d.id} value={d.id}>
                      #{d.number} {d.name}
                    </option>
                  ))}
                </select>
                <input
                  type="number"
                  min={0}
                  value={row.basePoints}
                  onChange={(event) => {
                    setManualResultsRows((prev) => {
                      const next = [...prev];
                      next[index] = {
                        ...next[index],
                        basePoints: Number(event.target.value) || 0,
                      };
                      return next;
                    });
                  }}
                  placeholder="Points"
                  aria-label="Base points"
                />
                <button
                  type="button"
                  className="button-ghost"
                  onClick={() => {
                    setManualResultsRows((prev) =>
                      prev.length > 1 ? prev.filter((_, i) => i !== index) : prev,
                    );
                  }}
                  aria-label="Remove row"
                >
                  Remove
                </button>
              </div>
            ))}
            <button
              type="button"
              className="button-ghost"
              onClick={() =>
                setManualResultsRows((prev) => [...prev, { driverId: "", basePoints: 0 }])
              }
            >
              + Add driver result
            </button>
          </fieldset>
          <button type="submit" disabled={adminBusy}>
            Save Manual Results
          </button>
        </form>

        <form
          className="stack-form"
          onSubmit={(event) => {
            event.preventDefault();
            if (!selectedLeagueId) return;

            setAdminBusy(true);
            setAdminError(null);
            setAdminMessage("");

            void addAdjustment({
              leagueId: selectedLeagueId,
              raceId: adjustmentDraft.raceId,
              driverId: adjustmentDraft.driverId,
              type: adjustmentDraft.type,
              deltaPoints: adjustmentDraft.deltaPoints,
              reason: adjustmentDraft.reason,
              source: adjustmentDraft.source,
            })
              .then(() => setAdminMessage("Adjustment added."))
              .catch((error) => setAdminError((error as Error).message))
              .finally(() => setAdminBusy(false));
          }}
        >
          <h5>Add Penalty / Correction</h5>
          <p className="form-hint">
            Apply a points adjustment to one driver for a specific race (e.g. penalty −10,
            or a correction to fix a scoring error).
          </p>
          <label>
            <span className="label-text">Race</span>
            <select
              value={adjustmentDraft.raceId}
              onChange={(event) =>
                setAdjustmentDraft((current) => ({ ...current, raceId: event.target.value }))
              }
              required
            >
              <option value="">— Select race —</option>
              {races.map((race) => (
                <option key={race.id} value={race.id}>
                  {race.name} · {race.track}
                </option>
              ))}
            </select>
          </label>
          <label>
            <span className="label-text">Driver</span>
            <select
              value={adjustmentDraft.driverId}
              onChange={(event) =>
                setAdjustmentDraft((current) => ({ ...current, driverId: event.target.value }))
              }
              required
            >
              <option value="">— Select driver —</option>
              {driversState.data.map((d) => (
                <option key={d.id} value={d.id}>
                  #{d.number} {d.name}
                </option>
              ))}
            </select>
          </label>
          <label>
            <span className="label-text">Type</span>
            <select
              value={adjustmentDraft.type}
              onChange={(event) =>
                setAdjustmentDraft((current) => ({
                  ...current,
                  type: event.target.value as "penalty" | "correction",
                }))
              }
            >
              <option value="penalty">Penalty</option>
              <option value="correction">Correction</option>
            </select>
          </label>
          <label>
            <span className="label-text">Points change</span>
            <input
              type="number"
              value={adjustmentDraft.deltaPoints}
              onChange={(event) =>
                setAdjustmentDraft((current) => ({
                  ...current,
                  deltaPoints: Number(event.target.value),
                }))
              }
              placeholder="-10"
              title="Negative = deduction, positive = addition"
            />
            <span className="input-hint">Negative = deduction, positive = addition</span>
          </label>
          <label>
            <span className="label-text">Reason</span>
            <input
              value={adjustmentDraft.reason}
              onChange={(event) =>
                setAdjustmentDraft((current) => ({ ...current, reason: event.target.value }))
              }
              placeholder="e.g. Post-race penalty"
              required
            />
          </label>
          <button type="submit" disabled={adminBusy}>
            Add Adjustment
          </button>
        </form>
      </article>

      <article className="callout">
        <h4>Members</h4>
        <div className="table-scroll">
          <table>
            <thead>
              <tr>
                <th>Name</th>
                <th>Role</th>
                <th>Paid</th>
                <th>Action</th>
              </tr>
            </thead>
            <tbody>
              {membersState.data.map((member) => (
                <tr key={member.id}>
                  <td>{member.displayName}</td>
                  <td>{member.role}</td>
                  <td>{member.paidStatus}</td>
                  <td>
                    <button
                      type="button"
                      className="small-button"
                      onClick={() => {
                        if (!selectedLeagueId) return;
                        const nextPaidStatus = member.paidStatus === "paid" ? "unpaid" : "paid";
                        void setMemberPaidStatus(
                          selectedLeagueId,
                          member.id,
                          nextPaidStatus,
                        );
                      }}
                    >
                      Toggle Paid
                    </button>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </article>

      {adminMessage ? <p className="success-text">{adminMessage}</p> : null}
      {adminError ? <p className="error-text">{adminError}</p> : null}
    </section>
  );
}
