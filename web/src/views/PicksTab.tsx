import type { DriverDoc, RaceDoc, TierDoc } from "../lib/types";
import { RaceCard } from "../components/RaceCard";
import { TierBucket } from "../components/TierBucket";

interface Props {
  /** Race we show for picks (live race while in progress, otherwise next upcoming). */
  primaryRace: (RaceDoc & { id: string }) | null;
  upcomingRace: (RaceDoc & { id: string }) | null;
  tierState: { loading: boolean; error?: string };
  tiersFromStandingsSnapshot: TierDoc | null;
  latestStandingsState: { loading: boolean };
  effectiveTiers: TierDoc | null;
  draftPick: { tierA: string[]; tierB: string[]; tierC: string[] };
  togglePick: (tier: "tierA" | "tierB" | "tierC", driverId: string, limit: number) => void;
  isPickLocked: boolean;
  pickError: string | null;
  pickSaving: boolean;
  pickStatus: string;
  savePickSubmit: () => void;
  driversById: Record<string, DriverDoc>;
  /** When race is live, driverId -> current running position (show P1, P2, etc. on selected picks). */
  driverPositionByDriverId: Record<string, number>;
}

export function PicksTab({
  primaryRace,
  upcomingRace,
  tierState,
  tiersFromStandingsSnapshot,
  latestStandingsState,
  effectiveTiers,
  draftPick,
  togglePick,
  isPickLocked,
  pickError,
  pickSaving,
  pickStatus,
  savePickSubmit,
  driversById,
  driverPositionByDriverId,
}: Props) {
  if (!primaryRace) {
    return (
      <section className="panel picks-panel">
        <div className="app-card">
          <p>No scheduled race available.</p>
        </div>
      </section>
    );
  }

  return (
    <section className="panel picks-panel">
      <RaceCard
        name={primaryRace.name}
        track={primaryRace.track}
        startTime={primaryRace.startTime}
        lockTime={primaryRace.lockTime}
        tvChannel={primaryRace.tvChannel}
      />

      {(tierState.loading && !tiersFromStandingsSnapshot) ||
      (latestStandingsState.loading && !effectiveTiers) ? (
        <div className="app-card">
          <p className="race-meta">Loading tiers…</p>
        </div>
      ) : tierState.error ? (
        <div className="app-card status-card status-card--error">
          <p className="race-meta">Tiers: {tierState.error}</p>
        </div>
      ) : effectiveTiers ? (
        <>
          <TierBucket
            title="Tier A"
            limit={3}
            driverIds={[
              ...effectiveTiers.tierA,
              ...draftPick.tierA.filter((id) => !effectiveTiers.tierA.includes(id)),
            ]}
            selected={draftPick.tierA}
            disabled={isPickLocked}
            driversById={driversById}
            onToggle={(driverId, limit) => togglePick("tierA", driverId, limit)}
            tierColor="yellow"
            driverPositionByDriverId={driverPositionByDriverId}
          />
          <TierBucket
            title="Tier B"
            limit={2}
            driverIds={[
              ...effectiveTiers.tierB,
              ...draftPick.tierB.filter((id) => !effectiveTiers.tierB.includes(id)),
            ]}
            selected={draftPick.tierB}
            disabled={isPickLocked}
            driversById={driversById}
            onToggle={(driverId, limit) => togglePick("tierB", driverId, limit)}
            tierColor="red"
            driverPositionByDriverId={driverPositionByDriverId}
          />
          <TierBucket
            title="Tier C"
            limit={1}
            driverIds={[
              ...effectiveTiers.tierC,
              ...draftPick.tierC.filter((id) => !effectiveTiers.tierC.includes(id)),
            ]}
            selected={draftPick.tierC}
            disabled={isPickLocked}
            driversById={driversById}
            onToggle={(driverId, limit) => togglePick("tierC", driverId, limit)}
            tierColor="blue"
            driverPositionByDriverId={driverPositionByDriverId}
          />
        </>
      ) : (
        <div className="app-card">
          <p className="race-meta">Tiers are not available yet. Run &quot;Refresh data&quot; in Admin to load schedule and standings.</p>
        </div>
      )}

      {pickError ? (
        <div className="app-card status-card status-card--error">
          <p>{pickError}</p>
        </div>
      ) : null}
      {pickSaving ? (
        <div className="app-card status-card">
          <p className="race-meta">Saving…</p>
        </div>
      ) : pickStatus ? (
        <div className="app-card status-card status-card--success">
          <p>{pickStatus}</p>
        </div>
      ) : null}

      {effectiveTiers && isPickLocked ? (
        <div className="app-card status-card status-card--locked">
          <p className="race-meta">Picks are locked for this race. You can no longer edit them.</p>
        </div>
      ) : effectiveTiers ? (
        <div className="tier-card picks-save-card">
          <button
            type="button"
            className="picks-save-button"
            disabled={pickSaving}
            onClick={() => void savePickSubmit()}
          >
            {pickSaving ? "Saving…" : "Save picks"}
          </button>
        </div>
      ) : null}
    </section>
  );
}
