#!/usr/bin/env node
/**
 * Seed league member names on a league (by invite code).
 * Usage: node scripts/seed-league-names.js <INVITE_CODE>
 *
 * Example: node scripts/seed-league-names.js RUBBIN
 *
 * Credentials: Use one of:
 *   1. gcloud auth application-default login
 *   2. GOOGLE_APPLICATION_CREDENTIALS=/path/to/service-account.json node scripts/seed-league-names.js RUBBIN
 */

const admin = require("firebase-admin");
const path = require("path");
const fs = require("fs");
const { getFirestore } = require("firebase-admin/firestore");

const EXPECTED_NAMES = [
  "Jake Castleman",
  "Nate Roop",
  "Nick Castleman",
  "Derek Brinkman",
  "Brady Ross",
  "Luke Hamman",
  "Sam Smith",
  "Sam Oberley",
  "Sam Mailand",
  "Reid Hoffman",
  "Joe Niemeyer",
  "Cole Gerardot",
  "Martin Lortie",
  "Harrison Smith",
  "Dan Scheumann",
  "Brock Braun",
  "Lukas Sipe",
  "Evan Selking",
  "Cole Bradtmueller",
  "Joel Snider",
];

function getCredentialOptions() {
  const keyPath =
    process.env.GOOGLE_APPLICATION_CREDENTIALS ||
    path.join(process.cwd(), "service-account.json");
  if (fs.existsSync(keyPath)) {
    return { projectId: "nascar-pick-em", credential: admin.credential.cert(require(keyPath)) };
  }
  return { projectId: "nascar-pick-em" };
}

if (admin.apps.length === 0) {
  admin.initializeApp(getCredentialOptions());
}

const db = getFirestore();

async function main() {
  const inviteCode = process.argv[2]?.toUpperCase();
  if (!inviteCode) {
    console.error("Usage: node scripts/seed-league-names.js <INVITE_CODE>");
    process.exit(1);
  }

  const snapshot = await db
    .collection("leagues")
    .where("inviteCode", "==", inviteCode)
    .limit(1)
    .get();

  if (snapshot.empty) {
    console.error(`No league found with invite code: ${inviteCode}`);
    process.exit(1);
  }

  const leagueRef = snapshot.docs[0].ref;
  await leagueRef.update({ memberNames: EXPECTED_NAMES });
  console.log(`Updated league (invite code ${inviteCode}) with ${EXPECTED_NAMES.length} member names.`);
}

const CREDENTIAL_HELP = `
To fix "Could not load the default credentials":

Option A — gcloud (easiest if you use Google Cloud):
  gcloud auth application-default login

Option B — Service account key:
  1. Firebase Console → Project Settings → Service accounts
  2. Generate new private key (JSON)
  3. Save as service-account.json in this project root (gitignored), or set:
     export GOOGLE_APPLICATION_CREDENTIALS=/path/to/your-key.json
  4. Run this script again.
`;

main().catch((err) => {
  const msg = err?.message ?? String(err);
  if (msg.includes("Could not load the default credentials") || msg.includes("credentials")) {
    console.error(msg);
    console.error(CREDENTIAL_HELP);
  } else {
    console.error(err);
  }
  process.exit(1);
});
