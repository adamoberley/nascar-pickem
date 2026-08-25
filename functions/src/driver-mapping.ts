import type { DriverDoc } from "./types";

interface BuildNumberToDriverIdOptions {
  /** Restrict mapping to a known active set (latest standings snapshot). */
  includeDriverIds?: ReadonlySet<string>;
}

/** Normalize a driver name for cross-feed matching ("John H. Nemechek" == "John H Nemechek"). */
export function normalizeDriverNameKey(name: string): string {
  return (name ?? "")
    .normalize("NFKD")
    .replace(/[\u0300-\u036f]/g, "")
    .toLowerCase()
    .replace(/[^a-z0-9]/g, "");
}

export function buildNumberToDriverId(
  driversSnap: FirebaseFirestore.QuerySnapshot,
  options: BuildNumberToDriverIdOptions = {},
): Map<string, string> {
  const numberToDriverId = new Map<string, string>();
  const includeDriverIds =
    options.includeDriverIds && options.includeDriverIds.size > 0
      ? options.includeDriverIds
      : null;
  driversSnap.forEach((docSnap) => {
    if (includeDriverIds && !includeDriverIds.has(docSnap.id)) return;
    const driver = docSnap.data() as DriverDoc;
    if (!driver.number) return;
    const key = String(driver.number).trim();
    if (!key) return;
    if (!numberToDriverId.has(key)) {
      numberToDriverId.set(key, docSnap.id);
    }
    const numeric = Number(key);
    if (!Number.isNaN(numeric) && !numberToDriverId.has(String(numeric))) {
      numberToDriverId.set(String(numeric), docSnap.id);
    }
  });
  return numberToDriverId;
}

export interface DriverLookup {
  /** Vehicle number -> driver doc id (restricted to active drivers when provided). */
  numberToDriverId: Map<string, string>;
  /** NASCAR driver_id -> driver doc ids. */
  driverIdsByNascarDriverId: Map<number, string[]>;
  /** Normalized driver name -> driver doc ids (duplicate legacy docs can share a name). */
  driverIdsByNameKey: Map<string, string[]>;
}

export function buildDriverLookup(
  driversSnap: FirebaseFirestore.QuerySnapshot,
  options: BuildNumberToDriverIdOptions = {},
): DriverLookup {
  const numberToDriverId = buildNumberToDriverId(driversSnap, options);
  const driverIdsByNascarDriverId = new Map<number, string[]>();
  const driverIdsByNameKey = new Map<string, string[]>();
  driversSnap.forEach((docSnap) => {
    const driver = docSnap.data() as DriverDoc;
    if (typeof driver.nascarDriverId === "number") {
      const ids = driverIdsByNascarDriverId.get(driver.nascarDriverId) ?? [];
      ids.push(docSnap.id);
      driverIdsByNascarDriverId.set(driver.nascarDriverId, ids);
    }
    const nameKey = normalizeDriverNameKey(driver.name);
    if (nameKey) {
      const ids = driverIdsByNameKey.get(nameKey) ?? [];
      ids.push(docSnap.id);
      driverIdsByNameKey.set(nameKey, ids);
    }
  });
  return { numberToDriverId, driverIdsByNascarDriverId, driverIdsByNameKey };
}

export interface FeedDriverIdentity {
  vehicleNumber?: string;
  driverName?: string;
  nascarDriverId?: number | null;
}

/**
 * Resolve a feed row to league driver doc ids. NASCAR driver_id and driver name
 * are authoritative; vehicle number is a last-resort fallback because car
 * numbers drift between feeds (standings can list a stale number while race
 * results use the actual entry) and stale numbers on inactive driver docs would
 * otherwise silently drop or misattribute points.
 */
export function resolveDriverIdsForIdentity(
  identity: FeedDriverIdentity,
  lookup: DriverLookup,
): string[] {
  const ids = new Set<string>();
  if (typeof identity.nascarDriverId === "number") {
    for (const id of lookup.driverIdsByNascarDriverId.get(identity.nascarDriverId) ?? []) {
      ids.add(id);
    }
  }
  const nameKey = normalizeDriverNameKey(identity.driverName ?? "");
  if (nameKey) {
    for (const id of lookup.driverIdsByNameKey.get(nameKey) ?? []) {
      ids.add(id);
    }
  }
  if (ids.size === 0 && identity.vehicleNumber) {
    const byNumber = resolveDriverIdFromVehicleNumber(
      identity.vehicleNumber,
      lookup.numberToDriverId,
    );
    if (byNumber) ids.add(byNumber);
  }
  return Array.from(ids);
}

export function resolveDriverIdFromVehicleNumber(
  vehicleNumber: string,
  numberToDriverId: Map<string, string>,
): string | null {
  const normalized = vehicleNumber.trim();
  if (!normalized) return null;
  let driverId = numberToDriverId.get(normalized) ?? null;
  if (!driverId) {
    const numeric = Number(normalized);
    if (!Number.isNaN(numeric)) {
      driverId = numberToDriverId.get(String(numeric)) ?? null;
    }
  }
  return driverId;
}

export function mapVehiclePointsToDrivers(
  pointsByVehicle: Map<string, number>,
  numberToDriverId: Map<string, string>,
): Array<{ driverId: string; basePoints: number }> {
  const pointsByDriverId = new Map<string, number>();
  for (const [vehicleNumber, points] of pointsByVehicle) {
    const driverId = resolveDriverIdFromVehicleNumber(vehicleNumber, numberToDriverId);
    if (!driverId) continue;
    pointsByDriverId.set(driverId, points);
  }
  return Array.from(pointsByDriverId.entries()).map(([driverId, basePoints]) => ({
    driverId,
    basePoints,
  }));
}

export function mapOfficialResultsToDrivers(
  officialResults: Array<{
    vehicleNumber: string;
    points: number;
    finishPosition: number;
    driverName?: string;
    nascarDriverId?: number;
  }>,
  lookup: DriverLookup,
): Array<{ driverId: string; basePoints: number; finishPosition: number }> {
  const resultByDriverId = new Map<
    string,
    { basePoints: number; finishPosition: number }
  >();
  for (const row of officialResults) {
    for (const driverId of resolveDriverIdsForIdentity(row, lookup)) {
      // Rows arrive finish-sorted; keep the best finish if a mapping collision occurs.
      if (resultByDriverId.has(driverId)) continue;
      resultByDriverId.set(driverId, {
        basePoints: row.points,
        finishPosition: row.finishPosition,
      });
    }
  }
  return Array.from(resultByDriverId.entries()).map(([driverId, result]) => ({
    driverId,
    basePoints: result.basePoints,
    finishPosition: result.finishPosition,
  }));
}
