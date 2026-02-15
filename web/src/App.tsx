import { useEffect, useMemo, useRef, useState } from "react";
import {
  collection,
  doc,
  limit,
  orderBy,
  query,
  where,
  type Query,
} from "firebase/firestore";
import { db } from "./lib/firebase";
import {
  leagueDocRef,
  loadMemberships,
  pickDocRef,
  racePointsDocRef,
  savePick,
  setLeagueSettings,
  tierDocRef,
  weeklyScoreDocRef,
  type Membership,
} from "./lib/api";
import type {
  DriverDoc,
  LeagueDoc,
  MemberDoc,
  PickDoc,
  RaceDoc,
  RacePointsDoc,
  SeasonScoreDoc,
  StandingsSnapshotDoc,
  TierDoc,
  WeeklyScoreDoc,
} from "./lib/types";
import { logout, useAuthState } from "./hooks/useAuth";
import { useFirestoreCollection, useFirestoreDocument } from "./hooks/useFirestore";
import { Header } from "./components/Header";
import { AuthView } from "./views/AuthView";
import { LeagueAccessView } from "./views/LeagueAccessView";
import { HomeTab } from "./views/HomeTab";
import { PicksTab } from "./views/PicksTab";
import { StandingsTab } from "./views/StandingsTab";
import { RaceTab } from "./views/RaceTab";
import { AdminTab } from "./views/AdminTab";

type AppTab = "home" | "picks" | "standings" | "race" | "admin";

function toDriversMap(drivers: Array<DriverDoc & { id: string }>): Record<string, DriverDoc> {
  return drivers.reduce<Record<string, DriverDoc>>((acc, driver) => {
    acc[driver.id] = driver;
    return acc;
  }, {});
}

