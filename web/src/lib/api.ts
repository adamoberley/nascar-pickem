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
  updateDoc,
} from "firebase/firestore";
import { httpsCallable } from "firebase/functions";
import { db, functions } from "./firebase";
import type { LeagueDoc, MemberDoc, PickDoc } from "./types";

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

export async function createLeague(input: {
  name: string;
  seasonYear: number;
  inviteCode: string;
  payoutConfigText?: string;
}): Promise<{ leagueId: string; inviteCode: string }> {
  const fn = httpsCallable(functions, "createLeague");
  const result = await fn(input);
  return result.data as { leagueId: string; inviteCode: string };
}

export async function getLeaguePreviewByInviteCode(inviteCode: string): Promise<{
  leagueId: string;
  name: string;
  memberNames: string[];
}> {
  const fn = httpsCallable(functions, "getLeaguePreviewByInviteCode");
  const result = await fn({ inviteCode: inviteCode.toUpperCase() });
  return result.data as { leagueId: string; name: string; memberNames: string[] };
}

export async function joinLeagueByInvite(input: {
  inviteCode: string;
  displayName: string;
}): Promise<{ leagueId: string; displayName: string }> {
  const fn = httpsCallable(functions, "joinLeagueByInvite");
  const result = await fn(input);
  return result.data as { leagueId: string; displayName: string };
}

export async function savePick(input: {
  leagueId: string;
  raceId: string;
  tierA: string[];
  tierB: string[];
  tierC: string[];
}): Promise<void> {
  const fn = httpsCallable(functions, "savePick");
  await fn(input);
}

export async function manualRefreshData(input: { leagueId: string }): Promise<void> {
  const fn = httpsCallable(functions, "manualRefreshData");
  await fn(input);
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
  leagueId: string,
  userId: string,
  paidStatus: "paid" | "unpaid",
): Promise<void> {
  await updateDoc(doc(db, "leagues", leagueId, "members", userId), {
    paidStatus,
  });
}

export async function setLeagueSettings(
  leagueId: string,
  values: {
    name: string;
    seasonYear: number;
    payoutConfigText: string;
  },
): Promise<void> {
  await updateDoc(doc(db, "leagues", leagueId), {
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
