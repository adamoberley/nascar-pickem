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
  
  // Import the ingest function dynamically
  const { ingestScheduleAndStandings } = require("../functions/lib/index.bundle.js");
  
  // Call the function - it's exported from the bundle
  // Actually, we need to call it differently since it's bundled
  // Let's use the Firebase Functions emulator or call it via HTTP
  
  // For now, let's use a direct approach by importing the source
  // But that requires TypeScript compilation...
  
  // Actually, the best approach is to use the deployed function via HTTP
  // Or we can manually create the data
  
  // Let's create a simple version that uses the provider directly.
  // For 2026, use the full schedule from functions/src/schedule-2026.json.
  const schedule2026 = require("../functions/src/schedule-2026.json");
  const provider = {
    name: "static-fallback-provider",
    async fetchSchedule(seasonYear) {
      if (seasonYear === 2026) {
        return schedule2026;
      }
      return [
        {
          id: `${seasonYear}-daytona-500`,
          name: "Daytona 500",
          track: "Daytona International Speedway",
          weekIndex: 1,
          startTimeIso: `${seasonYear}-02-16T19:30:00.000Z`,
          status: "scheduled",
        },
        {
          id: `${seasonYear}-atlanta`,
          name: "Ambetter Health 400",
          track: "Atlanta Motor Speedway",
          weekIndex: 2,
          startTimeIso: `${seasonYear}-02-23T20:00:00.000Z`,
          status: "scheduled",
        },
        {
          id: `${seasonYear}-las-vegas`,
          name: "Pennzoil 400",
          track: "Las Vegas Motor Speedway",
          weekIndex: 3,
          startTimeIso: `${seasonYear}-03-09T20:30:00.000Z`,
          status: "scheduled",
        },
      ];
    },
    async fetchStandings() {
      return [];
    },
  };

  const leagueSnap = await db.collection("leagues").doc(leagueId).get();
  if (!leagueSnap.exists) {
    throw new Error("League not found");
  }

  const league = leagueSnap.data();
  const seasonYear = league.seasonYear;

  const schedule = await provider.fetchSchedule(seasonYear);

  // Create races
  const raceWrites = schedule.map((race) => {
    const raceId = race.id.replace(/[^a-zA-Z0-9]/g, "-").toLowerCase();
    const startTime = Timestamp.fromDate(new Date(race.startTimeIso));

    return db
      .collection("leagues")
      .doc(leagueId)
      .collection("races")
      .doc(raceId)
      .set(
        {
          name: race.name,
          track: race.track,
          weekIndex: race.weekIndex,
          startTime,
          lockTime: startTime,
          status: race.status || "scheduled",
          providerRaceKey: race.id,
          lastSyncedAt: Timestamp.now(),
        },
        { merge: true }
      );
  });

  await Promise.all(raceWrites);
  console.log(`Created ${schedule.length} races`);
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
