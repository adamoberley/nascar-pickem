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

function asRecord(value: unknown): Record<string, unknown> | null {
  if (!value || typeof value !== "object" || Array.isArray(value)) return null;
  return value as Record<string, unknown>;
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

function normalizeDriverId(value: string): string {
  return value
    .toLowerCase()
    .trim()
    .replace(/[_\s]+/g, "-")
    .replace(/[^a-z0-9-]/g, "")
    .replace(/-+/g, "-")
    .replace(/^-|-$/g, "");
}

export function normalizeRacePointDrivers(
  racePoints: RacePointsDoc | null | undefined,
): NormalizedRaceDriverPoints[] {
  const record = asRecord(racePoints);
  if (!record) return [];
  const rows: NormalizedRaceDriverPoints[] = [];

  const pushNormalizedRow = (rawRow: unknown, fallbackDriverId?: string) => {
    const row = asRecord(rawRow);
    if (!row) {
      const basePoints = readNumber(rawRow);
      if (!fallbackDriverId || basePoints == null) return;
      rows.push({
        driverId: fallbackDriverId,
        basePoints,
      });
      return;
    }

    const driverId = readString(
      row.driverId,
      row.driver_id,
      row.driverID,
      row.providerDriverKey,
      row.provider_driver_key,
      row.id,
      fallbackDriverId,
    );
    const basePoints = readNumber(
      row.basePoints,
      row.base_points,
      row.points,
      row.score,
      row.finalPoints,
      row.final_points,
      row.totalPoints,
      row.total_points,
    );
    if (!driverId || basePoints == null) return;

    const runningPosition = readNumber(
      row.runningPosition,
      row.running_position,
      row.position,
      row.currentPosition,
      row.current_position,
    );
    const finishPosition = readNumber(
      row.finishPosition,
      row.finish_position,
      row.finish,
      row.finalPosition,
      row.final_position,
    );

    rows.push({
      driverId,
      basePoints,
      ...(runningPosition != null ? { runningPosition } : {}),
      ...(finishPosition != null ? { finishPosition } : {}),
    });
  };

  const rawDrivers =
    record.drivers ??
    record.driverPoints ??
    record.driver_points ??
    record.pointsByDriver ??
    record.points_by_driver;

  if (Array.isArray(rawDrivers)) {
    for (const rawRow of rawDrivers) {
      pushNormalizedRow(rawRow);
    }
    return rows;
  }

  const rawDriversRecord = asRecord(rawDrivers);
  if (!rawDriversRecord) return rows;
  for (const [driverId, rawRow] of Object.entries(rawDriversRecord)) {
    pushNormalizedRow(rawRow, driverId);
  }

  return rows;
}

export function normalizeOfficialRaceResults(
  racePoints: RacePointsDoc | null | undefined,
): NormalizedOfficialRaceResult[] {
  const record = asRecord(racePoints);
  if (!record) return [];

  const rawRows = Array.isArray(record.officialResults)
    ? record.officialResults
    : Array.isArray(record.official_results)
      ? record.official_results
      : Array.isArray(record.results)
        ? record.results
        : Array.isArray(record.raceResults)
          ? record.raceResults
          : Array.isArray(record.race_results)
            ? record.race_results
        : [];

  const rows: NormalizedOfficialRaceResult[] = [];
  const pushOfficialRow = (rawRow: unknown, fallbackKey?: string) => {
    const row = asRecord(rawRow);
    if (!row) return;

    const points = readNumber(
      row.points,
      row.basePoints,
      row.base_points,
      row.score,
    );
    if (points == null) return;

    const finishPosition = readNumber(
      row.finishPosition,
      row.finish_position,
      row.position,
      row.finish,
    );
    const driverName =
      readString(
        row.driverName,
        row.driver_name,
        row.name,
        row.driver,
        fallbackKey,
      ) ?? "Unknown Driver";
    const vehicleNumber = readString(
      row.vehicleNumber,
      row.vehicle_number,
      row.carNumber,
      row.car,
      row.number,
    );

    rows.push({
      finishPosition,
      driverName,
      points,
      ...(vehicleNumber ? { vehicleNumber } : {}),
    });
  };

  if (rawRows.length > 0) {
    for (const rawRow of rawRows) {
      pushOfficialRow(rawRow);
    }
    return rows;
  }

  const rawResultsRecord = asRecord(
    record.officialResults ??
      record.official_results ??
      record.results ??
      record.raceResults ??
      record.race_results,
  );
  if (!rawResultsRecord) return rows;
  for (const [key, rawRow] of Object.entries(rawResultsRecord)) {
    pushOfficialRow(rawRow, key);
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
  const byNormalizedId = new Map<string, string>();
  const byProviderKey = new Map<string, string>();

  for (const [driverId, driver] of Object.entries(driversById)) {
    byNormalizedId.set(normalizeDriverId(driverId), driverId);

    const providerKey = (driver as DriverDoc & { providerDriverKey?: string })
      .providerDriverKey;
    if (providerKey) {
      byProviderKey.set(normalizeDriverId(providerKey), driverId);
    }

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

    const normalized = normalizeDriverId(trimmed);
    if (byNormalizedId.has(normalized)) return byNormalizedId.get(normalized)!;
    if (byProviderKey.has(normalized)) return byProviderKey.get(normalized)!;

    return trimmed;
  };

  const pointsByDriverId: Record<string, number> = {};
  for (const row of rows) {
    const resolvedDriverId = resolveDriverId(row.driverId);
    pointsByDriverId[resolvedDriverId] = row.basePoints;
  }
  return pointsByDriverId;
}
