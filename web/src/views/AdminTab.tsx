import type { DriverDoc, MemberDoc, PickDoc, RaceDoc } from "../lib/types";
import {
  addAdjustment,
  manualRefreshData,
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
  setMonitorRaceId: (v: string | null) => void;
  raceMonitorPicksState: { data: PickDoc[] };
  membersState: { data: MemberWithId[] };
  expandedPickUserId: string | null;
  setExpandedPickUserId: (v: string | null) => void;
  driversById: Record<string, DriverDoc>;
  driverPositionByDriverId: Record<string, number>;
  driverPointsByDriverId: Record<string, number>;
  races: (RaceDoc & { id: string })[];
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
  setMonitorRaceId,
  raceMonitorPicksState,
  membersState,
  expandedPickUserId,
  setExpandedPickUserId,
  driversById,
  driverPositionByDriverId,
  driverPointsByDriverId,
  races,
  driversState,
  adjustmentDraft,
  setAdjustmentDraft,
  adminMessage,
  adminError,
}: Props) {
  const monitorRace = monitorRaceId
    ? (races.find((race) => race.id === monitorRaceId) ?? null)
    : null;

  return (
    <section className="panel wide">
      <h2>Admin Dashboard</h2>

      <article className="callout">
        <details className="admin-callout-dropdown">
          <summary className="admin-callout-summary">
            <h4>League Settings</h4>
          </summary>
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
        </details>
      </article>

      <article className="callout">
        <h4>
          Pick Monitoring{" "}
          <span className="admin-heading-meta">
            ({monitorRace ? monitorRace.name : "No race"})
          </span>
        </h4>
        <label>
          <span className="label-text">Race</span>
          <select
            value={monitorRaceId ?? ""}
            onChange={(event) => {
              setExpandedPickUserId(null);
              setMonitorRaceId(event.target.value || null);
            }}
          >
            <option value="">— Select race —</option>
            {races.map((race) => (
              <option key={race.id} value={race.id}>
                {race.name} · {race.track}
              </option>
            ))}
          </select>
        </label>
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
                            driverPositionByDriverId={driverPositionByDriverId}
                            driverPointsByDriverId={driverPointsByDriverId}
                          />
                          <PicksTierSummary
                            title="Tier B"
                            limit={2}
                            driverIds={pick.tierB}
                            driversById={driversById}
                            tierColor="red"
                            driverPositionByDriverId={driverPositionByDriverId}
                            driverPointsByDriverId={driverPointsByDriverId}
                          />
                          <PicksTierSummary
                            title="Tier C"
                            limit={1}
                            driverIds={pick.tierC}
                            driversById={driversById}
                            tierColor="blue"
                            driverPositionByDriverId={driverPositionByDriverId}
                            driverPointsByDriverId={driverPointsByDriverId}
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
              void (async () => {
                await manualRefreshData({ leagueId: selectedLeagueId });
                try {
                  const live = await syncLiveRaceNow({ leagueId: selectedLeagueId });
                  if (live.updated) {
                    setAdminMessage("Data refresh complete. Live points updated from NASCAR.com.");
                    return;
                  }
                  setAdminMessage(
                    live.reason
                      ? `Data refresh complete. ${live.reason}`
                      : "Data refresh complete. No live race in progress or feed unavailable.",
                  );
                } catch {
                  setAdminMessage("Data refresh complete. Live sync unavailable.");
                }
              })()
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
                .then((live) => {
                  if (live.updated) {
                    setAdminMessage("Live points updated from NASCAR.com.");
                    return;
                  }
                  setAdminMessage(
                    live.reason
                      ? live.reason
                      : "No live race in progress or feed unavailable.",
                  );
                })
                .catch((error) => setAdminError((error as Error).message))
                .finally(() => setAdminBusy(false));
            }}
          >
            Sync Live Race
          </button>
        </div>

        <details className="admin-callout-dropdown">
          <summary className="admin-callout-summary">
            <h5>Add Penalty / Correction</h5>
          </summary>
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
        </details>
      </article>

      <article className="callout">
        <details className="admin-callout-dropdown">
          <summary className="admin-callout-summary">
            <h4>Members</h4>
          </summary>
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
                          setAdminBusy(true);
                          setAdminError(null);
                          setAdminMessage("");
                          void setMemberPaidStatus(
                            selectedLeagueId,
                            member.id,
                            nextPaidStatus,
                          )
                            .then(() => setAdminMessage(`Marked ${member.displayName} as ${nextPaidStatus}.`))
                            .catch((error) => setAdminError((error as Error).message))
                            .finally(() => setAdminBusy(false));
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
        </details>
      </article>

      {adminMessage ? <p className="success-text">{adminMessage}</p> : null}
      {adminError ? <p className="error-text">{adminError}</p> : null}
    </section>
  );
}
