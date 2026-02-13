export type MemberRole = "admin" | "player";
export type PaidStatus = "paid" | "unpaid";
export type RaceStatus = "scheduled" | "locked" | "completed";
export type AdjustmentType = "penalty" | "correction";

export interface LeagueDoc {
  name: string;
  seasonYear: number;
  inviteCode: string;
  payoutConfigText?: string;
  /** League member names (shown in join flow and standings until they sign up). */
  memberNames?: string[];
  createdAt: FirebaseFirestore.Timestamp;
  lockBehavior?: "race_start";
}

export interface MemberDoc {
  userId: string; // Store userId as field to enable collection group queries
  displayName: string;
  role: MemberRole;
  paidStatus: PaidStatus;
  joinedAt: FirebaseFirestore.Timestamp;
}

export interface RaceDoc {
  name: string;
  track: string;
  weekIndex: number;
  startTime: FirebaseFirestore.Timestamp;
  lockTime: FirebaseFirestore.Timestamp;
  status: RaceStatus;
  providerRaceKey?: string;
  lastSyncedAt?: FirebaseFirestore.Timestamp;
  tvChannel?: string;
}

export interface DriverDoc {
  name: string;
  number: string;
  team: string;
  providerDriverKey?: string;
}

export interface StandingEntry {
  driverId: string;
  position: number;
}

export interface StandingsSnapshotDoc {
  asOfDate: FirebaseFirestore.Timestamp;
  weekIndex: number;
  drivers: StandingEntry[];
}

export interface TierDoc {
  tierA: string[];
  tierB: string[];
  tierC: string[];
  computedFromSnapshotId: string;
  updatedAt: FirebaseFirestore.Timestamp;
}

export interface PickDoc {
  raceId: string;
  userId: string;
  tierA: string[];
  tierB: string[];
  tierC: string[];
  updatedAt: FirebaseFirestore.Timestamp;
  lockedAt?: FirebaseFirestore.Timestamp | null;
}

export interface RaceDriverPoints {
  driverId: string;
  basePoints: number;
}

export interface RacePointsDoc {
  drivers: RaceDriverPoints[];
  lastSyncedAt: FirebaseFirestore.Timestamp;
  source?: string;
}

export interface AdjustmentDoc {
  raceId: string;
  driverId: string;
  type: AdjustmentType;
  deltaPoints: number;
  reason: string;
  source: string;
  createdAt: FirebaseFirestore.Timestamp;
  createdBy: string;
}

export interface ScoreBreakdownItem {
  driverId: string;
  basePoints: number;
  totalAdjustments: number;
  finalPointsApplied: number;
  adjusted: boolean;
}

export interface WeeklyScoreDoc {
  raceId: string;
  userId: string;
  breakdown: ScoreBreakdownItem[];
  weeklyTotal: number;
  hasAdjustments: boolean;
  updatedAt: FirebaseFirestore.Timestamp;
}

export interface SeasonScoreDoc {
  seasonTotal: number;
  rank: number;
  updatedAt: FirebaseFirestore.Timestamp;
}

export interface ProviderRace {
  id: string;
  name: string;
  track: string;
  weekIndex: number;
  startTimeIso: string;
  status: RaceStatus;
}

export interface ProviderDriverStanding {
  providerDriverKey: string;
  name: string;
  number: string;
  team: string;
  position: number;
}

export interface ProviderRaceResult {
  raceKey: string;
  status: RaceStatus;
  points: Array<{
    providerDriverKey: string;
    points: number;
  }>;
}
