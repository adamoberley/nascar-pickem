import { getApps, initializeApp } from "firebase-admin/app";
import {
  FieldValue,
  Firestore,
  Timestamp,
  getFirestore,
} from "firebase-admin/firestore";
import { HttpsError } from "firebase-functions/v2/https";
import type { MemberDoc } from "./types";

// Lazy init so Firebase CLI discovery doesn't run Admin SDK (avoids timeout).
let _db: Firestore | null = null;
function getDb(): Firestore {
  if (!_db) {
    if (getApps().length === 0) initializeApp();
    _db = getFirestore();
  }
  return _db;
}
export const db: Firestore = new Proxy({} as Firestore, {
  get(_, prop) {
    return (getDb() as Record<string | symbol, unknown>)[prop];
  },
});

export const serverTimestamp = FieldValue.serverTimestamp;

export function nowTimestamp(): Timestamp {
  return Timestamp.now();
}

export function leagueRef(leagueId: string) {
  return db.collection("leagues").doc(leagueId);
}

export function membersRef(leagueId: string) {
  return leagueRef(leagueId).collection("members");
}

export function racesRef(leagueId: string) {
  return leagueRef(leagueId).collection("races");
}

export function driversRef(leagueId: string) {
  return leagueRef(leagueId).collection("drivers");
}

export function standingsSnapshotsRef(leagueId: string) {
  return leagueRef(leagueId).collection("standingsSnapshots");
}

export function tiersRef(leagueId: string) {
  return leagueRef(leagueId).collection("tiers");
}

export function picksRef(leagueId: string) {
  return leagueRef(leagueId).collection("picks");
}

export function racePointsRef(leagueId: string) {
  return leagueRef(leagueId).collection("racePoints");
}

export function adjustmentsRef(leagueId: string) {
  return leagueRef(leagueId).collection("adjustments");
}

export function weeklyScoresRef(leagueId: string) {
  return leagueRef(leagueId).collection("weeklyScores");
}

export function seasonScoresRef(leagueId: string) {
  return leagueRef(leagueId).collection("seasonScores");
}

export async function assertAdminInLeague(
  leagueId: string,
  userId: string,
): Promise<MemberDoc> {
  const memberSnap = await membersRef(leagueId).doc(userId).get();
  if (!memberSnap.exists) {
    throw new HttpsError("permission-denied", "You are not a member of this league.");
  }

  const member = memberSnap.data() as MemberDoc;
  if (member.role !== "admin") {
    throw new HttpsError("permission-denied", "Admin role is required.");
  }

  return member;
}

export async function getLeagueIds(): Promise<string[]> {
  const snap = await db.collection("leagues").select().get();
  return snap.docs.map((doc) => doc.id);
}
