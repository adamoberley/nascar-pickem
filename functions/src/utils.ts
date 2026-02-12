import { HttpsError } from "firebase-functions/v2/https";

export function toDocId(input: string): string {
  return input
    .trim()
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/(^-|-$)/g, "")
    .slice(0, 120);
}

export function pickId(raceId: string, userId: string): string {
  return `${raceId}_${userId}`;
}

export function requireAuthUid(uid: string | undefined): string {
  if (!uid) {
    throw new HttpsError("unauthenticated", "Sign in is required.");
  }
  return uid;
}

export function requireString(value: unknown, field: string): string {
  if (typeof value !== "string" || value.trim().length === 0) {
    throw new HttpsError("invalid-argument", `${field} is required.`);
  }
  return value.trim();
}

export function requireNumber(value: unknown, field: string): number {
  if (typeof value !== "number" || Number.isNaN(value)) {
    throw new HttpsError("invalid-argument", `${field} must be a number.`);
  }
  return value;
}

export function requireStringArray(
  value: unknown,
  field: string,
  expectedLength: number,
): string[] {
  if (!Array.isArray(value) || value.length !== expectedLength) {
    throw new HttpsError(
      "invalid-argument",
      `${field} must contain exactly ${expectedLength} values.`,
    );
  }

  const normalized = value.map((entry) => {
    if (typeof entry !== "string" || entry.trim().length === 0) {
      throw new HttpsError("invalid-argument", `${field} must be an array of strings.`);
    }
    return entry.trim();
  });

  if (new Set(normalized).size !== normalized.length) {
    throw new HttpsError("invalid-argument", `${field} cannot contain duplicates.`);
  }

  return normalized;
}

export function assertNoDuplicates(values: string[], field: string): void {
  if (new Set(values).size !== values.length) {
    throw new HttpsError("invalid-argument", `${field} cannot contain duplicate drivers.`);
  }
}
