import type { DriverDoc, RacePointsDoc } from "./types";

export interface NormalizedRaceDriverPoints {
  driverId: string;
  basePoints: number;
  runningPosition?: number;
  finishPosition?: number;
}

export interface NormalizedOfficialRaceResult {
  finishPosition: number | null;
  driverName: string;
  points: number;
  vehicleNumber?: string;
}

type UnknownRecord = Record<string, unknown>;

function asRecord(value: unknown): UnknownRecord | null {
  if (!value || typeof value !== "object") return null;
  return value as UnknownRecord;
}

function readString(...values: unknown[]): string | null {
  for (const value of values) {
    if (typeof value !== "string" && typeof value !== "number") continue;
    const trimmed = String(value).trim();
    if (trimmed.length > 0) return trimmed;
  }
  return null;
}

function readNumber(...values: unknown[]): number | null {
  for (const value of values) {
    if (typeof value === "number" && Number.isFinite(value)) {
      return value;
    }
    if (typeof value === "string") {
      const parsed = Number(value.trim());
      if (Number.isFinite(parsed)) return parsed;
    }
  }
  return null;
}

function normalizeName(name: string): string {
  return name.toLowerCase().replace(/[^a-z0-9]/g, "");
}

export function normalizeRacePointDrivers(
  racePoints: RacePointsDoc | null | undefined,
): NormalizedRaceDriverPoints[] {
  const racePointsRecord = asRecord(racePoints);
  const rawDriversValue = racePointsRecord?.drivers;
  const driversRecord = asRecord(rawDriversValue);
  const rawDrivers = Array.isArray(rawDriversValue)
    ? rawDriversValue
    : driversRecord
      ? Object.entries(driversRecord).map(([driverId, points]) => ({ driverId, points }))
      : [];
  if (rawDrivers.length === 0) return [];

  const rows: NormalizedRaceDriverPoints[] = [];
  for (const row of rawDrivers) {
    const rowRecord = asRecord(row);
    if (!rowRecord) continue;
    const driverId = readString(
      rowRecord.driverId,
      rowRecord.driver_id,
      rowRecord.vehicleNumber,
      rowRecord.vehicle_number,
    );
    const basePoints = readNumber(
      rowRecord.basePoints,
      rowRecord.base_points,
      rowRecord.points,
    );
    if (!driverId || basePoints == null) continue;

    const runningPosition = readNumber(
      rowRecord.runningPosition,
      rowRecord.running_position,
      rowRecord.position,
    );
    const finishPosition = readNumber(
      rowRecord.finishPosition,
      rowRecord.finish_position,
      rowRecord.finishingPosition,
      rowRecord.finishing_position,
    );
    rows.push({
      driverId,
      basePoints,
      ...(runningPosition != null ? { runningPosition } : {}),
      ...(finishPosition != null ? { finishPosition } : {}),
    });
  }

  return rows;
}

export function normalizeOfficialRaceResults(
  racePoints: RacePointsDoc | null | undefined,
): NormalizedOfficialRaceResult[] {
  const racePointsRecord = asRecord(racePoints);
  const rawRows =
    racePointsRecord?.officialResults ??
    racePointsRecord?.official_results ??
    racePointsRecord?.results;
  if (!Array.isArray(rawRows)) return [];
  const rows: NormalizedOfficialRaceResult[] = [];

  for (const row of rawRows) {
    const rowRecord = asRecord(row);
    if (!rowRecord) continue;
    const points = readNumber(
      rowRecord.points,
      rowRecord.basePoints,
      rowRecord.base_points,
    );
    if (points == null) continue;
    const finishPosition = readNumber(
      rowRecord.finishPosition,
      rowRecord.finish_position,
      rowRecord.position,
      rowRecord.finishingPosition,
      rowRecord.finishing_position,
    );
    const driverName =
      readString(
        rowRecord.driverName,
        rowRecord.driver_name,
        rowRecord.fullName,
        rowRecord.full_name,
        rowRecord.name,
        rowRecord.vehicleNumber,
        rowRecord.vehicle_number,
      ) ?? "Unknown Driver";
    const vehicleNumber = readString(
      rowRecord.vehicleNumber,
      rowRecord.vehicle_number,
      rowRecord.carNumber,
      rowRecord.car_number,
      rowRecord.official_car_number,
    );

    rows.push({
      finishPosition,
      driverName,
      points,
      ...(vehicleNumber ? { vehicleNumber } : {}),
    });
  }

  return rows;
}

export function mapOfficialResultsToDriverPoints(
  officialResults: NormalizedOfficialRaceResult[],
  driversById: Record<string, DriverDoc>,
): Record<string, number> {
  const driverIdByCarNumber = new Map<string, string>();
  const driverIdByName = new Map<string, string>();

  for (const [driverId, driver] of Object.entries(driversById)) {
    const number = driver.number?.trim();
    if (number) {
      if (!driverIdByCarNumber.has(number)) {
        driverIdByCarNumber.set(number, driverId);
      }
      const numericNumber = Number(number);
      if (
        !Number.isNaN(numericNumber) &&
        !driverIdByCarNumber.has(String(numericNumber))
      ) {
        driverIdByCarNumber.set(String(numericNumber), driverId);
      }
    }

    const nameKey = normalizeName(driver.name);
    if (nameKey && !driverIdByName.has(nameKey)) {
      driverIdByName.set(nameKey, driverId);
    }
  }

  const pointsByDriverId: Record<string, number> = {};
  for (const row of officialResults) {
    let driverId: string | undefined;
    if (row.vehicleNumber) {
      const carNumber = row.vehicleNumber.trim();
      driverId = driverIdByCarNumber.get(carNumber);
      if (!driverId) {
        const numericNumber = Number(carNumber);
        if (!Number.isNaN(numericNumber)) {
          driverId = driverIdByCarNumber.get(String(numericNumber));
        }
      }
    }

    if (!driverId && row.driverName) {
      driverId = driverIdByName.get(normalizeName(row.driverName));
    }

    if (!driverId) continue;
    pointsByDriverId[driverId] = row.points;
  }

  return pointsByDriverId;
}

export function buildDriverPointsByDriverId(
  rows: Array<{ driverId: string; basePoints: number }>,
  driversById: Record<string, DriverDoc>,
): Record<string, number> {
  const byNumber = new Map<string, string>();

  for (const [driverId, driver] of Object.entries(driversById)) {
    const number = driver.number?.trim();
    if (number) {
      if (!byNumber.has(number)) byNumber.set(number, driverId);
      const numeric = Number(number);
      if (!Number.isNaN(numeric) && !byNumber.has(String(numeric))) {
        byNumber.set(String(numeric), driverId);
      }
    }
  }

  const resolveDriverId = (rawDriverId: string): string => {
    const trimmed = rawDriverId.trim();
    if (driversById[trimmed]) return trimmed;
    if (byNumber.has(trimmed)) return byNumber.get(trimmed)!;

    const numeric = Number(trimmed);
    if (!Number.isNaN(numeric)) {
      const numericKey = String(numeric);
      if (driversById[numericKey]) return numericKey;
      if (byNumber.has(numericKey)) return byNumber.get(numericKey)!;
    }

    return trimmed;
  };

  const pointsByDriverId: Record<string, number> = {};
  for (const row of rows) {
    const resolvedDriverId = resolveDriverId(row.driverId);
    pointsByDriverId[resolvedDriverId] = row.basePoints;
  }
  return pointsByDriverId;
}