export default function App() {
  const { user, loading: authLoading } = useAuthState();
  const [tab, setTab] = useState<AppTab>("home");

  const [memberships, setMemberships] = useState<Membership[]>([]);
  const [membershipsLoading, setMembershipsLoading] = useState(true);
  const [membershipsError, setMembershipsError] = useState<string | null>(null);
  const [selectedLeagueId, setSelectedLeagueId] = useState<string | null>(null);

  const refreshMemberships = async () => {
    if (!user) {
      setMemberships([]);
      setSelectedLeagueId(null);
      setMembershipsLoading(false);
      return;
    }

    setMembershipsLoading(true);
    setMembershipsError(null);

    try {
      const nextMemberships = await loadMemberships(user.uid);
      setMemberships(nextMemberships);
      if (nextMemberships.length > 0) {
        const hasSelected = nextMemberships.some((membership) => membership.leagueId === selectedLeagueId);
        setSelectedLeagueId(hasSelected ? selectedLeagueId : nextMemberships[0].leagueId);
      } else {
        setSelectedLeagueId(null);
      }
    } catch (error) {
      setMembershipsError((error as Error).message);
    } finally {
      setMembershipsLoading(false);
    }
  };

  useEffect(() => {
    void refreshMemberships();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [user?.uid]);

  const selectedMembership = useMemo(
    () => memberships.find((membership) => membership.leagueId === selectedLeagueId) || null,
    [memberships, selectedLeagueId],
  );

  const leagueState = useFirestoreDocument<LeagueDoc>(
    selectedLeagueId ? leagueDocRef(selectedLeagueId) : null,
  );

  const myMemberState = useFirestoreDocument<MemberDoc>(
    selectedLeagueId && user
      ? doc(db, "leagues", selectedLeagueId, "members", user.uid)
      : null,
  );

  const racesQuery = useMemo<Query | null>(() => {
    if (!selectedLeagueId) {
      return null;
    }
    return query(
      collection(db, "leagues", selectedLeagueId, "races"),
      orderBy("startTime", "asc"),
    );
  }, [selectedLeagueId]);

  const driversQuery = useMemo<Query | null>(() => {
    if (!selectedLeagueId) {
      return null;
    }
    return query(collection(db, "leagues", selectedLeagueId, "drivers"));
  }, [selectedLeagueId]);

  const membersQuery = useMemo<Query | null>(() => {
    if (!selectedLeagueId) {
      return null;
    }
    return query(
      collection(db, "leagues", selectedLeagueId, "members"),
      orderBy("displayName", "asc"),
    );
  }, [selectedLeagueId]);

  const seasonScoresQuery = useMemo<Query | null>(() => {
    if (!selectedLeagueId) {
      return null;
    }
    return query(
      collection(db, "leagues", selectedLeagueId, "seasonScores"),
      orderBy("rank", "asc"),
    );
  }, [selectedLeagueId]);

  const allWeeklyScoresQuery = useMemo<Query | null>(() => {
    if (!selectedLeagueId) return null;
    return query(collection(db, "leagues", selectedLeagueId, "weeklyScores"));
  }, [selectedLeagueId]);

  const latestStandingsSnapshotQuery = useMemo<Query | null>(() => {
    if (!selectedLeagueId) return null;
    return query(
      collection(db, "leagues", selectedLeagueId, "standingsSnapshots"),
      orderBy("asOfDate", "desc"),
      limit(1),
    );
  }, [selectedLeagueId]);

  const racesState = useFirestoreCollection<RaceDoc>(racesQuery);
  const driversState = useFirestoreCollection<DriverDoc>(driversQuery);
  const membersState = useFirestoreCollection<MemberDoc>(membersQuery);
  const seasonScoresState = useFirestoreCollection<SeasonScoreDoc>(seasonScoresQuery);
  const allWeeklyScoresState = useFirestoreCollection<WeeklyScoreDoc>(allWeeklyScoresQuery);
  const latestStandingsState = useFirestoreCollection<StandingsSnapshotDoc>(latestStandingsSnapshotQuery);

  const races = useMemo(
    () => [...racesState.data].sort((a, b) => a.startTime.toMillis() - b.startTime.toMillis()),
    [racesState.data],
  );

  const upcomingRace = useMemo(() => {
    const now = Date.now();
    return (
      races.find(
        (race) => race.status === "scheduled" && race.lockTime.toMillis() > now,
      ) ?? races.find((race) => race.status === "scheduled")
    );
  }, [races]);

  const latestCompletedRace = useMemo(
    () => [...races].reverse().find((race) => race.status === "completed"),
    [races],
  );

  /** Race currently in progress (picks locked, results may be updating). */
  const liveRace = useMemo(
    () => races.find((race) => race.status === "locked") ?? null,
    [races],
  );

  /** Scheduled race whose lock time has already passed (race in progress, may not be "locked" yet). */
  const inProgressScheduledRace = useMemo(() => {
    const now = Date.now();
    return (
      races.find(
        (race) =>
          race.status === "scheduled" && race.lockTime.toMillis() <= now,
      ) ?? null
    );
  }, [races]);

  /**
   * 10pm Eastern on the calendar day after the race start.
   * We keep showing the completed race until this moment.
   * 10pm ET = 03:00 UTC the following day (EST).
   */
  const nextDay10pmETMs = useMemo(() => {
    if (!latestCompletedRace) return 0;
    const d = new Date(latestCompletedRace.startTime.toMillis());
    const year = d.getUTCFullYear();
    const month = d.getUTCMonth();
    const date = d.getUTCDate();
    return Date.UTC(year, month, date + 2, 3, 0, 0, 0);
  }, [latestCompletedRace?.id, latestCompletedRace?.startTime?.toMillis?.()]);

  /** Race we show for picks/Home. Prefer in-progress, then just-completed until 10pm ET next day, then next upcoming. */
  const primaryRace = useMemo(() => {
    if (liveRace) return liveRace;
    if (inProgressScheduledRace) return inProgressScheduledRace;
    const now = Date.now();
    if (
      latestCompletedRace &&
      nextDay10pmETMs > 0 &&
      now < nextDay10pmETMs
    ) {
      return latestCompletedRace;
    }
    return upcomingRace ?? null;
  }, [liveRace, inProgressScheduledRace, latestCompletedRace, upcomingRace, nextDay10pmETMs]);

  /** Race in progress for live UI (locked or scheduled past lock). Used for LIVE section and live data. */
  const effectiveLiveRace = useMemo(
    () => liveRace ?? inProgressScheduledRace ?? null,
    [liveRace, inProgressScheduledRace],
  );

  const [selectedRaceId, setSelectedRaceId] = useState<string | null>(null);
  useEffect(() => {
    const defaultRaceId = primaryRace?.id ?? latestCompletedRace?.id ?? upcomingRace?.id ?? null;
    if (!selectedRaceId) {
      setSelectedRaceId(defaultRaceId);
      return;
    }

    const raceExists = races.some((race) => race.id === selectedRaceId);
    if (!raceExists) {
      setSelectedRaceId(defaultRaceId);
    }
  }, [primaryRace?.id, latestCompletedRace?.id, upcomingRace?.id, races, selectedRaceId]);

  const selectedRace = useMemo(
    () => (selectedRaceId ? (races.find((r) => r.id === selectedRaceId) ?? null) : null),
    [races, selectedRaceId],
  );

  const tierState = useFirestoreDocument<TierDoc>(
    selectedLeagueId && primaryRace ? tierDocRef(selectedLeagueId, primaryRace.id) : null,
  );

  const tiersFromStandingsSnapshot = useMemo((): TierDoc | null => {
    const snapshot = latestStandingsState.data[0] as (StandingsSnapshotDoc & { id: string }) | undefined;
    if (!snapshot?.drivers?.length) return null;
    const ordered = [...snapshot.drivers].sort((a, b) => a.position - b.position);
    const tierA = ordered.filter((e) => e.position >= 1 && e.position <= 10).map((e) => e.driverId);
    const tierB = ordered.filter((e) => e.position >= 11 && e.position <= 20).map((e) => e.driverId);
    const tierC = ordered.filter((e) => e.position >= 21 && e.position <= 30).map((e) => e.driverId);
    if (tierA.length === 0 && tierB.length === 0 && tierC.length === 0) return null;
    return {
      tierA,
      tierB,
      tierC,
      computedFromSnapshotId: snapshot.id ?? "client",
    };
  }, [latestStandingsState.data]);

  const effectiveTiers = tierState.data ?? tiersFromStandingsSnapshot;

  const pickState = useFirestoreDocument<PickDoc>(
    selectedLeagueId && primaryRace && user
      ? pickDocRef(selectedLeagueId, primaryRace.id, user.uid)
      : null,
  );

  const selectedRacePickState = useFirestoreDocument<PickDoc>(
    selectedLeagueId && selectedRaceId && user
      ? pickDocRef(selectedLeagueId, selectedRaceId, user.uid)
      : null,
  );

  const selectedRacePointsState = useFirestoreDocument<RacePointsDoc>(
    selectedLeagueId && selectedRaceId
      ? racePointsDocRef(selectedLeagueId, selectedRaceId)
      : null,
  );

  const selectedRaceScoreState = useFirestoreDocument<WeeklyScoreDoc>(
    selectedLeagueId && selectedRaceId && user
      ? weeklyScoreDocRef(selectedLeagueId, selectedRaceId, user.uid)
      : null,
  );

  const liveRacePointsState = useFirestoreDocument<RacePointsDoc>(
    selectedLeagueId && effectiveLiveRace ? racePointsDocRef(selectedLeagueId, effectiveLiveRace.id) : null,
  );

  /** Primary race's points (so we can show live section when that race has nascar-live data even if not yet "locked"). */
  const primaryRacePointsState = useFirestoreDocument<RacePointsDoc>(
    selectedLeagueId && primaryRace ? racePointsDocRef(selectedLeagueId, primaryRace.id) : null,
  );

  /** Race we treat as live for UI: locked/past-lock race, or primary race when it has live data from NASCAR. */
  const liveRaceForDisplay = useMemo(() => {
    if (effectiveLiveRace) return effectiveLiveRace;
    if (primaryRace && primaryRacePointsState.data?.source === "nascar-live") return primaryRace;
    return null;
  }, [effectiveLiveRace, primaryRace, primaryRacePointsState.data?.source]);

  /** Live race points to show: from the race we're treating as live (may be primary when it has nascar-live data). */
  const liveRacePointsForDisplay = useMemo(() => {
    if (liveRaceForDisplay?.id === effectiveLiveRace?.id) return liveRacePointsState.data;
    if (liveRaceForDisplay?.id === primaryRace?.id) return primaryRacePointsState.data;
    return null;
  }, [liveRaceForDisplay?.id, effectiveLiveRace?.id, primaryRace?.id, liveRacePointsState.data, primaryRacePointsState.data]);

  const liveWeeklyScores = useMemo(() => {
    if (!liveRaceForDisplay) return [];
    return [...allWeeklyScoresState.data]
      .filter((s) => s.raceId === liveRaceForDisplay.id)
      .sort((a, b) => b.weeklyTotal - a.weeklyTotal);
  }, [liveRaceForDisplay?.id, allWeeklyScoresState.data]);

  /** When race is live, map driverId -> current running position for picks UI. */
  const driverPositionByDriverId = useMemo(() => {
    const points = liveRacePointsForDisplay;
    if (!points?.drivers?.length) return {};
    const map: Record<string, number> = {};
    for (const d of points.drivers) {
      if (d.runningPosition != null) map[d.driverId] = d.runningPosition;
    }
    return map;
  }, [liveRacePointsForDisplay]);

  const [selectedRaceIdForWeekly, setSelectedRaceIdForWeekly] = useState<string | null>(null);
  const [selectedSprintIndex, setSelectedSprintIndex] = useState<number>(0);
  const [isWeeklyExpanded, setIsWeeklyExpanded] = useState(false);
  const [isMonthlyExpanded, setIsMonthlyExpanded] = useState(false);
  const [isSeasonExpanded, setIsSeasonExpanded] = useState(false);

  const selectedRaceAdjustmentsQuery = useMemo<Query | null>(() => {
    if (!selectedLeagueId || !selectedRaceId) {
      return null;
    }

    return query(
      collection(db, "leagues", selectedLeagueId, "adjustments"),
      where("raceId", "==", selectedRaceId),
    );
  }, [selectedLeagueId, selectedRaceId]);

  const selectedRaceAdjustmentsState = useFirestoreCollection<{
    driverId: string;
    deltaPoints: number;
    reason: string;
    type: "penalty" | "correction";
  }>(selectedRaceAdjustmentsQuery);

  const monitorRaceId = selectedRaceId ?? primaryRace?.id ?? null;
  const raceMonitorQuery = useMemo<Query | null>(() => {
    if (!selectedLeagueId || !monitorRaceId) {
      return null;
    }

    return query(
      collection(db, "leagues", selectedLeagueId, "picks"),
      where("raceId", "==", monitorRaceId),
      orderBy("updatedAt", "desc"),
    );
  }, [selectedLeagueId, monitorRaceId]);

  const raceMonitorPicksState = useFirestoreCollection<PickDoc>(raceMonitorQuery);

  const driversById = useMemo(() => toDriversMap(driversState.data), [driversState.data]);
  const memberById = useMemo(
    () =>
      membersState.data.reduce<Record<string, MemberDoc>>((acc, member) => {
        acc[member.id] = member;
        return acc;
      }, {}),
    [membersState.data],
  );

  type StandingsRow = { id: string; displayName: string; seasonTotal: number; rank: number };
  const mergedStandingsRows = useMemo((): StandingsRow[] => {
    const scoreIds = new Set(seasonScoresState.data.map((s) => s.id));
    const rows: StandingsRow[] = seasonScoresState.data.map((score) => ({
      id: score.id,
      displayName: memberById[score.id]?.displayName ?? score.id,
      seasonTotal: score.seasonTotal,
      rank: score.rank,
    }));
    // Include members who have no season score yet (e.g. new admin) so they always appear
    membersState.data.forEach((member) => {
      if (!scoreIds.has(member.id)) {
        rows.push({
          id: member.id,
          displayName: member.displayName,
          seasonTotal: 0,
          rank: 0,
        });
      }
    });
    rows.sort((a, b) => {
      if (b.seasonTotal !== a.seasonTotal) return b.seasonTotal - a.seasonTotal;
      return a.displayName.localeCompare(b.displayName);
    });
    return rows.map((row, index) => ({ ...row, rank: index + 1 }));
  }, [
    seasonScoresState.data,
    membersState.data,
    memberById,
  ]);

  const currentRaceIdForWeekly = effectiveLiveRace?.id ?? latestCompletedRace?.id ?? upcomingRace?.id ?? null;
  const effectiveWeeklyRaceId = selectedRaceIdForWeekly ?? currentRaceIdForWeekly;
  const weeklyLeaderboardRows = useMemo((): { rank: number; userId: string; points: number }[] => {
    if (!effectiveWeeklyRaceId) return [];
    const byRace = allWeeklyScoresState.data.filter((s) => s.raceId === effectiveWeeklyRaceId);
    byRace.sort((a, b) => b.weeklyTotal - a.weeklyTotal);
    return byRace.map((s, i) => ({ rank: i + 1, userId: s.userId, points: s.weeklyTotal }));
  }, [allWeeklyScoresState.data, effectiveWeeklyRaceId]);

  const SPRINT_CONFIGS = [
    { name: "February", index: 1, month: 2, payout: "$30" },
    { name: "March", index: 2, month: 3, payout: "$120" },
    { name: "April", index: 3, month: 4, payout: "$120" },
    { name: "May", index: 4, month: 5, payout: "$120" },
    { name: "June", index: 5, month: 6, payout: "$120" },
    { name: "July", index: 6, month: 7, payout: "$120" },
    { name: "August", index: 7, month: 8, payout: "$120" },
  ] as const;
  const raceIdToSprintIndex = useMemo((): Record<string, number> => {
    const map: Record<string, number> = {};
    races.forEach((race) => {
      const month = new Date(race.startTime.toMillis()).getMonth() + 1;
      if (month >= 2 && month <= 8) map[race.id] = month - 1;
    });
    return map;
  }, [races]);
  const currentSprintIndex = useMemo(() => {
    if (!latestCompletedRace) return 1;
    return raceIdToSprintIndex[latestCompletedRace.id] ?? 1;
  }, [latestCompletedRace?.id, raceIdToSprintIndex]);
  const effectiveSprintIndex = selectedSprintIndex === 0 ? currentSprintIndex : selectedSprintIndex;
  const sprintLeaderboardRows = useMemo((): { userId: string; total: number }[] => {
    const config = SPRINT_CONFIGS.find((c) => c.index === effectiveSprintIndex) ?? SPRINT_CONFIGS[0];
    const byUser: Record<string, number> = {};
    allWeeklyScoresState.data.forEach((s) => {
      const sprint = raceIdToSprintIndex[s.raceId];
      if (sprint !== config.index) return;
      byUser[s.userId] = (byUser[s.userId] ?? 0) + s.weeklyTotal;
    });
    return Object.entries(byUser)
      .sort(([, a], [, b]) => b - a)
      .map(([userId, total]) => ({ userId, total }));
  }, [allWeeklyScoresState.data, effectiveSprintIndex, raceIdToSprintIndex]);

  const weeklyRacePickerOptions = useMemo(() => {
    const options: { id: string | null; label: string }[] = [];
    if (currentRaceIdForWeekly) {
      const race = races.find((r) => r.id === currentRaceIdForWeekly);
      if (race) options.push({ id: null, label: `Current (${race.name})` });
    }
    races
      .filter((r) => r.status === "completed")
      .forEach((race) => options.push({ id: race.id, label: race.name }));
    return options;
  }, [races, currentRaceIdForWeekly]);

  const [draftPick, setDraftPick] = useState<{ tierA: string[]; tierB: string[]; tierC: string[] }>({
    tierA: [],
    tierB: [],
    tierC: [],
  });
  const [pickError, setPickError] = useState<string | null>(null);
  const [pickStatus, setPickStatus] = useState("");
  const [pickSaving, setPickSaving] = useState(false);
  const pickDirtyRef = useRef(false);

  useEffect(() => {
    if (!primaryRace) {
      setDraftPick({ tierA: [], tierB: [], tierC: [] });
      pickDirtyRef.current = false;
      return;
    }

    if (pickState.data) {
      if (!pickDirtyRef.current) {
        setDraftPick({
          tierA: pickState.data.tierA,
          tierB: pickState.data.tierB,
          tierC: pickState.data.tierC,
        });
        pickDirtyRef.current = false;
      }
      return;
    }

    setDraftPick({ tierA: [], tierB: [], tierC: [] });
    pickDirtyRef.current = false;
  }, [pickState.data, primaryRace?.id]);

  const isPickLocked =
    !primaryRace ||
    primaryRace.status !== "scheduled" ||
    primaryRace.lockTime.toMillis() <= Date.now();

  const isPickComplete =
    draftPick.tierA.length === 3 &&
    draftPick.tierB.length === 2 &&
    draftPick.tierC.length === 1 &&
    new Set([...draftPick.tierA, ...draftPick.tierB, ...draftPick.tierC]).size === 6;

  const togglePick = (tier: "tierA" | "tierB" | "tierC", driverId: string, limit: number) => {
    setPickError(null);
    setPickStatus("");
    pickDirtyRef.current = true;

    setDraftPick((current) => {
      const nextTierValues = current[tier].includes(driverId)
        ? current[tier].filter((value) => value !== driverId)
        : current[tier].length < limit
          ? [...current[tier], driverId]
          : current[tier];

      return {
        ...current,
        [tier]: nextTierValues,
      };
    });
  };

  useEffect(() => {
    if (
      !pickDirtyRef.current ||
      !isPickComplete ||
      !selectedLeagueId ||
      !primaryRace ||
      isPickLocked ||
      pickSaving
    ) {
      return;
    }
    const allDrivers = [...draftPick.tierA, ...draftPick.tierB, ...draftPick.tierC];
    if (new Set(allDrivers).size !== allDrivers.length) return;

    pickDirtyRef.current = false;
    setPickError(null);
    setPickStatus("");
    setPickSaving(true);
    savePick({
      leagueId: selectedLeagueId,
      raceId: primaryRace.id,
      tierA: draftPick.tierA,
      tierB: draftPick.tierB,
      tierC: draftPick.tierC,
    })
      .then(() => {
        setPickStatus("Picks saved.");
      })
      .catch((err) => {
        setPickError((err as Error).message);
        pickDirtyRef.current = true;
      })
      .finally(() => {
        setPickSaving(false);
      });
  }, [isPickComplete, selectedLeagueId, primaryRace?.id, isPickLocked, pickSaving, draftPick.tierA, draftPick.tierB, draftPick.tierC]);

  const savePickSubmit = async () => {
    if (!selectedLeagueId || !primaryRace) {
      return;
    }

    setPickError(null);
    setPickStatus("");

    const allDrivers = [...draftPick.tierA, ...draftPick.tierB, ...draftPick.tierC];
    if (new Set(allDrivers).size !== allDrivers.length) {
      setPickError("A driver can only be selected once across all tiers.");
      return;
    }

    if (draftPick.tierA.length !== 3 || draftPick.tierB.length !== 2 || draftPick.tierC.length !== 1) {
      setPickError("You must pick exactly 3 Tier A, 2 Tier B, and 1 Tier C drivers.");
      return;
    }

    setPickSaving(true);
    try {
      await savePick({
        leagueId: selectedLeagueId,
        raceId: primaryRace.id,
        ...draftPick,
      });
      setPickStatus("Picks saved.");
      pickDirtyRef.current = false;
    } catch (error) {
      setPickError((error as Error).message);
    } finally {
      setPickSaving(false);
    }
  };

  const [settingsDraft, setSettingsDraft] = useState({
    name: "",
    seasonYear: new Date().getFullYear(),
    payoutConfigText: "",
  });

  useEffect(() => {
    if (!leagueState.data) {
      return;
    }

    setSettingsDraft({
      name: leagueState.data.name,
      seasonYear: leagueState.data.seasonYear,
      payoutConfigText: leagueState.data.payoutConfigText ?? "",
    });
  }, [leagueState.data?.name, leagueState.data?.seasonYear, leagueState.data?.payoutConfigText]);

  const [adminMessage, setAdminMessage] = useState("");
  const [adminError, setAdminError] = useState<string | null>(null);
  const [adminBusy, setAdminBusy] = useState(false);

  const [manualResultsRaceId, setManualResultsRaceId] = useState("");
  const [manualResultsSource, setManualResultsSource] = useState("admin-manual");
  const [manualResultsRows, setManualResultsRows] = useState<
    Array<{ driverId: string; basePoints: number }>
  >([{ driverId: "", basePoints: 0 }]);

  const [adjustmentDraft, setAdjustmentDraft] = useState({
    raceId: "",
    driverId: "",
    type: "penalty" as "penalty" | "correction",
    deltaPoints: -10,
    reason: "",
    source: "admin-manual",
  });

  const [expandedPickUserId, setExpandedPickUserId] = useState<string | null>(null);

  const isAdmin = myMemberState.data?.role === "admin";

  useEffect(() => {
    if (isAdmin || tab !== "admin") {
      return;
    }
    setTab("home");
  }, [isAdmin, tab]);

  if (authLoading) {
    return <main className="loading-view">Loading...</main>;
  }

  if (!user) {
    return <AuthView />;
  }

  if (membershipsLoading) {
    return <main className="loading-view">Loading...</main>;
  }

  if (memberships.length === 0) {
    return (
      <>
        <LeagueAccessView onJoined={refreshMemberships} />
        {membershipsError ? <p className="error-text centered">{membershipsError}</p> : null}
      </>
    );
  }

  const tabTitles: Record<AppTab, string> = {
    home: "Home",
    picks: "Picks",
    standings: "Standings",
    race: "Race",
    admin: "Admin",
  };

  return (
    <div className="app-shell">
      <div className="app-header-strip">
        <Header
          title={tabTitles[tab]}
          memberships={memberships}
          selectedLeagueId={selectedLeagueId}
          onSelectLeague={setSelectedLeagueId}
          onSignOut={() => void logout()}
          payoutConfigText={leagueState.data?.payoutConfigText ?? null}
          inviteCode={leagueState.data?.inviteCode ?? selectedMembership?.league.inviteCode ?? null}
          isAdmin={isAdmin}
        />
        <nav className="tabs" aria-label="Main">
          <button
            type="button"
            className={tab === "home" ? "active" : ""}
            onClick={() => setTab("home")}
          >
            Home
          </button>
          <button
            type="button"
            className={tab === "picks" ? "active" : ""}
            onClick={() => setTab("picks")}
          >
            Picks
          </button>
          <button
            type="button"
            className={tab === "standings" ? "active" : ""}
            onClick={() => setTab("standings")}
          >
            Standings
          </button>
          <button
            type="button"
            className={tab === "race" ? "active" : ""}
            onClick={() => setTab("race")}
          >
            Race
          </button>
          {isAdmin ? (
            <button
              type="button"
              className={tab === "admin" ? "active" : ""}
              onClick={() => setTab("admin")}
            >
              Admin
            </button>
          ) : null}
        </nav>
      </div>

      <main className="content-grid">
        {tab === "home" ? (
          <HomeTab
            primaryRace={primaryRace ?? null}
            upcomingRace={upcomingRace ?? null}
            liveRace={liveRaceForDisplay}
            liveRacePoints={liveRacePointsForDisplay}
            liveWeeklyScores={liveWeeklyScores}
            driverPositionByDriverId={driverPositionByDriverId}
            pickState={pickState}
            driversById={driversById}
            memberById={memberById}
            onOpenPicks={() => setTab("picks")}
          />
        ) : null}

        {tab === "picks" ? (
          <PicksTab
            primaryRace={primaryRace ?? null}
            upcomingRace={upcomingRace ?? null}
            tierState={{ loading: tierState.loading, error: tierState.error ?? undefined }}
            tiersFromStandingsSnapshot={tiersFromStandingsSnapshot}
            latestStandingsState={latestStandingsState}
            effectiveTiers={effectiveTiers}
            draftPick={draftPick}
            togglePick={togglePick}
            isPickLocked={isPickLocked}
            pickError={pickError}
            pickSaving={pickSaving}
            pickStatus={pickStatus}
            savePickSubmit={savePickSubmit}
            driversById={driversById}
            driverPositionByDriverId={driverPositionByDriverId}
          />
        ) : null}

        {tab === "standings" ? (
          <StandingsTab
            seasonScoresLoading={seasonScoresState.loading}
            allWeeklyScoresLoading={allWeeklyScoresState.loading}
            selectedRaceIdForWeekly={selectedRaceIdForWeekly}
            setSelectedRaceIdForWeekly={setSelectedRaceIdForWeekly}
            weeklyRacePickerOptions={weeklyRacePickerOptions}
            weeklyLeaderboardRows={weeklyLeaderboardRows}
            isWeeklyExpanded={isWeeklyExpanded}
            setIsWeeklyExpanded={setIsWeeklyExpanded}
            selectedSprintIndex={selectedSprintIndex}
            setSelectedSprintIndex={setSelectedSprintIndex}
            SPRINT_CONFIGS={SPRINT_CONFIGS}
            currentSprintIndex={currentSprintIndex}
            sprintLeaderboardRows={sprintLeaderboardRows}
            isMonthlyExpanded={isMonthlyExpanded}
            setIsMonthlyExpanded={setIsMonthlyExpanded}
            mergedStandingsRows={mergedStandingsRows}
            isSeasonExpanded={isSeasonExpanded}
            setIsSeasonExpanded={setIsSeasonExpanded}
            memberById={memberById}
            userId={user?.uid}
          />
        ) : null}

        {tab === "race" ? (
          <RaceTab
            races={races}
            selectedRace={selectedRace ?? null}
            selectedRaceId={selectedRaceId}
            setSelectedRaceId={setSelectedRaceId}
            selectedRaceScoreState={selectedRaceScoreState}
            selectedRacePickState={selectedRacePickState}
            driversById={driversById}
            selectedRacePointsState={selectedRacePointsState}
            selectedRaceAdjustmentsState={selectedRaceAdjustmentsState}
          />
        ) : null}

        {tab === "admin" && isAdmin ? (
          <AdminTab
            selectedLeagueId={selectedLeagueId}
            settingsDraft={settingsDraft}
            setSettingsDraft={setSettingsDraft}
            adminBusy={adminBusy}
            setAdminBusy={setAdminBusy}
            setAdminError={setAdminError}
            setAdminMessage={setAdminMessage}
            monitorRaceId={monitorRaceId}
            raceMonitorPicksState={raceMonitorPicksState}
            membersState={membersState}
            expandedPickUserId={expandedPickUserId}
            setExpandedPickUserId={setExpandedPickUserId}
            driversById={driversById}
            races={races}
            manualResultsRaceId={manualResultsRaceId}
            setManualResultsRaceId={setManualResultsRaceId}
            manualResultsSource={manualResultsSource}
            setManualResultsSource={setManualResultsSource}
            manualResultsRows={manualResultsRows}
            setManualResultsRows={setManualResultsRows}
            driversState={driversState}
            adjustmentDraft={adjustmentDraft}
            setAdjustmentDraft={setAdjustmentDraft}
            adminMessage={adminMessage}
            adminError={adminError}
          />
        ) : null}
      </main>

      {(() => {
        const errors = [
          racesState.error,
          driversState.error,
          leagueState.error,
          myMemberState.error,
          seasonScoresState.error,
          allWeeklyScoresState.error,
          tierState.error,
        ].filter(Boolean) as string[];
        return errors.length > 0 ? (
          <footer className="error-footer">
            <ul className="error-footer-list">
              {errors.map((err, i) => (
                <li key={i}>{err}</li>
              ))}
            </ul>
          </footer>
        ) : null;
      })()}
    </div>
  );
}
