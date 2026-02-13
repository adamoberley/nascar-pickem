#!/usr/bin/env node
/**
 * Copy .env.example to .env if .env doesn't exist, then remind to fill in values.
 */
const fs = require("fs");
const path = require("path");

const root = path.resolve(__dirname, "..");
const envPath = path.join(root, ".env");
const examplePath = path.join(root, ".env.example");

if (!fs.existsSync(examplePath)) {
  console.error(".env.example not found");
  process.exit(1);
}

if (fs.existsSync(envPath)) {
  console.log("✓ .env already exists");
  process.exit(0);
}

fs.copyFileSync(examplePath, envPath);
console.log("✓ Created .env from .env.example");
console.log("");
console.log("Next: Edit .env and add your Firebase config from Firebase Console → Project settings → Your apps (web).");
console.log("Required: VITE_FIREBASE_API_KEY, VITE_FIREBASE_AUTH_DOMAIN, VITE_FIREBASE_PROJECT_ID, VITE_FIREBASE_APP_ID");
