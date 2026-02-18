import type { Timestamp } from "firebase/firestore";

export type MemberRole = "admin" | "player";
export type PaidStatus = "paid" | "unpaid";
export type RaceStatus = "scheduled" | "locked" | "completed";

export interface LeagueDoc {
  name: string;
  seasonYear: number;
  inviteCode: string;
  payoutConfigText?: string;
  memberNames?: string[];
  /** @deprecated Use memberNames. Kept for reading existing leagues. */
  expectedMemberNames?: string[];
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
  nascarRaceId?: number;
  providerRaceKey?: string;
  tvChannel?: string;
}

export interface DriverDoc {
  name: string;
  number: string;
  team: string;
  nascarDriverId?: number;
}

export interface StandingEntry {
  driverId: string;
  position: number;
}

export interface StandingsSnapshotDoc {
  asOfDate: import("firebase/firestore").Timestamp;
  weekIndex: number;
  drivers: StandingEntry[];
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
    /** Current running position (1-based) when from live feed. */
    runningPosition?: number;
    /** Official finish position (1-based) when available from completed race results. */
    finishPosition?: number;
  }>;
  /** Unmapped official results rows from NASCAR (for Race tab results table). */
  officialResults?: Array<{
    finishPosition: number;
    driverName: string;
    points: number;
    vehicleNumber?: string;
  }>;
  /** Source of the points data, e.g. "nascar-live" when from live feed. */
  source?: string;
  /** When from live feed: lap and stage info for UI. */
  liveLapNumber?: number;
  liveLapsInRace?: number;
  liveLapsToGo?: number;
  liveStage?: { stageNum: number; finishAtLap: number; lapsInStage: number };
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

export interface UserNotificationDoc {
  type: "pick_reminder";
  leagueId: string;
  raceId: string;
  title: string;
  message: string;
  lockTime?: Timestamp;
  createdAt?: Timestamp;
  readAt?: Timestamp;
}
