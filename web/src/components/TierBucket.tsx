import type { DriverDoc } from "../lib/types";

interface Props {
  title: string;
  limit: number;
  driverIds: string[];
  selected: string[];
  disabled: boolean;
  driversById: Record<string, DriverDoc>;
  onToggle: (driverId: string, limit: number) => void;
  /** Tier color for row styling (matches iOS) */
  tierColor?: "yellow" | "red" | "blue";
  /** When race is live, driverId -> current running position. */
  driverPositionByDriverId?: Record<string, number>;
  /** When race is locked/completed, driverId -> points for this race. */
  driverPointsByDriverId?: Record<string, number>;
}

export function TierBucket({
  title,
  limit,
  driverIds,
  selected,
  disabled,
  driversById,
  onToggle,
  tierColor = "blue",
  driverPositionByDriverId,
  driverPointsByDriverId,
}: Props) {
  return (
    <section className={`tier-card tier-card--${tierColor}`}>
      <header className="tier-card-header">
        <span className="section-title-small">{title}</span>
        <span className="tier-card-count">{selected.length}/{limit}</span>
      </header>
      <div className="tier-driver-rows">
        {driverIds.map((driverId) => {
          const driver = driversById[driverId];
          const active = selected.includes(driverId);
          const position = driverPositionByDriverId?.[driverId];
          const showPositionPrefix = active && position != null;
          const hasPoints =
            driverPointsByDriverId != null &&
            Object.prototype.hasOwnProperty.call(driverPointsByDriverId, driverId);
          const points = hasPoints ? driverPointsByDriverId?.[driverId] : undefined;
          const showMutedPoints = !active && points != null;
          return (
            <button
              key={driverId}
              type="button"
              className={`tier-driver-row ${active ? "tier-driver-row--selected" : ""}`}
              disabled={disabled}
              onClick={() => onToggle(driverId, limit)}
            >
              <span className="tier-driver-line">
                {showPositionPrefix ? (
                  <span className="tier-driver-position-inline" aria-label={`Position ${position}`}>
                    #{position}
                  </span>
                ) : (
                  <>#{driver?.number ?? "--"} </>
                )}
                {driver?.name ?? driverId}
                {driver?.team ? <span className="tier-driver-team">{driver.team}</span> : null}
              </span>
              {active ? (
                points != null ? (
                  <span className="tier-driver-points" aria-label={`${points} points`}>{points}</span>
                ) : (
                  <span className="tier-driver-check" aria-hidden>✓</span>
                )
              ) : showMutedPoints ? (
                <span
                  className="tier-driver-points tier-driver-points--muted"
                  aria-label={`${points} points`}
                >
                  {points}
                </span>
              ) : null}
            </button>
          );
        })}
      </div>
    </section>
  );
}
