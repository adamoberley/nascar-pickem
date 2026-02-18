/**
 * Discovery-only entry: exports a Proxy so the Firebase CLI can get function
 * names (ownKeys) without loading the heavy bundle. The bundle is required
 * only when an export is actually accessed (at runtime or when CLI reads config).
 */
"use strict";

const FUNCTION_NAMES = [
  "createLeague",
  "joinLeagueByInvite",
  "getLeaguePreviewByInviteCode",
  "upsertPushToken",
  "removePushToken",
  "savePick",
  "computeRaceTiers",
  "manualRefreshData",
  "updateLeagueSettings",
  "updateMemberPaidStatus",
  "manualUpsertRacePoints",
  "syncLiveRaceNow",
  "addAdjustment",
  "lockPicksAtRaceStart",
  "ingestLeagueDataDaily",
  "refreshRaceResults",
  "sendPickReminders",
];

let bundle;

function getBundle() {
  if (!bundle) {
    bundle = require("./index.bundle.js");
  }
  return bundle;
}

module.exports = new Proxy(
  {},
  {
    get(_, name) {
      return getBundle()[name];
    },
    ownKeys() {
      return FUNCTION_NAMES;
    },
    getOwnPropertyDescriptor(_, name) {
      return { enumerable: true, configurable: true };
    },
  }
);
