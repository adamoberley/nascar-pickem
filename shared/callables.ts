export interface CreateLeagueRequest {
  name: string;
  seasonYear: number;
  inviteCode: string;
  payoutConfigText?: string;
}

export interface CreateLeagueResponse {
  leagueId: string;
  inviteCode: string;
}

export interface JoinLeagueByInviteRequest {
  inviteCode: string;
  displayName: string;
}

export interface JoinLeagueByInviteResponse {
  leagueId: string;
  displayName: string;
}

export interface GetLeaguePreviewByInviteCodeRequest {
  inviteCode: string;
}

export interface GetLeaguePreviewByInviteCodeResponse {
  leagueId: string;
  name: string;
  memberNames: string[];
}

export interface SavePickRequest {
  leagueId: string;
  raceId: string;
  tierA: string[];
  tierB: string[];
  tierC: string[];
}

export interface UpdateLeagueSettingsRequest {
  leagueId: string;
  name: string;
  seasonYear: number;
  payoutConfigText: string;
}

export interface UpdateMemberPaidStatusRequest {
  leagueId: string;
  userId: string;
  paidStatus: "paid" | "unpaid";
}

export interface SyncLiveRaceNowRequest {
  leagueId: string;
}

export interface SyncLiveRaceNowResponse {
  ok: boolean;
  updated: boolean;
  throttled?: boolean;
  retryAfterSeconds?: number;
  reason?: string;
}

export interface AddAdjustmentRequest {
  leagueId: string;
  raceId: string;
  driverId: string;
  type: "penalty" | "correction";
  deltaPoints: number;
  reason: string;
  source?: string;
}

export interface ManualUpsertRacePointsRequest {
  leagueId: string;
  raceId: string;
  source?: string;
  drivers: Array<{
    driverId: string;
    basePoints: number;
  }>;
}

export interface UpsertPushTokenRequest {
  token: string;
  platform: "ios" | "web";
  deviceId?: string;
}

export interface RemovePushTokenRequest {
  token: string;
  deviceId?: string;
}
