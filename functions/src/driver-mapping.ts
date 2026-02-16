import type { DriverDoc } from "./types";

interface BuildNumberToDriverIdOptions {
  /** Restrict mapping to a known active set (latest standings snapshot). */
  includeDriverIds?: ReadonlySet<string>;
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
  }>,
  numberToDriverId: Map<string, string>,
): Array<{ driverId: string; basePoints: number; finishPosition: number }> {
  const resultByDriverId = new Map<
    string,
    { basePoints: number; finishPosition: number }
  >();
  for (const row of officialResults) {
    const driverId = resolveDriverIdFromVehicleNumber(row.vehicleNumber, numberToDriverId);
    if (!driverId) continue;
    resultByDriverId.set(driverId, {
      basePoints: row.points,
      finishPosition: row.finishPosition,
    });
  }
  return Array.from(resultByDriverId.entries()).map(([driverId, result]) => ({
    driverId,
    basePoints: result.basePoints,
    finishPosition: result.finishPosition,
  }));
}
