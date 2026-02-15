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
  /** When race is live, driverId -> current running position (show P1, P2, etc. on selected picks). */
  driverPositionByDriverId?: Record<string, number>;
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
          return (
            <button
              key={driverId}
              type="button"
              className={`tier-driver-row ${active ? "tier-driver-row--selected" : ""}`}
              disabled={disabled}
              onClick={() => onToggle(driverId, limit)}
            >
              <span className="tier-driver-line">
                #{driver?.number ?? "--"} {driver?.name ?? driverId}
                {driver?.team ? <span className="tier-driver-team">{driver.team}</span> : null}
              </span>
              {active ? (
                position != null ? (
                  <span className="tier-driver-position" aria-label={`Position ${position}`}>P{position}</span>
                ) : (
                  <span className="tier-driver-check" aria-hidden>✓</span>
                )
              ) : null}
            </button>
          );
        })}
      </div>
    </section>
  );
}
