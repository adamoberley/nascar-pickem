import type { StandingsSnapshotDoc, TierDoc } from "./types";

/**
 * Build a TierDoc-shaped fallback from the latest standings snapshot.
 * Top 10 → A, 11–20 → B, 21–30 → C. Returns null if no usable snapshot.
 */
export function computeTiersFromStandingsSnapshot(
  snapshot: (StandingsSnapshotDoc & { id: string }) | undefined,
): TierDoc | null {
  if (!snapshot?.drivers?.length) return null;
  const ordered = [...snapshot.drivers].sort((a, b) => a.position - b.position);
  const tierA = ordered.filter((e) => e.position >= 1 && e.position <= 10).map((e) => e.driverId);
  const tierB = ordered.filter((e) => e.position >= 11 && e.position <= 20).map((e) => e.driverId);
  const tierC = ordered.filter((e) => e.position >= 21 && e.position <= 30).map((e) => e.driverId);
  if (tierA.length === 0 && tierB.length === 0 && tierC.length === 0) return null;
  return {
    tierA,
    tierB,
    tierC,
    computedFromSnapshotId: snapshot.id ?? "client",
  };
}
