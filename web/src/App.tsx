import { useEffect, useMemo, useState } from "react";
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
import { usePickDraft } from "./hooks/usePickDraft";
import { useRaceSelection } from "./hooks/useRaceSelection";
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
    selectedLeagueId && selectedRaceId ? tierDocRef(selectedLeagueId, selectedRaceId) : null,
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
    return effectiveTiers;
  }, [selectedRaceTierState.data, effectiveTiers]);

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
  const selectedRaceWeeklyScores = useMemo(() => {
    if (!selectedRaceId) return [];
    return allWeeklyScoresState.data.filter((s) => s.raceId === selectedRaceId);
  }, [allWeeklyScoresState.data, selectedRaceId]);
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
    () => normalizeRacePointDrivers(liveRacePointsForDisplay),
    [liveRacePointsForDisplay],
  );

  /** When race is live, map driverId -> current running position for picks UI. */
  const driverPositionByDriverId = useMemo(() => {
    const map: Record<string, number> = {};
    for (const d of liveRacePointDriversForDisplay) {
      if (d.runningPosition != null) map[d.driverId] = d.runningPosition;
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
  const primaryRaceAdjustmentsQuery = useMemo<Query | null>(() => {
    if (!selectedLeagueId || !primaryRace) {
      return null;
    }

    return query(
      collection(db, "leagues", selectedLeagueId, "adjustments"),
      where("raceId", "==", primaryRace.id),
    );
  }, [selectedLeagueId, primaryRace?.id]);
  const primaryRaceAdjustmentsState = useFirestoreCollection<{
    driverId: string;
    deltaPoints: number;
  }>(primaryRaceAdjustmentsQuery);
  const primaryRaceDriverPointsByDriverId = useMemo(() => {
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
    primaryRaceAdjustmentsState.data,
    primaryRaceOfficialPointsByDriverId,
    primaryRacePointDrivers,
  ]);

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
  const selectedRacePicksQuery = useMemo<Query | null>(() => {
    if (!selectedLeagueId || !selectedRace || !canReadAllPicksForSelectedRace) {
      return null;
    }

    return query(
      collection(db, "leagues", selectedLeagueId, "picks"),
      where("raceId", "==", selectedRace.id),
    );
  }, [selectedLeagueId, selectedRace?.id, canReadAllPicksForSelectedRace]);
  const selectedRacePicksState = useFirestoreCollection<PickDoc>(selectedRacePicksQuery);

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
  const monitorRacePointsState = useFirestoreDocument<RacePointsDoc>(
    selectedLeagueId && monitorRaceId ? racePointsDocRef(selectedLeagueId, monitorRaceId) : null,
  );
  const monitorRaceAdjustmentsQuery = useMemo<Query | null>(() => {
    if (!selectedLeagueId || !monitorRaceId) {
      return null;
    }

    return query(
      collection(db, "leagues", selectedLeagueId, "adjustments"),
      where("raceId", "==", monitorRaceId),
    );
  }, [selectedLeagueId, monitorRaceId]);
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
    [monitorRaceOfficialResults, driversById],
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
    monitorRaceAdjustmentsState.data,
    monitorRaceOfficialPointsByDriverId,
    monitorRacePointDrivers,
  ]);

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
    const sorted = [...rows].sort((a, b) => {
      if (b.seasonTotal !== a.seasonTotal) return b.seasonTotal - a.seasonTotal;
      return a.displayName.localeCompare(b.displayName);
    });
    return sorted.map((row, index) => ({ ...row, rank: index + 1 }));
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
    const sorted = [...byRace].sort((a, b) => b.weeklyTotal - a.weeklyTotal);
    return sorted.map((s, i) => ({ rank: i + 1, userId: s.userId, points: s.weeklyTotal }));
  }, [allWeeklyScoresState.data, effectiveWeeklyRaceId]);

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
              primaryRace={primaryRace ?? null}
              upcomingRace={upcomingRace ?? null}
              liveRace={liveRaceForDisplay}
              liveRacePoints={liveRacePointsForDisplay}
              liveWeeklyScores={liveWeeklyScores}
              driverPositionByDriverId={driverPositionByDriverId}
              driverPointsByDriverId={primaryRaceDriverPointsByDriverId}
              pickState={pickState}
              driversById={driversById}
              memberById={memberById}
              onOpenPicks={() => setTab("picks")}
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
              raceMonitorPicksState={raceMonitorPicksState}
              monitorRaceDriverPointsByDriverId={monitorRaceDriverPointsByDriverId}
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
