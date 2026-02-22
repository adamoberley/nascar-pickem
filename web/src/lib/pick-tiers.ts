import type { DriverDoc } from "./types";

export type PickTierColor = "yellow" | "red" | "blue";

interface PickLike {
  tierA: string[];
  tierB: string[];
  tierC: string[];
}

export interface PickTierLookups {
  byDriverId: Map<string, PickTierColor>;
  byCarNumber: Map<string, PickTierColor>;
  byName: Map<string, PickTierColor>;
}

function normalizeName(value: string): string {
  return value.toLowerCase().replace(/[^a-z0-9]/g, "");
}

function normalizeCarNumber(value: string): string {
  const trimmed = value.trim();
  if (!trimmed) return "";
  const numeric = Number(trimmed);
  if (!Number.isNaN(numeric)) return String(numeric);
  return trimmed;
}

export function buildPickTierLookups(
  pick: PickLike | null | undefined,
  driversById: Record<string, DriverDoc>,
): PickTierLookups {
  const lookups: PickTierLookups = {
    byDriverId: new Map(),
    byCarNumber: new Map(),
    byName: new Map(),
  };
  if (!pick) return lookups;

  const addTier = (driverIds: string[], tierColor: PickTierColor) => {
    for (const driverId of driverIds) {
      const trimmedDriverId = driverId.trim();
      if (!trimmedDriverId) continue;
      lookups.byDriverId.set(trimmedDriverId, tierColor);

      const driver = driversById[trimmedDriverId];
      if (driver?.number) {
        const carNumber = normalizeCarNumber(driver.number);
        if (carNumber) {
          lookups.byCarNumber.set(carNumber, tierColor);
        }
      }
      if (driver?.name) {
        const nameKey = normalizeName(driver.name);
        if (nameKey) {
          lookups.byName.set(nameKey, tierColor);
        }
      }
    }
  };

  addTier(pick.tierA, "yellow");
  addTier(pick.tierB, "red");
  addTier(pick.tierC, "blue");

  return lookups;
}

export function getPickTierForDriverId(
  driverId: string | null | undefined,
  lookups: PickTierLookups,
): PickTierColor | null {
  if (!driverId) return null;

  const trimmedDriverId = driverId.trim();
  if (!trimmedDriverId) return null;

  const byDriverId = lookups.byDriverId.get(trimmedDriverId);
  if (byDriverId) return byDriverId;

  const carNumber = normalizeCarNumber(trimmedDriverId);
  if (!carNumber) return null;
  return lookups.byCarNumber.get(carNumber) ?? null;
}

export function getPickTierForResultRow(
  row: {
    driverId?: string | null;
    vehicleNumber?: string | null;
    driverName?: string | null;
  },
  lookups: PickTierLookups,
): PickTierColor | null {
  const byDriverId = getPickTierForDriverId(row.driverId, lookups);
  if (byDriverId) return byDriverId;

  if (row.vehicleNumber) {
    const carNumber = normalizeCarNumber(row.vehicleNumber);
    if (carNumber) {
      const byCarNumber = lookups.byCarNumber.get(carNumber);
      if (byCarNumber) return byCarNumber;
    }
  }

  if (row.driverName) {
    const nameKey = normalizeName(row.driverName);
    if (nameKey) {
      const byName = lookups.byName.get(nameKey);
      if (byName) return byName;
    }
  }

  return null;
}
