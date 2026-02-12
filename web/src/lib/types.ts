import type { Timestamp } from "firebase/firestore";

export type MemberRole = "admin" | "player";
export type PaidStatus = "paid" | "unpaid";
export type RaceStatus = "scheduled" | "locked" | "completed";

export interface LeagueDoc {
  name: string;
  seasonYear: number;
  inviteCode: string;
  payoutConfigText?: string;
  lockBehavior?: "race_start";
}

export interface MemberDoc {
  displayName: string;
  role: MemberRole;
  paidStatus: PaidStatus;
  joinedAt: Timestamp;
}

export interface RaceDoc {
  name: string;
  track: string;
  weekIndex: number;
  startTime: Timestamp;
  lockTime: Timestamp;
  status: RaceStatus;
  providerRaceKey?: string;
}

export interface DriverDoc {
  name: string;
  number: string;
  team: string;
}

export interface TierDoc {
  tierA: string[];
  tierB: string[];
  tierC: string[];
  computedFromSnapshotId: string;
}

export interface PickDoc {
  raceId: string;
  userId: string;
  tierA: string[];
  tierB: string[];
  tierC: string[];
  lockedAt?: Timestamp | null;
}

export interface RacePointsDoc {
  drivers: Array<{
    driverId: string;
    basePoints: number;
  }>;
}

export interface AdjustmentDoc {
  raceId: string;
  driverId: string;
  type: "penalty" | "correction";
  deltaPoints: number;
  reason: string;
  source: string;
}

export interface WeeklyScoreDoc {
  raceId: string;
  userId: string;
  breakdown: Array<{
    driverId: string;
    basePoints: number;
    totalAdjustments: number;
    finalPointsApplied: number;
    adjusted: boolean;
  }>;
  weeklyTotal: number;
  hasAdjustments: boolean;
}

export interface SeasonScoreDoc {
  seasonTotal: number;
  rank: number;
}
