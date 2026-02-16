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
