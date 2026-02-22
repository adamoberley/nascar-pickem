import type { DriverDoc } from "../lib/types";

interface Props {
  title: string;
  limit: number;
  driverIds: string[];
  driversById: Record<string, DriverDoc>;
  tierColor: "yellow" | "red" | "blue";
  showCount?: boolean;
  /** When race is live, driverId -> current running position. */
  driverPositionByDriverId?: Record<string, number>;
  /** When race is locked/completed, driverId -> points for this race (show points instead of checkmark). */
  driverPointsByDriverId?: Record<string, number>;
}

export function PicksTierSummary({
  title,
  limit,
  driverIds,
  driversById,
  tierColor,
  showCount = true,
  driverPositionByDriverId,
  driverPointsByDriverId,
}: Props) {
  return (
    <div className={`picks-tier-summary picks-tier-summary--${tierColor}`}>
      <div className="picks-tier-summary-head">
        <span className="section-title-small">{title}</span>
        {showCount ? <span className="picks-tier-count">{driverIds.length}/{limit}</span> : null}
      </div>
      <div className="picks-tier-summary-rows">
        {driverIds.map((driverId) => {
          const driver = driversById[driverId];
          const position = driverPositionByDriverId?.[driverId];
          const points = driverPointsByDriverId?.[driverId];
          return (
            <div key={driverId} className="picks-tier-summary-row">
              <span className="driver-line">
                {position != null ? (
                  <span className="picks-tier-position-inline" aria-label={`Position ${position}`}>
                    #{position}
                  </span>
                ) : (
                  <>#{driver?.number ?? "--"} </>
                )}
                {driver?.name ?? driverId}
                {driver?.team ? <span className="driver-team">{driver.team}</span> : null}
              </span>
              {points != null ? (
                <span className="picks-tier-points" aria-label={`${points} points`}>{points}</span>
              ) : null}
            </div>
          );
        })}
      </div>
    </div>
  );
}
