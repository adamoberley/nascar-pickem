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
    // Ensure Firebase Admin is initialized - use default credentials from environment
    let app;
    const apps = getApps();
    if (apps.length === 0) {
      // Initialize with default credentials (Cloud Functions provides these automatically)
      app = initializeApp();
    } else {
      app = apps[0];
    }
    // Get Firestore instance - explicitly use the app to avoid timing issues
    _db = getFirestore(app);
    if (!_db) {
      throw new Error("Failed to get Firestore instance - ensure Firebase Admin is initialized");
    }
  }
  return _db;
}

// Create a Proxy that lazily initializes Firestore only when accessed
export const db: Firestore = new Proxy({} as Firestore, {
  get(_, prop) {
    const dbInstance = getDb();
    const value = (dbInstance as unknown as Record<string | symbol, unknown>)[prop];
    // Bind methods to the db instance to preserve 'this' context
    if (typeof value === "function") {
      return value.bind(dbInstance);
    }
    return value;
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
