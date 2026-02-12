import type { DriverDoc } from "../lib/types";

interface Props {
  title: string;
  limit: number;
  driverIds: string[];
  selected: string[];
  disabled: boolean;
  driversById: Record<string, DriverDoc>;
  onToggle: (driverId: string, limit: number) => void;
}

export function TierBucket({
  title,
  limit,
  driverIds,
  selected,
  disabled,
  driversById,
  onToggle,
}: Props) {
  return (
    <section className="tier-card">
      <header>
        <h3>{title}</h3>
        <p>
          Pick {selected.length}/{limit}
        </p>
      </header>
      <div className="driver-grid">
        {driverIds.map((driverId) => {
          const driver = driversById[driverId];
          const active = selected.includes(driverId);
          return (
            <button
              key={driverId}
              className={`driver-chip ${active ? "active" : ""}`}
              type="button"
              disabled={disabled}
              onClick={() => onToggle(driverId, limit)}
            >
              <span className="driver-number">#{driver?.number ?? "--"}</span>
              <span className="driver-name">{driver?.name ?? driverId}</span>
              <span className="driver-team">{driver?.team ?? "Unknown Team"}</span>
            </button>
          );
        })}
      </div>
    </section>
  );
}
