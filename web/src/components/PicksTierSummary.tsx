import type { DriverDoc } from "../lib/types";

interface Props {
  title: string;
  limit: number;
  driverIds: string[];
  driversById: Record<string, DriverDoc>;
  tierColor: "yellow" | "red" | "blue";
  /** When race is live, driverId -> current running position (show P1, P2, etc. instead of checkmark). */
  driverPositionByDriverId?: Record<string, number>;
}

export function PicksTierSummary({
  title,
  limit,
  driverIds,
  driversById,
  tierColor,
  driverPositionByDriverId,
}: Props) {
  return (
    <div className={`picks-tier-summary picks-tier-summary--${tierColor}`}>
      <div className="picks-tier-summary-head">
        <span className="section-title-small">{title}</span>
        <span className="picks-tier-count">{driverIds.length}/{limit}</span>
      </div>
      <div className="picks-tier-summary-rows">
        {driverIds.map((driverId) => {
          const driver = driversById[driverId];
          const position = driverPositionByDriverId?.[driverId];
          return (
            <div key={driverId} className="picks-tier-summary-row">
              <span className="driver-line">
                #{driver?.number ?? "--"} {driver?.name ?? driverId}
                {driver?.team ? <span className="driver-team">{driver.team}</span> : null}
              </span>
              {position != null ? (
                <span className="picks-tier-position" aria-label={`Position ${position}`}>P{position}</span>
              ) : (
                <span className="check-icon" aria-hidden>✓</span>
              )}
            </div>
          );
        })}
      </div>
    </div>
  );
}
