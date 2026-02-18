#!/usr/bin/env node
/**
 * Initialize the database with a default league and seed data
 * Usage: node scripts/init-db.js [leagueName] [inviteCode] [seasonYear] [adminUserId] [adminDisplayName]
 */

const admin = require("firebase-admin");
const { getFirestore, Timestamp } = require("firebase-admin/firestore");

// Initialize Firebase Admin
if (admin.apps.length === 0) {
  // Use default credentials from environment (GOOGLE_APPLICATION_CREDENTIALS or gcloud auth)
  admin.initializeApp({
    projectId: "nascar-pick-em",
  });
}

const db = getFirestore();

async function createLeague(name, inviteCode, seasonYear, adminUserId, adminDisplayName) {
  console.log(`Creating league: ${name}...`);

  // Check if invite code already exists
  const existingLeague = await db
    .collection("leagues")
    .where("inviteCode", "==", inviteCode.toUpperCase())
    .limit(1)
    .get();

  if (!existingLeague.empty) {
    const existingId = existingLeague.docs[0].id;
    console.log(`League with invite code ${inviteCode} already exists: ${existingId}`);
    return existingId;
  }

  // Create league document
  const leagueRef = db.collection("leagues").doc();
  await leagueRef.set({
    name,
    seasonYear,
    inviteCode: inviteCode.toUpperCase(),
    payoutConfigText: "",
    lockBehavior: "race_start",
    createdAt: Timestamp.now(),
  });

  console.log(`League created with ID: ${leagueRef.id}`);

  // Create admin member
  await leagueRef.collection("members").doc(adminUserId).set({
    userId: adminUserId,
    displayName: adminDisplayName,
    role: "admin",
    paidStatus: "paid",
    joinedAt: Timestamp.now(),
  });

  console.log(`Admin member created: ${adminDisplayName}`);

  return leagueRef.id;
}

async function ingestData(leagueId) {
  console.log("Ingesting schedule and standings...");

  const leagueSnap = await db.collection("leagues").doc(leagueId).get();
  if (!leagueSnap.exists) {
    throw new Error("League not found");
  }

  const league = leagueSnap.data();
  const seasonYear = league.seasonYear;
  const toDocId = (input) =>
    String(input || "")
      .trim()
      .toLowerCase()
      .replace(/[^a-z0-9]+/g, "-")
      .replace(/(^-|-$)/g, "")
      .slice(0, 120);
  const parseNascarDate = (value) => {
    if (!value || typeof value !== "string") return null;
    const trimmed = value.trim();
    if (!trimmed) return null;
    const withZone = /(?:z|[+\-]\d{2}:?\d{2})$/i.test(trimmed)
      ? trimmed
      : `${trimmed}Z`;
    const parsed = new Date(withZone);
    return Number.isNaN(parsed.getTime()) ? null : parsed;
  };
  const buildRaceIds = (races) => {
    const used = new Set();
    const byRaceId = new Map();
    for (const race of races) {
      const base = toDocId(`${seasonYear}-${race.race_name || `race-${race.race_id}`}`);
      let candidate = base || `${seasonYear}-race-${race.race_id}`;
      if (used.has(candidate)) {
        candidate =
          toDocId(`${candidate}-${race.track_name || ""}`) ||
          `${candidate}-${race.race_id}`;
      }
      if (used.has(candidate)) {
        candidate =
          toDocId(`${candidate}-${race.race_id}`) ||
          `${seasonYear}-race-${race.race_id}`;
      }
      while (used.has(candidate)) {
        candidate = `${candidate}-${race.race_id}`;
      }
      used.add(candidate);
      byRaceId.set(race.race_id, candidate);
    }
    return byRaceId;
  };

  const raceListRes = await fetch(
    `https://cf.nascar.com/cacher/${seasonYear}/1/race_list_basic.json`
  );
  if (!raceListRes.ok) {
    throw new Error(`Failed to load race_list_basic.json (${raceListRes.status})`);
  }
  const raceList = await raceListRes.json();
  const pointsRaces = (Array.isArray(raceList) ? raceList : [])
    .filter((race) => typeof race?.race_id === "number")
    .filter((race) => (race.series_id ?? 1) === 1 && (race.race_type_id ?? 1) === 1)
    .sort((a, b) => {
      const aMs = parseNascarDate(a.race_date || a.date_scheduled)?.getTime() ?? Number.MAX_SAFE_INTEGER;
      const bMs = parseNascarDate(b.race_date || b.date_scheduled)?.getTime() ?? Number.MAX_SAFE_INTEGER;
      return aMs - bMs || a.race_id - b.race_id;
    });
  const raceIdByNascarRaceId = buildRaceIds(pointsRaces);

  // Create races
  const raceWrites = pointsRaces.map((race, index) => {
    const raceId = raceIdByNascarRaceId.get(race.race_id);
    const raceDate = parseNascarDate(race.race_date || race.date_scheduled) || new Date();
    const startTime = Timestamp.fromDate(raceDate);
    const now = Date.now();
    const scheduledLaps = typeof race.scheduled_laps === "number" ? race.scheduled_laps : 0;
    const actualLaps = typeof race.actual_laps === "number" ? race.actual_laps : 0;
    const status =
      actualLaps > 0 && (scheduledLaps === 0 || actualLaps >= scheduledLaps)
        ? "completed"
        : startTime.toMillis() <= now
        ? "locked"
        : "scheduled";

    return db
      .collection("leagues")
      .doc(leagueId)
      .collection("races")
      .doc(raceId)
      .set(
        {
          name: race.race_name || `Race ${index + 1}`,
          track: race.track_name || "",
          weekIndex: index + 1,
          startTime,
          lockTime: startTime,
          status,
          nascarRaceId: race.race_id,
          tvChannel: race.television_broadcaster || "",
          lastSyncedAt: Timestamp.now(),
        },
        { merge: true }
      );
  });

  await Promise.all(raceWrites);
  console.log(`Created ${pointsRaces.length} races`);
}

async function main() {
  const args = process.argv.slice(2);

  const leagueName = args[0] || "NASCAR Pick'Em League";
  const inviteCode = args[1] || "NASCAR2026";
  const seasonYear = parseInt(args[2] || "2026", 10);
  const adminUserId = args[3] || "admin-user";
  const adminDisplayName = args[4] || "League Admin";

  console.log("Initializing database...");
  console.log(`League Name: ${leagueName}`);
  console.log(`Invite Code: ${inviteCode}`);
  console.log(`Season Year: ${seasonYear}`);
  console.log(`Admin User ID: ${adminUserId}`);
  console.log(`Admin Display Name: ${adminDisplayName}`);
  console.log("");

  try {
    // Create league
    const leagueId = await createLeague(
      leagueName,
      inviteCode,
      seasonYear,
      adminUserId,
      adminDisplayName
    );

    console.log("");
    
    // Ingest data
    await ingestData(leagueId);

    console.log("");
    console.log("✅ Database initialization complete!");
    console.log(`League ID: ${leagueId}`);
    console.log(`Invite Code: ${inviteCode.toUpperCase()}`);
    console.log("");
    console.log("Next steps:");
    console.log("1. Visit https://nascar-pick-em.web.app");
    console.log("2. Sign in with Firebase Auth");
    console.log("3. Join the league using invite code:", inviteCode.toUpperCase());
    console.log("4. Use 'Refresh Data Now' button in admin panel to get full schedule");
  } catch (error) {
    console.error("❌ Error initializing database:", error);
    process.exit(1);
  }
}

main();
