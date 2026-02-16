import {
  collection,
  collectionGroup,
  doc,
  getDoc,
  getDocs,
  query,
  where,
  type DocumentData,
  type QueryDocumentSnapshot,
} from "firebase/firestore";
import { httpsCallable } from "firebase/functions";
import { db, functions } from "./firebase";
import type { LeagueDoc, MemberDoc, PickDoc } from "./types";
import type {
  CreateLeagueRequest,
  CreateLeagueResponse,
  JoinLeagueByInviteRequest,
  JoinLeagueByInviteResponse,
  SavePickRequest,
  UpdateLeagueSettingsRequest,
  UpdateMemberPaidStatusRequest,
} from "../../../shared/callables";

interface Membership {
  leagueId: string;
  league: LeagueDoc;
  member: MemberDoc;
}

function dataFromDoc<T>(snapshot: QueryDocumentSnapshot<DocumentData>): T {
  return snapshot.data() as T;
}

export async function loadMemberships(userId: string): Promise<Membership[]> {
  try {
    const membershipsSnap = await getDocs(
      query(
        collectionGroup(db, "members"),
        where("userId", "==", userId)
      )
    );

    const userMemberDocs = membershipsSnap.docs;

    const memberships = await Promise.all(
      userMemberDocs.map(async (memberDocSnap) => {
        const leagueId = memberDocSnap.ref.parent.parent?.id;
        if (!leagueId) return null;

        try {
          const leagueSnap = await getDoc(doc(db, "leagues", leagueId));
          if (!leagueSnap.exists()) return null;

          return {
            leagueId,
            league: leagueSnap.data() as LeagueDoc,
            member: dataFromDoc<MemberDoc>(memberDocSnap),
          };
        } catch {
          // If we can't read the league (e.g., permission denied), skip it
          return null;
        }
      }),
    );

    return memberships.filter((membership): membership is Membership => membership !== null);
  } catch (error) {
    throw error;
  }
}

export async function createLeague(input: CreateLeagueRequest): Promise<CreateLeagueResponse> {
  const fn = httpsCallable<CreateLeagueRequest, CreateLeagueResponse>(
    functions,
    "createLeague",
  );
  const result = await fn(input);
  return result.data;
}

export async function joinLeagueByInvite(
  input: JoinLeagueByInviteRequest,
): Promise<JoinLeagueByInviteResponse> {
  const fn = httpsCallable<JoinLeagueByInviteRequest, JoinLeagueByInviteResponse>(
    functions,
    "joinLeagueByInvite",
  );
  const result = await fn(input);
  return result.data;
}

export async function savePick(input: SavePickRequest): Promise<void> {
  const fn = httpsCallable<SavePickRequest, { ok: true }>(functions, "savePick");
  await fn(input);
}

export async function manualRefreshData(input: { leagueId: string }): Promise<void> {
  const fn = httpsCallable(functions, "manualRefreshData");
  await fn(input);
}

/** Pull latest live race points from NASCAR.com feed (admin). */
export async function syncLiveRaceNow(input: {
  leagueId: string;
}): Promise<{ ok: boolean; updated: boolean; reason?: string }> {
  const fn = httpsCallable(functions, "syncLiveRaceNow");
  const result = await fn(input);
  return result.data as { ok: boolean; updated: boolean; reason?: string };
}

export async function manualUpsertRacePoints(input: {
  leagueId: string;
  raceId: string;
  source?: string;
  drivers: Array<{
    driverId: string;
    basePoints: number;
  }>;
}): Promise<void> {
  const fn = httpsCallable(functions, "manualUpsertRacePoints");
  await fn(input);
}

export async function addAdjustment(input: {
  leagueId: string;
  raceId: string;
  driverId: string;
  type: "penalty" | "correction";
  deltaPoints: number;
  reason: string;
  source?: string;
}): Promise<void> {
  const fn = httpsCallable(functions, "addAdjustment");
  await fn(input);
}

export async function setMemberPaidStatus(
  leagueId: UpdateMemberPaidStatusRequest["leagueId"],
  userId: UpdateMemberPaidStatusRequest["userId"],
  paidStatus: UpdateMemberPaidStatusRequest["paidStatus"],
): Promise<void> {
  const fn = httpsCallable<UpdateMemberPaidStatusRequest, { ok: true }>(
    functions,
    "updateMemberPaidStatus",
  );
  await fn({ leagueId, userId, paidStatus });
}

export async function setLeagueSettings(
  leagueId: UpdateLeagueSettingsRequest["leagueId"],
  values: Omit<UpdateLeagueSettingsRequest, "leagueId">,
): Promise<void> {
  const fn = httpsCallable<UpdateLeagueSettingsRequest, { ok: true }>(
    functions,
    "updateLeagueSettings",
  );
  await fn({
    leagueId,
    name: values.name,
    seasonYear: values.seasonYear,
    payoutConfigText: values.payoutConfigText,
  });
}

export function pickDocRef(leagueId: string, raceId: string, userId: string) {
  return doc(db, "leagues", leagueId, "picks", `${raceId}_${userId}`);
}

export function leagueDocRef(leagueId: string) {
  return doc(db, "leagues", leagueId);
}

export function raceDocRef(leagueId: string, raceId: string) {
  return doc(db, "leagues", leagueId, "races", raceId);
}

export function tierDocRef(leagueId: string, raceId: string) {
  return doc(db, "leagues", leagueId, "tiers", raceId);
}

export function racePointsDocRef(leagueId: string, raceId: string) {
  return doc(db, "leagues", leagueId, "racePoints", raceId);
}

export function weeklyScoreDocRef(leagueId: string, raceId: string, userId: string) {
  return doc(db, "leagues", leagueId, "weeklyScores", `${raceId}_${userId}`);
}

export function collectionRef(path: string[]) {
  return collection(db, ...(path as [string, ...string[]]));
}

export type { Membership };
