import { useEffect, useMemo, useState } from "react";
import {
  collection,
  doc,
  limit,
  orderBy,
  query,
  updateDoc,
  where,
  type Query,
} from "firebase/firestore";
import { db } from "./lib/firebase";
import {
  leagueDocRef,
  loadMemberships,
  pickDocRef,
  racePointsDocRef,
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
  UserNotificationDoc,
  WeeklyScoreDoc,
} from "./lib/types";
import { logout, useAuthState } from "./hooks/useAuth";
import { useFirestoreCollection, useFirestoreDocument } from "./hooks/useFirestore";
import { usePickDraft } from "./hooks/usePickDraft";
import { useRaceSelection } from "./hooks/useRaceSelection";
import { useStandingsData } from "./hooks/useStandingsData";
import { Header } from "./components/Header";
import { AuthView } from "./views/AuthView";
import { LeagueAccessView } from "./views/LeagueAccessView";
import { HomeTab } from "./views/HomeTab";
import { PicksTab } from "./views/PicksTab";
import { StandingsTab } from "./views/StandingsTab";
import { RaceTab } from "./views/RaceTab";
import { AdminTab } from "./views/AdminTab";
import { SPRINT_CONFIGS } from "./lib/sprint-config";
import {
  buildDriverPointsByDriverId,
  mapOfficialResultsToDriverPoints,
  normalizeOfficialRaceResults,
  normalizeRacePointDrivers,
} from "./lib/race-points";

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
  const [homeNowMs, setHomeNowMs] = useState(() => Date.now());

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
  const isAdmin = myMemberState.data?.role === "admin";

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

  const racePointsSummaryQuery = useMemo<Query | null>(() => {
    if (!selectedLeagueId) {
      return null;
    }
    return query(collection(db, "leagues", selectedLeagueId, "racePoints"));
  }, [selectedLeagueId]);

  const allWeeklyScoresQuery = useMemo<Query | null>(() => {
    if (!selectedLeagueId || tab !== "standings") return null;
    return query(collection(db, "leagues", selectedLeagueId, "weeklyScores"));
  }, [selectedLeagueId, tab]);

  const latestStandingsSnapshotQuery = useMemo<Query | null>(() => {
    if (!selectedLeagueId) return null;
    return query(
      collection(db, "leagues", selectedLeagueId, "standingsSnapshots"),
      orderBy("asOfDate", "desc"),
      limit(1),
    );
  }, [selectedLeagueId]);

  const notificationsQuery = useMemo<Query | null>(() => {
    if (!user) return null;
    return query(
      collection(db, "users", user.uid, "notifications"),
      orderBy("createdAt", "desc"),
      limit(10),
    );
  }, [user?.uid]);

  const racesState = useFirestoreCollection<RaceDoc>(racesQuery);
  const driversState = useFirestoreCollection<DriverDoc>(driversQuery);
  const membersState = useFirestoreCollection<MemberDoc>(membersQuery);
  const seasonScoresState = useFirestoreCollection<SeasonScoreDoc>(seasonScoresQuery);
  const racePointsSummaryState = useFirestoreCollection<RacePointsDoc>(racePointsSummaryQuery);
  const allWeeklyScoresState = useFirestoreCollection<WeeklyScoreDoc>(allWeeklyScoresQuery);
  const latestStandingsState = useFirestoreCollection<StandingsSnapshotDoc>(latestStandingsSnapshotQuery);
  const notificationsState = useFirestoreCollection<UserNotificationDoc>(notificationsQuery);
  const unreadNotifications = useMemo(
    () => notificationsState.data.filter((item) => !item.readAt),
    [notificationsState.data],
  );

  const races = useMemo(
    () => [...racesState.data].sort((a, b) => a.startTime.toMillis() - b.startTime.toMillis()),
    [racesState.data],
  );

  const {
    upcomingRace,
    latestCompletedRace,
    liveRace,
    primaryRace,
    effectiveLiveRace,
    selectedRaceId,
    setSelectedRaceId,
    selectedRace,
    canReadAllPicksForSelectedRace,
  } = useRaceSelection(races, isAdmin);

  const selectedRaceTierState = useFirestoreDocument<TierDoc>(
    tab === "race" && selectedLeagueId && selectedRaceId
      ? tierDocRef(selectedLeagueId, selectedRaceId)
      : null,
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
  const selectedRaceEffectiveTiers = useMemo((): TierDoc | null => {
    if (selectedRaceTierState.data) return selectedRaceTierState.data;
    // Do not reuse the current race tiers for arbitrary historical/future race views.
    return null;
  }, [selectedRaceTierState.data]);

  const pickState = useFirestoreDocument<PickDoc>(
    selectedLeagueId && primaryRace && user
      ? pickDocRef(selectedLeagueId, primaryRace.id, user.uid)
      : null,
  );

  const selectedRacePickState = useFirestoreDocument<PickDoc>(
    tab === "race" && selectedLeagueId && selectedRaceId && user
      ? pickDocRef(selectedLeagueId, selectedRaceId, user.uid)
      : null,
  );

  const selectedRacePointsState = useFirestoreDocument<RacePointsDoc>(
    tab === "race" && selectedLeagueId && selectedRaceId
      ? racePointsDocRef(selectedLeagueId, selectedRaceId)
      : null,
  );

  const selectedRaceScoreState = useFirestoreDocument<WeeklyScoreDoc>(
    tab === "race" && selectedLeagueId && selectedRaceId && user
      ? weeklyScoreDocRef(selectedLeagueId, selectedRaceId, user.uid)
      : null,
  );

  /** Primary race's points doc. */
  const primaryRacePointsState = useFirestoreDocument<RacePointsDoc>(
    selectedLeagueId && primaryRace ? racePointsDocRef(selectedLeagueId, primaryRace.id) : null,
  );

  /** Race we treat as live for UI: locked or past-lock race only. */
  const liveRaceForDisplay = useMemo(() => effectiveLiveRace, [effectiveLiveRace]);
  /** Race we show on Home: live/in-progress first, then just-completed, then next upcoming. */
  const homeRaceForDisplay = useMemo(() => primaryRace ?? null, [primaryRace]);

  /** Home race points to show for the currently displayed home race. */
  const homeRacePointsForDisplay = useMemo(() => {
    if (!homeRaceForDisplay) return null;
    return primaryRacePointsState.data;
  }, [homeRaceForDisplay, primaryRacePointsState.data]);

  const liveWeeklyScoresQuery = useMemo<Query | null>(() => {
    if (tab !== "home" || !selectedLeagueId || !homeRaceForDisplay) return null;
    return query(
      collection(db, "leagues", selectedLeagueId, "weeklyScores"),
      where("raceId", "==", homeRaceForDisplay.id),
      orderBy("weeklyTotal", "desc"),
    );
  }, [homeRaceForDisplay?.id, selectedLeagueId, tab]);
  const liveWeeklyScoresState = useFirestoreCollection<WeeklyScoreDoc>(liveWeeklyScoresQuery);
  const liveWeeklyScores = useMemo(
    () => liveWeeklyScoresState.data,
    [liveWeeklyScoresState.data],
  );
  const homeRaceStartMs = homeRaceForDisplay?.startTime?.toMillis?.() ?? 0;
  useEffect(() => {
    if (
      tab !== "home" ||
      !homeRaceForDisplay ||
      homeRaceForDisplay.status === "completed" ||
      homeRaceStartMs <= 0
    ) {
      return;
    }

    setHomeNowMs(Date.now());
    if (homeRaceStartMs <= Date.now()) {
      return;
    }
    const intervalId = window.setInterval(() => {
      setHomeNowMs(Date.now());
    }, 1000);
    return () => window.clearInterval(intervalId);
  }, [homeRaceForDisplay?.id, homeRaceForDisplay?.status, homeRaceStartMs, tab]);
  const canSeeAllLiveRacePicks = useMemo(() => {
    if (!homeRaceForDisplay) return false;
    if (homeRaceForDisplay.status === "completed") return true;
    return homeRaceStartMs > 0 && homeRaceStartMs <= homeNowMs;
  }, [homeNowMs, homeRaceForDisplay?.id, homeRaceForDisplay?.status, homeRaceStartMs]);
  const liveRacePicksQuery = useMemo<Query | null>(() => {
    if (
      tab !== "home" ||
      !selectedLeagueId ||
      !homeRaceForDisplay ||
      !canSeeAllLiveRacePicks
    ) {
      return null;
    }

    return query(
      collection(db, "leagues", selectedLeagueId, "picks"),
      where("raceId", "==", homeRaceForDisplay.id),
    );
  }, [canSeeAllLiveRacePicks, homeRaceForDisplay?.id, selectedLeagueId, tab]);
  const liveRacePicksState = useFirestoreCollection<PickDoc>(liveRacePicksQuery);

  const selectedRaceWeeklyScoresQuery = useMemo<Query | null>(() => {
    if (tab !== "race" || !selectedLeagueId || !selectedRaceId) return null;
    return query(
      collection(db, "leagues", selectedLeagueId, "weeklyScores"),
      where("raceId", "==", selectedRaceId),
      orderBy("weeklyTotal", "desc"),
    );
  }, [selectedLeagueId, selectedRaceId, tab]);
  const selectedRaceWeeklyScoresState = useFirestoreCollection<WeeklyScoreDoc>(
    selectedRaceWeeklyScoresQuery,
  );
  const selectedRaceWeeklyScores = useMemo(
    () => selectedRaceWeeklyScoresState.data,
    [selectedRaceWeeklyScoresState.data],
  );
  const driversById = useMemo(() => toDriversMap(driversState.data), [driversState.data]);
  const memberById = useMemo(
    () =>
      membersState.data.reduce<Record<string, MemberDoc>>((acc, member) => {
        acc[member.id] = member;
        return acc;
      }, {}),
    [membersState.data],
  );
  const liveRacePointDriversForDisplay = useMemo(
    () => normalizeRacePointDrivers(homeRacePointsForDisplay),
    [homeRacePointsForDisplay],
  );

  /** On home race, map driverId -> finish position (preferred) or running position. */
  const driverPositionByDriverId = useMemo(() => {
    const map: Record<string, number> = {};
    for (const d of liveRacePointDriversForDisplay) {
      if (d.finishPosition != null) {
        map[d.driverId] = d.finishPosition;
        continue;
      }
      if (d.runningPosition != null) {
        map[d.driverId] = d.runningPosition;
      }
    }
    return map;
  }, [liveRacePointDriversForDisplay]);
  const primaryRacePointDrivers = useMemo(
    () => normalizeRacePointDrivers(primaryRacePointsState.data),
    [primaryRacePointsState.data],
  );
  const primaryRaceOfficialResults = useMemo(
    () => normalizeOfficialRaceResults(primaryRacePointsState.data),
    [primaryRacePointsState.data],
  );
  const primaryRaceOfficialPointsByDriverId = useMemo(
    () => mapOfficialResultsToDriverPoints(primaryRaceOfficialResults, driversById),
    [primaryRaceOfficialResults, driversById],
  );
  const primaryRaceLockMs = primaryRace?.lockTime?.toMillis?.() ?? Number.POSITIVE_INFINITY;
  const primaryRaceHasLockedOrStarted = useMemo(() => {
    if (!primaryRace) return false;
    if (primaryRace.status === "locked" || primaryRace.status === "completed") return true;
    return primaryRaceLockMs <= Date.now();
  }, [primaryRace?.id, primaryRace?.status, primaryRaceLockMs]);
  const primaryRaceAdjustmentsQuery = useMemo<Query | null>(() => {
    if (!selectedLeagueId || !primaryRace || !primaryRaceHasLockedOrStarted) {
      return null;
    }

    return query(
      collection(db, "leagues", selectedLeagueId, "adjustments"),
      where("raceId", "==", primaryRace.id),
    );
  }, [selectedLeagueId, primaryRace?.id, primaryRaceHasLockedOrStarted]);
  const primaryRaceAdjustmentsState = useFirestoreCollection<{
    driverId: string;
    deltaPoints: number;
  }>(primaryRaceAdjustmentsQuery);
  const primaryRaceDriverPointsByDriverId = useMemo(() => {
    if (!primaryRaceHasLockedOrStarted) return {};
    const map = buildDriverPointsByDriverId(primaryRacePointDrivers, driversById);
    for (const [driverId, points] of Object.entries(primaryRaceOfficialPointsByDriverId)) {
      if (map[driverId] == null) {
        map[driverId] = points;
      }
    }
    for (const adjustment of primaryRaceAdjustmentsState.data) {
      map[adjustment.driverId] =
        (map[adjustment.driverId] ?? 0) + adjustment.deltaPoints;
    }
    return map;
  }, [
    driversById,
    primaryRaceHasLockedOrStarted,
    primaryRaceAdjustmentsState.data,
    primaryRaceOfficialPointsByDriverId,
    primaryRacePointDrivers,
  ]);

  const [selectedRaceIdForWeekly, setSelectedRaceIdForWeekly] = useState<string | null>(null);
  const [selectedSprintIndex, setSelectedSprintIndex] = useState<number>(0);
  const [isWeeklyExpanded, setIsWeeklyExpanded] = useState(false);
  const [isMonthlyExpanded, setIsMonthlyExpanded] = useState(false);
  const [isSeasonExpanded, setIsSeasonExpanded] = useState(false);
  const [monitorRaceId, setMonitorRaceId] = useState<string | null>(null);

  useEffect(() => {
    setMonitorRaceId(null);
  }, [selectedLeagueId]);

  useEffect(() => {
    const defaultRaceId = primaryRace?.id ?? latestCompletedRace?.id ?? upcomingRace?.id ?? null;
    if (!monitorRaceId) {
      setMonitorRaceId(defaultRaceId);
      return;
    }

    const raceExists = races.some((race) => race.id === monitorRaceId);
    if (!raceExists) {
      setMonitorRaceId(defaultRaceId);
    }
  }, [
    latestCompletedRace?.id,
    monitorRaceId,
    primaryRace?.id,
    races,
    upcomingRace?.id,
  ]);

  const selectedRaceAdjustmentsQuery = useMemo<Query | null>(() => {
    if (tab !== "race" || !selectedLeagueId || !selectedRaceId) {
      return null;
    }

    return query(
      collection(db, "leagues", selectedLeagueId, "adjustments"),
      where("raceId", "==", selectedRaceId),
    );
  }, [selectedLeagueId, selectedRaceId, tab]);

  const selectedRaceAdjustmentsState = useFirestoreCollection<{
    driverId: string;
    deltaPoints: number;
    reason: string;
    type: "penalty" | "correction";
  }>(selectedRaceAdjustmentsQuery);
  const selectedRacePicksQuery = useMemo<Query | null>(() => {
    if (
      tab !== "race" ||
      !selectedLeagueId ||
      !selectedRace ||
      !canReadAllPicksForSelectedRace
    ) {
      return null;
    }

    return query(
      collection(db, "leagues", selectedLeagueId, "picks"),
      where("raceId", "==", selectedRace.id),
    );
  }, [selectedLeagueId, selectedRace?.id, canReadAllPicksForSelectedRace, tab]);
  const selectedRacePicksState = useFirestoreCollection<PickDoc>(selectedRacePicksQuery);

  const raceMonitorQuery = useMemo<Query | null>(() => {
    if (!selectedLeagueId || !monitorRaceId || !isAdmin || tab !== "admin") {
      return null;
    }

    return query(
      collection(db, "leagues", selectedLeagueId, "picks"),
      where("raceId", "==", monitorRaceId),
      orderBy("updatedAt", "desc"),
    );
  }, [isAdmin, selectedLeagueId, monitorRaceId, tab]);

  const raceMonitorPicksState = useFirestoreCollection<PickDoc>(raceMonitorQuery);
  const monitorRacePointsState = useFirestoreDocument<RacePointsDoc>(
    selectedLeagueId && isAdmin && tab === "admin" && monitorRaceId
      ? racePointsDocRef(selectedLeagueId, monitorRaceId)
      : null,
  );
  const monitorRaceAdjustmentsQuery = useMemo<Query | null>(() => {
    if (!selectedLeagueId || !isAdmin || tab !== "admin" || !monitorRaceId) {
      return null;
    }

    return query(
      collection(db, "leagues", selectedLeagueId, "adjustments"),
      where("raceId", "==", monitorRaceId),
    );
  }, [isAdmin, monitorRaceId, selectedLeagueId, tab]);
  const monitorRaceAdjustmentsState = useFirestoreCollection<{
    driverId: string;
    deltaPoints: number;
  }>(monitorRaceAdjustmentsQuery);
  const monitorRacePointDrivers = useMemo(
    () => normalizeRacePointDrivers(monitorRacePointsState.data),
    [monitorRacePointsState.data],
  );
  const monitorRaceOfficialResults = useMemo(
    () => normalizeOfficialRaceResults(monitorRacePointsState.data),
    [monitorRacePointsState.data],
  );
  const monitorRaceOfficialPointsByDriverId = useMemo(
    () => mapOfficialResultsToDriverPoints(monitorRaceOfficialResults, driversById),
    [driversById, monitorRaceOfficialResults],
  );
  const monitorRaceDriverPointsByDriverId = useMemo(() => {
    const map = buildDriverPointsByDriverId(monitorRacePointDrivers, driversById);
    for (const [driverId, points] of Object.entries(monitorRaceOfficialPointsByDriverId)) {
      if (map[driverId] == null) {
        map[driverId] = points;
      }
    }
    for (const adjustment of monitorRaceAdjustmentsState.data) {
      map[adjustment.driverId] =
        (map[adjustment.driverId] ?? 0) + adjustment.deltaPoints;
    }
    return map;
  }, [
    driversById,
    monitorRaceAdjustmentsState.data,
    monitorRaceOfficialPointsByDriverId,
    monitorRacePointDrivers,
  ]);
  const monitorRaceDriverPositionByDriverId = useMemo(() => {
    const map: Record<string, number> = {};
    for (const d of monitorRacePointDrivers) {
      if (d.runningPosition != null) map[d.driverId] = d.runningPosition;
    }
    return map;
  }, [monitorRacePointDrivers]);

  const {
    mergedStandingsRows,
    weeklyLeaderboardRows,
    sprintLeaderboardRows,
    weeklyRacePickerOptions,
    currentSprintIndex,
  } = useStandingsData({
    seasonScores: seasonScoresState.data,
    members: membersState.data,
    memberById,
    allWeeklyScores: allWeeklyScoresState.data,
    races,
    effectiveLiveRaceId: effectiveLiveRace?.id ?? null,
    latestCompletedRaceId: latestCompletedRace?.id ?? null,
    upcomingRaceId: upcomingRace?.id ?? null,
    selectedRaceIdForWeekly,
    selectedSprintIndex,
    sprintConfigs: SPRINT_CONFIGS,
  });

  const {
    draftPick,
    isPickLocked,
    pickError,
    pickStatus,
    pickSaving,
    togglePick,
    savePickSubmit,
  } = usePickDraft({
    selectedLeagueId,
    primaryRace: primaryRace ?? null,
    pickDoc: pickState.data,
  });

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

  const [adjustmentDraft, setAdjustmentDraft] = useState({
    raceId: "",
    driverId: "",
    type: "penalty" as "penalty" | "correction",
    deltaPoints: -10,
    reason: "",
    source: "admin-manual",
  });

  const [expandedPickUserId, setExpandedPickUserId] = useState<string | null>(null);

  const markNotificationRead = async (notificationId: string) => {
    if (!user) return;
    await updateDoc(doc(db, "users", user.uid, "notifications", notificationId), {
      readAt: new Date(),
    });
  };

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
        <nav className="tabs" aria-label="Main" role="tablist">
          <button
            id="tab-home"
            type="button"
            role="tab"
            aria-selected={tab === "home"}
            aria-controls="panel-home"
            className={tab === "home" ? "active" : ""}
            onClick={() => setTab("home")}
          >
            Home
          </button>
          <button
            id="tab-picks"
            type="button"
            role="tab"
            aria-selected={tab === "picks"}
            aria-controls="panel-picks"
            className={tab === "picks" ? "active" : ""}
            onClick={() => setTab("picks")}
          >
            Picks
          </button>
          <button
            id="tab-standings"
            type="button"
            role="tab"
            aria-selected={tab === "standings"}
            aria-controls="panel-standings"
            className={tab === "standings" ? "active" : ""}
            onClick={() => setTab("standings")}
          >
            Standings
          </button>
          <button
            id="tab-race"
            type="button"
            role="tab"
            aria-selected={tab === "race"}
            aria-controls="panel-race"
            className={tab === "race" ? "active" : ""}
            onClick={() => setTab("race")}
          >
            Race
          </button>
          {isAdmin ? (
            <button
              id="tab-admin"
              type="button"
              role="tab"
              aria-selected={tab === "admin"}
              aria-controls="panel-admin"
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
          <div id="panel-home" role="tabpanel" aria-labelledby="tab-home">
            <HomeTab
              selectedLeagueId={selectedLeagueId}
              userId={user?.uid ?? null}
              primaryRace={primaryRace ?? null}
              liveRace={liveRaceForDisplay}
              liveRacePoints={homeRacePointsForDisplay}
              liveWeeklyScores={liveWeeklyScores}
              liveRacePicksState={liveRacePicksState}
              canSeeAllLiveRacePicks={canSeeAllLiveRacePicks}
              driverPositionByDriverId={driverPositionByDriverId}
              driverPointsByDriverId={primaryRaceDriverPointsByDriverId}
              pickState={pickState}
              driversById={driversById}
              memberById={memberById}
              onOpenPicks={() => setTab("picks")}
              notifications={unreadNotifications}
              onMarkNotificationRead={(id) => void markNotificationRead(id)}
            />
          </div>
        ) : null}

        {tab === "picks" ? (
          <div id="panel-picks" role="tabpanel" aria-labelledby="tab-picks">
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
              driverPointsByDriverId={primaryRaceDriverPointsByDriverId}
            />
          </div>
        ) : null}

        {tab === "standings" ? (
          <div id="panel-standings" role="tabpanel" aria-labelledby="tab-standings">
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
          </div>
        ) : null}

        {tab === "race" ? (
          <div id="panel-race" role="tabpanel" aria-labelledby="tab-race">
            <RaceTab
              races={races}
              selectedRace={selectedRace ?? null}
              selectedRaceId={selectedRaceId}
              setSelectedRaceId={setSelectedRaceId}
              selectedRaceTiers={selectedRaceEffectiveTiers}
              selectedRaceScoreState={selectedRaceScoreState}
              selectedRacePickState={selectedRacePickState}
              driversById={driversById}
              selectedRacePointsState={selectedRacePointsState}
              selectedRaceAdjustmentsState={selectedRaceAdjustmentsState}
              selectedRacePicksState={selectedRacePicksState}
              selectedRaceWeeklyScores={selectedRaceWeeklyScores}
              memberById={memberById}
              canSeeAllPicks={canReadAllPicksForSelectedRace}
            />
          </div>
        ) : null}

        {tab === "admin" && isAdmin ? (
          <div id="panel-admin" role="tabpanel" aria-labelledby="tab-admin">
            <AdminTab
              selectedLeagueId={selectedLeagueId}
              settingsDraft={settingsDraft}
              setSettingsDraft={setSettingsDraft}
              adminBusy={adminBusy}
              setAdminBusy={setAdminBusy}
              setAdminError={setAdminError}
              setAdminMessage={setAdminMessage}
              monitorRaceId={monitorRaceId}
              setMonitorRaceId={setMonitorRaceId}
              raceMonitorPicksState={raceMonitorPicksState}
              membersState={membersState}
              expandedPickUserId={expandedPickUserId}
              setExpandedPickUserId={setExpandedPickUserId}
              driversById={driversById}
              races={races}
              driversState={driversState}
              driverPositionByDriverId={monitorRaceDriverPositionByDriverId}
              driverPointsByDriverId={monitorRaceDriverPointsByDriverId}
              adjustmentDraft={adjustmentDraft}
              setAdjustmentDraft={setAdjustmentDraft}
              adminMessage={adminMessage}
              adminError={adminError}
            />
          </div>
        ) : null}
      </main>

      {(() => {
        const errors = [
          racesState.error,
          driversState.error,
          leagueState.error,
          myMemberState.error,
          seasonScoresState.error,
          racePointsSummaryState.error,
          allWeeklyScoresState.error,
          liveWeeklyScoresState.error,
          liveRacePicksState.error,
          selectedRaceWeeklyScoresState.error,
          selectedRacePicksState.error,
          raceMonitorPicksState.error,
          tierState.error,
          notificationsState.error,
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
