import { FormEvent, useEffect, useMemo, useRef, useState } from "react";
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
  addAdjustment,
  createLeague,
  getLeaguePreviewByInviteCode,
  joinLeagueByInvite,
  leagueDocRef,
  loadMemberships,
  manualRefreshData,
  manualUpsertRacePoints,
  pickDocRef,
  raceDocRef,
  racePointsDocRef,
  savePick,
  setLeagueSettings,
  setMemberPaidStatus,
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
import {
  logout,
  signInPassword,
  signUpPassword,
  useAuthState,
} from "./hooks/useAuth";
import { useFirestoreCollection, useFirestoreDocument } from "./hooks/useFirestore";
import { CountdownChip } from "./components/CountdownChip";
import { Header } from "./components/Header";
import { TierBucket } from "./components/TierBucket";

type AppTab = "home" | "picks" | "standings" | "race" | "admin";

function toDriversMap(drivers: Array<DriverDoc & { id: string }>): Record<string, DriverDoc> {
  return drivers.reduce<Record<string, DriverDoc>>((acc, driver) => {
    acc[driver.id] = driver;
    return acc;
  }, {});
}

function formatDate(isoMs: number): string {
  return new Intl.DateTimeFormat("en-US", {
    weekday: "short",
    month: "short",
    day: "numeric",
    hour: "numeric",
    minute: "2-digit",
  }).format(new Date(isoMs));
}

function PicksTierSummary({
  title,
  limit,
  driverIds,
  driversById,
  tierColor,
}: {
  title: string;
  limit: number;
  driverIds: string[];
  driversById: Record<string, DriverDoc>;
  tierColor: "yellow" | "red" | "blue";
}) {
  return (
    <div className={`picks-tier-summary picks-tier-summary--${tierColor}`}>
      <div className="picks-tier-summary-head">
        <span className="section-title-small">{title}</span>
        <span className="picks-tier-count">{driverIds.length}/{limit}</span>
      </div>
      <div className="picks-tier-summary-rows">
        {driverIds.map((driverId) => {
          const driver = driversById[driverId];
          return (
            <div key={driverId} className="picks-tier-summary-row">
              <span className="driver-line">
                #{driver?.number ?? "--"} {driver?.name ?? driverId}
                {driver?.team ? <span className="driver-team">{driver.team}</span> : null}
              </span>
              <span className="check-icon" aria-hidden>✓</span>
            </div>
          );
        })}
      </div>
    </div>
  );
}

function AuthView() {
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [isSignUpMode, setIsSignUpMode] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const onSubmit = async (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    setError(null);
    setBusy(true);

    try {
      if (isSignUpMode) {
        await signUpPassword(email, password);
      } else {
        await signInPassword(email, password);
      }
    } catch (err) {
      setError((err as Error).message);
    } finally {
      setBusy(false);
    }
  };

  return (
    <main className="auth-layout">
      <section className="auth-panel">
        <p className="auth-kicker">NASCAR PICK&apos;EM</p>
        <h1>{isSignUpMode ? "Create Account" : "Sign In"}</h1>

        <form onSubmit={onSubmit} className="stack-form auth-form">
          <label htmlFor="auth-email">Email</label>
          <input
            id="auth-email"
            value={email}
            onChange={(event) => setEmail(event.target.value)}
            placeholder="you@example.com"
            type="email"
            autoComplete="email"
            disabled={busy}
            required
          />
          <label htmlFor="auth-password">Password</label>
          <input
            id="auth-password"
            value={password}
            onChange={(event) => setPassword(event.target.value)}
            placeholder={isSignUpMode ? "At least 6 characters" : "Your password"}
            type="password"
            autoComplete={isSignUpMode ? "new-password" : "current-password"}
            minLength={isSignUpMode ? 6 : undefined}
            disabled={busy}
            required
          />
          <button type="submit" className="auth-primary-button" disabled={busy}>
            {busy ? "Working..." : isSignUpMode ? "Create Account" : "Sign In"}
          </button>
          <button
            type="button"
            className="auth-mode-toggle"
            onClick={() => setIsSignUpMode((current) => !current)}
            disabled={busy}
          >
            {isSignUpMode ? "Already have an account? Sign in" : "Need an account? Create one"}
          </button>
        </form>

        {error ? <p className="error-text">{error}</p> : null}
      </section>
    </main>
  );
}

function LeagueAccessView({
  onJoined,
}: {
  onJoined: () => Promise<void>;
}) {
  const [displayName, setDisplayName] = useState("");
  const [inviteCode, setInviteCode] = useState("");
  const [expectedNames, setExpectedNames] = useState<string[]>([]);
  const [leaguePreviewLoading, setLeaguePreviewLoading] = useState(false);
  const [selectedNameOption, setSelectedNameOption] = useState<string>("");

  const [leagueName, setLeagueName] = useState("");
  const [seasonYear, setSeasonYear] = useState(new Date().getFullYear());
  const [newInviteCode, setNewInviteCode] = useState("");
  const [payoutConfigText, setPayoutConfigText] = useState("");

  const [busy, setBusy] = useState(false);
  const [message, setMessage] = useState("");
  const [error, setError] = useState<string | null>(null);

  const effectiveDisplayName =
    expectedNames.length > 0 ? selectedNameOption : displayName.trim();

  useEffect(() => {
    const code = inviteCode.trim().toUpperCase();
    if (code.length < 2) {
      setExpectedNames([]);
      setSelectedNameOption("");
      return;
    }
    let cancelled = false;
    setLeaguePreviewLoading(true);
      getLeaguePreviewByInviteCode(code)
      .then((preview) => {
        if (!cancelled) {
          setExpectedNames(preview.memberNames ?? []);
          setSelectedNameOption("");
        }
      })
      .catch(() => {
        if (!cancelled) setExpectedNames([]);
      })
      .finally(() => {
        if (!cancelled) setLeaguePreviewLoading(false);
      });
    return () => {
      cancelled = true;
    };
  }, [inviteCode]);

  const onJoin = async (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    setBusy(true);
    setMessage("");
    setError(null);

    try {
      await joinLeagueByInvite({
        inviteCode,
        displayName: effectiveDisplayName.trim(),
      });
      setMessage("Joined league successfully.");
      await new Promise((resolve) => setTimeout(resolve, 2000));
      await onJoined();
    } catch (err) {
      console.error("❌ Error joining league:", err);
      setError((err as Error).message);
    } finally {
      setBusy(false);
    }
  };

  const onCreateLeague = async (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    setBusy(true);
    setMessage("");
    setError(null);

    try {
      const response = await createLeague({
        name: leagueName,
        seasonYear,
        inviteCode: newInviteCode,
        payoutConfigText,
      });
      setMessage(`League created with invite code ${response.inviteCode}.`);
      await onJoined();
    } catch (err) {
      setError((err as Error).message);
    } finally {
      setBusy(false);
    }
  };

  return (
    <main className="setup-layout">
      <section className="setup-panel">
        <h2>JOIN LEAGUE</h2>
        <p className="setup-description">
          Use your invite code to connect to an existing NASCAR Pick&apos;Em league.
        </p>
        <form onSubmit={onJoin} className="stack-form">
          <label htmlFor="invite-code">Invite Code</label>
          <input
            id="invite-code"
            value={inviteCode}
            onChange={(event) => setInviteCode(event.target.value.toUpperCase())}
            placeholder="RACER-2026"
            required
          />
          {expectedNames.length > 0 ? (
            <>
              <label htmlFor="name-option">Your name</label>
              <select
                id="name-option"
                value={selectedNameOption}
                onChange={(e) => setSelectedNameOption(e.target.value)}
                required
              >
                <option value="">— Select your name —</option>
                {expectedNames.map((name) => (
                  <option key={name} value={name}>
                    {name}
                  </option>
                ))}
              </select>
            </>
          ) : (
            <>
              <label htmlFor="display-name">First and Last Name</label>
              <input
                id="display-name"
                value={displayName}
                onChange={(event) => setDisplayName(event.target.value)}
                placeholder="Your name"
                required
              />
            </>
          )}
          <button type="submit" disabled={busy || !(effectiveDisplayName.trim() && inviteCode.trim())} style={{ background: "var(--nascar-yellow)", color: "var(--nascar-black)", boxShadow: "0 6px 14px rgb(243 208 62 / 24%)" }}>
            Join League
          </button>
        </form>
      </section>

      <section className="setup-panel">
        <h2>CREATE LEAGUE</h2>
        <form onSubmit={onCreateLeague} className="stack-form">
          <label htmlFor="league-name">League Name</label>
          <input
            id="league-name"
            value={leagueName}
            onChange={(event) => setLeagueName(event.target.value)}
            placeholder="Sunday Pit Crew"
            required
          />
          <label htmlFor="season-year">Season Year</label>
          <input
            id="season-year"
            type="number"
            value={seasonYear}
            onChange={(event) => setSeasonYear(Number(event.target.value))}
            min={2020}
            max={2100}
            required
          />
          <label htmlFor="new-invite-code">Invite Code</label>
          <input
            id="new-invite-code"
            value={newInviteCode}
            onChange={(event) => setNewInviteCode(event.target.value.toUpperCase())}
            placeholder="RACER-2026"
            required
          />
          <label htmlFor="payout-config">Payout Notes (Optional)</label>
          <textarea
            id="payout-config"
            value={payoutConfigText}
            onChange={(event) => setPayoutConfigText(event.target.value)}
            placeholder="1st: $200, 2nd: $100"
            rows={4}
          />
          <button type="submit" disabled={busy}>
            Create League
          </button>
        </form>
      </section>

      {message ? <p className="success-text full-row">{message}</p> : null}
      {error ? <p className="error-text full-row">{error}</p> : null}
      <div className="full-row" style={{ display: "flex", justifyContent: "center" }}>
        <button type="button" onClick={() => void logout()} className="secondary-button" style={{ width: "auto", minWidth: "200px" }}>
          Sign Out
        </button>
      </div>
    </main>
  );
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

  const upcomingRace = useMemo(
    () =>
      races.find(
        (race) => race.status === "scheduled" && race.lockTime.toMillis() > Date.now(),
      ) ?? races.find((race) => race.status === "scheduled"),
    [races],
  );

  const latestCompletedRace = useMemo(
    () => [...races].reverse().find((race) => race.status === "completed"),
    [races],
  );

  const [selectedRaceId, setSelectedRaceId] = useState<string | null>(null);
  useEffect(() => {
    if (!selectedRaceId) {
      setSelectedRaceId(latestCompletedRace?.id ?? upcomingRace?.id ?? null);
      return;
    }

    const raceExists = races.some((race) => race.id === selectedRaceId);
    if (!raceExists) {
      setSelectedRaceId(latestCompletedRace?.id ?? upcomingRace?.id ?? null);
    }
  }, [latestCompletedRace?.id, upcomingRace?.id, races, selectedRaceId]);

  const tierState = useFirestoreDocument<TierDoc>(
    selectedLeagueId && upcomingRace ? tierDocRef(selectedLeagueId, upcomingRace.id) : null,
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
    selectedLeagueId && upcomingRace && user
      ? pickDocRef(selectedLeagueId, upcomingRace.id, user.uid)
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

  const monitorRaceId = selectedRaceId ?? upcomingRace?.id ?? null;
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

  type StandingsRow = { id: string; displayName: string; seasonTotal: number; rank: number; isPlaceholder: boolean };
  const mergedStandingsRows = useMemo((): StandingsRow[] => {
    const memberNames = new Set(membersState.data.map((m) => m.displayName));
    const leagueData = leagueState.data as { memberNames?: string[]; expectedMemberNames?: string[] } | null;
    const expectedNames = leagueData?.memberNames ?? leagueData?.expectedMemberNames ?? [];
    const scoreIds = new Set(seasonScoresState.data.map((s) => s.id));
    const rows: StandingsRow[] = seasonScoresState.data.map((score) => ({
      id: score.id,
      displayName: memberById[score.id]?.displayName ?? score.id,
      seasonTotal: score.seasonTotal,
      rank: score.rank,
      isPlaceholder: false,
    }));
    // Include members who have no season score yet (e.g. new admin) so they always appear
    membersState.data.forEach((member) => {
      if (!scoreIds.has(member.id)) {
        rows.push({
          id: member.id,
          displayName: member.displayName,
          seasonTotal: 0,
          rank: 0,
          isPlaceholder: false,
        });
      }
    });
    expectedNames.forEach((name: string) => {
      if (!memberNames.has(name)) {
        rows.push({
          id: `expected:${name}`,
          displayName: name,
          seasonTotal: 0,
          rank: 0,
          isPlaceholder: true,
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
    leagueState.data,
    memberById,
  ]);

  const currentRaceIdForWeekly = latestCompletedRace?.id ?? upcomingRace?.id ?? null;
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
    if (!upcomingRace) {
      setDraftPick({ tierA: [], tierB: [], tierC: [] });
      pickDirtyRef.current = false;
      return;
    }

    if (pickState.data) {
      setDraftPick({
        tierA: pickState.data.tierA,
        tierB: pickState.data.tierB,
        tierC: pickState.data.tierC,
      });
      pickDirtyRef.current = false;
      return;
    }

    setDraftPick({ tierA: [], tierB: [], tierC: [] });
    pickDirtyRef.current = false;
  }, [pickState.data, upcomingRace?.id]);

  const isPickLocked =
    !upcomingRace ||
    upcomingRace.status !== "scheduled" ||
    upcomingRace.lockTime.toMillis() <= Date.now();

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
      !upcomingRace ||
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
      raceId: upcomingRace.id,
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
  }, [isPickComplete, selectedLeagueId, upcomingRace?.id, isPickLocked, pickSaving, draftPick.tierA, draftPick.tierB, draftPick.tierC]);

  const savePickSubmit = async () => {
    if (!selectedLeagueId || !upcomingRace) {
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
        raceId: upcomingRace.id,
        ...draftPick,
      });
      setPickStatus("Picks saved.");
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
          <section className="panel home-panel">
            {upcomingRace ? (
              <>
                <div className="app-card race-card">
                  <h3 className="race-name">{upcomingRace.name}</h3>
                  <p className="race-meta">{upcomingRace.track}</p>
                  <p className="race-meta">
                    {new Intl.DateTimeFormat("en-US", { dateStyle: "medium" }).format(new Date(upcomingRace.startTime.toMillis()))}
                    {" – "}
                    {new Intl.DateTimeFormat("en-US", { timeStyle: "short" }).format(new Date(upcomingRace.startTime.toMillis()))}
                    {upcomingRace.tvChannel ? ` · ${upcomingRace.tvChannel}` : ""}
                  </p>
                  <div className="countdown-wrap">
                    <CountdownChip lockTime={upcomingRace.lockTime} />
                  </div>
                </div>

                <button
                  type="button"
                  className="app-card your-picks-card"
                  onClick={() => setTab("picks")}
                >
                  <div className="your-picks-head">
                    <h2 className="section-title">Your Picks</h2>
                    <span className="chevron" aria-hidden>›</span>
                  </div>
                  {pickState.data && (pickState.data.tierA?.length > 0 || pickState.data.tierB?.length > 0 || pickState.data.tierC?.length > 0) ? (
                    <div className="your-picks-tiers">
                      {pickState.data.tierA?.length ? (
                        <PicksTierSummary
                          title="Tier A"
                          limit={3}
                          driverIds={pickState.data.tierA}
                          driversById={driversById}
                          tierColor="yellow"
                        />
                      ) : null}
                      {pickState.data.tierB?.length ? (
                        <PicksTierSummary
                          title="Tier B"
                          limit={2}
                          driverIds={pickState.data.tierB}
                          driversById={driversById}
                          tierColor="red"
                        />
                      ) : null}
                      {pickState.data.tierC?.length ? (
                        <PicksTierSummary
                          title="Tier C"
                          limit={1}
                          driverIds={pickState.data.tierC}
                          driversById={driversById}
                          tierColor="blue"
                        />
                      ) : null}
                    </div>
                  ) : (
                    <p className="your-picks-empty">
                      <span className="icon" aria-hidden>☑</span>
                      No picks selected — tap to make your picks
                    </p>
                  )}
                </button>
              </>
            ) : (
              <div className="app-card">
                <p>No upcoming race loaded.</p>
              </div>
            )}
          </section>
        ) : null}

        {tab === "picks" ? (
          <section className="panel picks-panel">
            {upcomingRace ? (
              <>
                <div className="app-card race-card">
                  <h3 className="race-name">{upcomingRace.name}</h3>
                  <p className="race-meta">{upcomingRace.track}</p>
                  <p className="race-meta">
                    {new Intl.DateTimeFormat("en-US", { dateStyle: "medium" }).format(new Date(upcomingRace.startTime.toMillis()))}
                    {" – "}
                    {new Intl.DateTimeFormat("en-US", { timeStyle: "short" }).format(new Date(upcomingRace.startTime.toMillis()))}
                    {upcomingRace.tvChannel ? ` · ${upcomingRace.tvChannel}` : ""}
                  </p>
                  <div className="countdown-wrap">
                    <CountdownChip lockTime={upcomingRace.lockTime} />
                  </div>
                </div>

                {(tierState.loading && !tiersFromStandingsSnapshot) ||
                (latestStandingsState.loading && !effectiveTiers) ? (
                  <div className="app-card">
                    <p className="race-meta">Loading tiers…</p>
                  </div>
                ) : tierState.error ? (
                  <div className="app-card status-card status-card--error">
                    <p className="race-meta">Tiers: {tierState.error}</p>
                  </div>
                ) : effectiveTiers ? (
                  <>
                    <TierBucket
                      title="Tier A"
                      limit={3}
                      driverIds={effectiveTiers.tierA}
                      selected={draftPick.tierA}
                      disabled={isPickLocked}
                      driversById={driversById}
                      onToggle={(driverId, limit) => togglePick("tierA", driverId, limit)}
                      tierColor="yellow"
                    />
                    <TierBucket
                      title="Tier B"
                      limit={2}
                      driverIds={effectiveTiers.tierB}
                      selected={draftPick.tierB}
                      disabled={isPickLocked}
                      driversById={driversById}
                      onToggle={(driverId, limit) => togglePick("tierB", driverId, limit)}
                      tierColor="red"
                    />
                    <TierBucket
                      title="Tier C"
                      limit={1}
                      driverIds={effectiveTiers.tierC}
                      selected={draftPick.tierC}
                      disabled={isPickLocked}
                      driversById={driversById}
                      onToggle={(driverId, limit) => togglePick("tierC", driverId, limit)}
                      tierColor="blue"
                    />
                  </>
                ) : (
                  <div className="app-card">
                    <p className="race-meta">Tiers are not available yet. Run &quot;Refresh data&quot; in Admin to load schedule and standings.</p>
                  </div>
                )}

                {pickError ? (
                  <div className="app-card status-card status-card--error">
                    <p>{pickError}</p>
                  </div>
                ) : null}
                {pickSaving ? (
                  <div className="app-card status-card">
                    <p className="race-meta">Saving…</p>
                  </div>
                ) : pickStatus ? (
                  <div className="app-card status-card status-card--success">
                    <p>{pickStatus}</p>
                  </div>
                ) : null}
              </>
            ) : (
              <div className="app-card">
                <p>No scheduled race available.</p>
              </div>
            )}
          </section>
        ) : null}

        {tab === "standings" ? (
          <section className="panel wide standings-panel">
            {(seasonScoresState.loading || allWeeklyScoresState.loading) && (
              <p className="race-meta">Loading standings…</p>
            )}
            {/* Weekly Leaderboard */}
            <div className="app-card">
              <h2 className="section-title">Weekly Leaderboard</h2>
              <div className="standings-picker-wrap standings-picker-chevron">
                <select
                  className="standings-picker-select"
                  value={selectedRaceIdForWeekly ?? ""}
                  onChange={(e) => setSelectedRaceIdForWeekly(e.target.value || null)}
                  aria-label="Select race for weekly leaderboard"
                >
                  {weeklyRacePickerOptions.map((opt, i) => (
                    <option key={i} value={opt.id ?? ""}>
                      {opt.label}
                    </option>
                  ))}
                </select>
                <span className="standings-chevron" aria-hidden>▼</span>
              </div>
              {weeklyLeaderboardRows.length === 0 ? (
                <p className="race-meta">No scores yet for this race.</p>
              ) : (
                <>
                  <div className="standings-rows">
                    {(isWeeklyExpanded ? weeklyLeaderboardRows : weeklyLeaderboardRows.slice(0, 3)).map((row) => (
                      <div
                        key={row.userId}
                        className={`standings-row standings-row--rank-${Math.min(row.rank, 2)} ${row.userId === user?.uid ? "standings-row--you" : ""} ${row.rank === 1 ? "standings-row--leader" : ""}`}
                      >
                        <span className="standings-rank">#{row.rank}</span>
                        <span className="standings-name">
                          {memberById[row.userId]?.displayName ?? row.userId}
                        </span>
                        <span className="standings-total">{row.points}</span>
                      </div>
                    ))}
                  </div>
                  {weeklyLeaderboardRows.length > 3 ? (
                    <button
                      type="button"
                      className="standings-expand-chevron"
                      onClick={() => setIsWeeklyExpanded((v) => !v)}
                      aria-expanded={isWeeklyExpanded}
                      aria-label={isWeeklyExpanded ? "Show top 3" : "Show full list"}
                    >
                      {isWeeklyExpanded ? "▲" : "▼"}
                    </button>
                  ) : null}
                </>
              )}
            </div>

            {/* Monthly Leaderboard */}
            <div className="app-card">
              <h2 className="section-title">Monthly Leaderboard</h2>
              <div className="standings-picker-wrap standings-picker-chevron">
                <select
                  className="standings-picker-select"
                  value={selectedSprintIndex}
                  onChange={(e) => setSelectedSprintIndex(Number(e.target.value))}
                  aria-label="Select sprint"
                >
                  <option value={0}>
                    Current (
                    {SPRINT_CONFIGS.find((c) => c.index === currentSprintIndex)?.name ?? "Sprint"}
                    )
                  </option>
                  {SPRINT_CONFIGS.map((c) => (
                    <option key={c.index} value={c.index}>
                      {c.name} · {c.payout}
                    </option>
                  ))}
                </select>
                <span className="standings-chevron" aria-hidden>▼</span>
              </div>
              {sprintLeaderboardRows.length === 0 ? (
                <p className="race-meta">No scores yet for this month.</p>
              ) : (
                <>
                  <div className="standings-rows">
                    {(isMonthlyExpanded ? sprintLeaderboardRows : sprintLeaderboardRows.slice(0, 3)).map((row, i) => (
                      <div
                        key={row.userId}
                        className={`standings-row standings-row--rank-${Math.min(i + 1, 2)} ${row.userId === user?.uid ? "standings-row--you" : ""} ${i === 0 ? "standings-row--leader" : ""}`}
                      >
                        <span className="standings-rank">#{i + 1}</span>
                        <span className="standings-name">
                          {memberById[row.userId]?.displayName ?? row.userId}
                        </span>
                        <span className="standings-total">{row.total}</span>
                      </div>
                    ))}
                  </div>
                  {sprintLeaderboardRows.length > 3 ? (
                    <button
                      type="button"
                      className="standings-expand-chevron"
                      onClick={() => setIsMonthlyExpanded((v) => !v)}
                      aria-expanded={isMonthlyExpanded}
                      aria-label={isMonthlyExpanded ? "Show top 3" : "Show full list"}
                    >
                      {isMonthlyExpanded ? "▲" : "▼"}
                    </button>
                  ) : null}
                </>
              )}
            </div>

            {/* Season Leaderboard */}
            <div className="app-card">
              <h2 className="section-title">Season Leaderboard</h2>
              <p className="standings-section-subtitle">1st $1,000 · 2nd $250</p>
              <div className="standings-rows">
                {(isSeasonExpanded ? mergedStandingsRows : mergedStandingsRows.slice(0, 3)).map((row) => (
                  <div
                    key={row.id}
                    className={`standings-row ${row.id === user?.uid ? "standings-row--you" : ""} ${row.isPlaceholder ? "standings-row--placeholder" : ""} standings-row--rank-${Math.min(row.rank, 2)}`}
                  >
                    <span className="standings-rank">#{row.rank}</span>
                    <span className="standings-name">{row.displayName}</span>
                    <span className="standings-total">{row.seasonTotal}</span>
                  </div>
                ))}
              </div>
              {mergedStandingsRows.length > 3 ? (
                <button
                  type="button"
                  className="standings-expand-chevron"
                  onClick={() => setIsSeasonExpanded((v) => !v)}
                  aria-expanded={isSeasonExpanded}
                  aria-label={isSeasonExpanded ? "Show top 3" : "Show full list"}
                >
                  {isSeasonExpanded ? "▲" : "▼"}
                </button>
              ) : null}
            </div>
          </section>
        ) : null}

        {tab === "race" ? (
          <section className="panel wide race-panel">
            <div className="app-card race-selector-card">
              <div className="race-selector-inner">
                <div>
                  {selectedRaceId && races.find((r) => r.id === selectedRaceId) ? (
                    <>
                      <h3 className="race-name">
                        {races.find((r) => r.id === selectedRaceId)!.name}
                      </h3>
                      <p className="race-meta">
                        {races.find((r) => r.id === selectedRaceId)!.track}
                        {" · "}
                        {new Intl.DateTimeFormat("en-US", { dateStyle: "medium" }).format(new Date(races.find((r) => r.id === selectedRaceId)!.startTime.toMillis()))}
                        {" – "}
                        {new Intl.DateTimeFormat("en-US", { timeStyle: "short" }).format(new Date(races.find((r) => r.id === selectedRaceId)!.startTime.toMillis()))}
                        {races.find((r) => r.id === selectedRaceId)!.tvChannel
                          ? ` · ${races.find((r) => r.id === selectedRaceId)!.tvChannel}`
                          : ""}
                      </p>
                      <div className="countdown-wrap">
                        <CountdownChip
                          lockTime={races.find((r) => r.id === selectedRaceId)!.lockTime}
                        />
                      </div>
                    </>
                  ) : (
                    <p className="race-meta">Select a race</p>
                  )}
                </div>
                <span className="chevron" aria-hidden>›</span>
              </div>
              <select
                className="race-select-native"
                value={selectedRaceId ?? ""}
                onChange={(e) => setSelectedRaceId(e.target.value || null)}
                aria-label="Select race"
              >
                <option value="">Select a race</option>
                {races.map((race) => (
                  <option key={race.id} value={race.id}>
                    {race.name} · {race.track}
                  </option>
                ))}
              </select>
            </div>

            {selectedRaceId ? (
              <>
                <div className="app-card">
                  <div className="race-your-picks-head">
                    <h2 className="section-title">Your Picks</h2>
                    {selectedRaceScoreState.data ? (
                      <span className="race-total">
                        <span className="race-total-label">Total</span>
                        <span className="race-total-value">{selectedRaceScoreState.data.weeklyTotal}</span>
                      </span>
                    ) : null}
                  </div>
                  {selectedRaceScoreState.data ? (
                    <div className="race-breakdown-rows">
                      {selectedRaceScoreState.data.breakdown.map((item) => {
                        const pick = selectedRacePickState.data;
                        const tierColor = !pick
                          ? "blue"
                          : pick.tierA.includes(item.driverId)
                            ? "yellow"
                            : pick.tierB.includes(item.driverId)
                              ? "red"
                              : "blue";
                        return (
                          <div
                            key={item.driverId}
                            className={`race-breakdown-row race-breakdown-row--${tierColor}`}
                          >
                            <div>
                              <span className="race-breakdown-name">
                                {driversById[item.driverId]?.name ?? item.driverId}
                              </span>
                              <span className="race-breakdown-meta">
                                Base {item.basePoints}, Adj {item.totalAdjustments}
                              </span>
                            </div>
                            <div className="race-breakdown-right">
                              <span className="race-breakdown-pts">{item.finalPointsApplied}</span>
                              {item.adjusted ? (
                                <span className="adjusted-tag">Adjusted</span>
                              ) : null}
                            </div>
                          </div>
                        );
                      })}
                    </div>
                  ) : (() => {
                    const race = races.find((r) => r.id === selectedRaceId);
                    return race?.status === "scheduled" && race.lockTime.toMillis() > Date.now();
                  })() ? (
                    <p className="race-meta">You can make your picks the week of the race.</p>
                  ) : (
                    <p className="race-meta">No score for this race yet.</p>
                  )}
                </div>

                <div className="app-card">
                  <h2 className="section-title">Results</h2>
                  {selectedRacePointsState.data?.drivers?.length ? (
                    <ul className="race-results-list">
                      {[...(selectedRacePointsState.data.drivers ?? [])]
                        .sort((a, b) => b.basePoints - a.basePoints)
                        .map((entry) => {
                          const points = entry.basePoints + selectedRaceAdjustmentsState.data
                            .filter((adj) => adj.driverId === entry.driverId)
                            .reduce((sum, adj) => sum + adj.deltaPoints, 0);
                          return (
                            <li key={entry.driverId} className="race-result-item">
                              <div>
                                <span className="race-result-name">
                                  {driversById[entry.driverId]?.name ?? entry.driverId}
                                </span>
                                <span className="race-result-team">
                                  {driversById[entry.driverId]?.team ?? ""}
                                </span>
                              </div>
                              <span className="race-result-pts">{points}</span>
                            </li>
                          );
                        })}
                    </ul>
                  ) : (
                    <p className="race-meta">No official points loaded yet.</p>
                  )}
                </div>
              </>
            ) : null}
          </section>
        ) : null}

        {tab === "admin" && isAdmin ? (
          <section className="panel wide">
            <h2>Admin Dashboard</h2>

            <article className="callout">
              <h4>League Settings</h4>
              <form
                className="stack-form"
                onSubmit={(event) => {
                  event.preventDefault();
                  if (!selectedLeagueId) {
                    return;
                  }

                  setAdminBusy(true);
                  setAdminError(null);
                  setAdminMessage("");

                  void setLeagueSettings(selectedLeagueId, settingsDraft)
                    .then(() => {
                      setAdminMessage("League settings saved.");
                    })
                    .catch((error) => {
                      setAdminError((error as Error).message);
                    })
                    .finally(() => {
                      setAdminBusy(false);
                    });
                }}
              >
                <input
                  value={settingsDraft.name}
                  onChange={(event) =>
                    setSettingsDraft((current) => ({
                      ...current,
                      name: event.target.value,
                    }))
                  }
                  placeholder="League Name"
                  required
                />
                <input
                  type="number"
                  value={settingsDraft.seasonYear}
                  onChange={(event) =>
                    setSettingsDraft((current) => ({
                      ...current,
                      seasonYear: Number(event.target.value),
                    }))
                  }
                  required
                />
                <textarea
                  rows={4}
                  value={settingsDraft.payoutConfigText}
                  onChange={(event) =>
                    setSettingsDraft((current) => ({
                      ...current,
                      payoutConfigText: event.target.value,
                    }))
                  }
                />
                <button type="submit" disabled={adminBusy}>
                  Save Settings
                </button>
              </form>
            </article>

            <article className="callout">
              <h4>Members</h4>
              <div className="table-scroll">
                <table>
                  <thead>
                    <tr>
                      <th>Name</th>
                      <th>Role</th>
                      <th>Paid</th>
                      <th>Action</th>
                    </tr>
                  </thead>
                  <tbody>
                    {membersState.data.map((member) => (
                      <tr key={member.id}>
                        <td>{member.displayName}</td>
                        <td>{member.role}</td>
                        <td>{member.paidStatus}</td>
                        <td>
                          <button
                            type="button"
                            className="small-button"
                            onClick={() => {
                              if (!selectedLeagueId) {
                                return;
                              }
                              const nextPaidStatus = member.paidStatus === "paid" ? "unpaid" : "paid";
                              void setMemberPaidStatus(
                                selectedLeagueId,
                                member.id,
                                nextPaidStatus,
                              );
                            }}
                          >
                            Toggle Paid
                          </button>
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            </article>

            <article className="callout">
              <h4>Pick Monitoring <span className="admin-heading-meta">({monitorRaceId ?? "No race"})</span></h4>
              <p>
                Submitted {raceMonitorPicksState.data.length}/{membersState.data.length} picks
              </p>
              <div className="pick-monitoring-groups">
                <div className="pick-monitoring-group">
                  <h5 className="pick-monitoring-label submitted">Submitted</h5>
                  <ul className="results-list">
                    {membersState.data
                      .filter((m) => raceMonitorPicksState.data.some((pick) => pick.userId === m.id))
                      .map((member) => (
                        <li key={member.id}>{member.displayName}</li>
                      ))}
                  </ul>
                </div>
                <div className="pick-monitoring-group">
                  <h5 className="pick-monitoring-label missing">Missing</h5>
                  <ul className="results-list">
                    {membersState.data
                      .filter((m) => !raceMonitorPicksState.data.some((pick) => pick.userId === m.id))
                      .map((member) => (
                        <li key={member.id}>{member.displayName}</li>
                      ))}
                  </ul>
                </div>
              </div>
            </article>

            <article className="callout">
              <h4>Data Operations</h4>
              <div className="button-row">
                <button
                  type="button"
                  disabled={adminBusy || !selectedLeagueId}
                  onClick={() => {
                    if (!selectedLeagueId) {
                      return;
                    }
                    setAdminBusy(true);
                    setAdminError(null);
                    setAdminMessage("");

                    void manualRefreshData({ leagueId: selectedLeagueId })
                      .then(() => {
                        setAdminMessage("Data refresh requested.");
                      })
                      .catch((error) => {
                        setAdminError((error as Error).message);
                      })
                      .finally(() => {
                        setAdminBusy(false);
                      });
                  }}
                >
                  Refresh Data Now
                </button>
              </div>

              <form
                className="stack-form"
                onSubmit={(event) => {
                  event.preventDefault();
                  if (!selectedLeagueId) {
                    return;
                  }

                  const drivers = manualResultsRows.filter(
                    (row) => row.driverId.trim() !== "" && Number.isFinite(row.basePoints),
                  );
                  if (drivers.length === 0) {
                    setAdminError("Add at least one driver with points.");
                    return;
                  }

                  setAdminBusy(true);
                  setAdminError(null);
                  setAdminMessage("");

                  void manualUpsertRacePoints({
                    leagueId: selectedLeagueId,
                    raceId: manualResultsRaceId,
                    source: manualResultsSource,
                    drivers,
                  })
                    .then(() => {
                      setAdminMessage("Manual race points saved.");
                    })
                    .catch((error) => {
                      setAdminError((error as Error).message);
                    })
                    .finally(() => {
                      setAdminBusy(false);
                    });
                }}
              >
                <h5>Manual Results / Override</h5>
                <p className="form-hint">
                  Enter or override finish-order points for a race. Pick the race, then add each
                  driver and their base points.
                </p>
                <label>
                  <span className="label-text">Race</span>
                  <select
                    value={manualResultsRaceId}
                    onChange={(event) => setManualResultsRaceId(event.target.value)}
                    required
                  >
                    <option value="">— Select race —</option>
                    {races.map((race) => (
                      <option key={race.id} value={race.id}>
                        {race.name} · {race.track}
                      </option>
                    ))}
                  </select>
                </label>
                <label>
                  <span className="label-text">Source (optional)</span>
                  <input
                    value={manualResultsSource}
                    onChange={(event) => setManualResultsSource(event.target.value)}
                    placeholder="e.g. admin-manual"
                  />
                </label>
                <fieldset className="manual-results-rows">
                  <span className="label-text">Driver results</span>
                  {manualResultsRows.map((row, index) => (
                    <div key={index} className="manual-result-row">
                      <select
                        value={row.driverId}
                        onChange={(event) => {
                          setManualResultsRows((prev) => {
                            const next = [...prev];
                            next[index] = { ...next[index], driverId: event.target.value };
                            return next;
                          });
                        }}
                      >
                        <option value="">— Select driver —</option>
                        {driversState.data.map((d) => (
                          <option key={d.id} value={d.id}>
                            #{d.number} {d.name}
                          </option>
                        ))}
                      </select>
                      <input
                        type="number"
                        min={0}
                        value={row.basePoints}
                        onChange={(event) => {
                          setManualResultsRows((prev) => {
                            const next = [...prev];
                            next[index] = {
                              ...next[index],
                              basePoints: Number(event.target.value) || 0,
                            };
                            return next;
                          });
                        }}
                        placeholder="Points"
                        aria-label="Base points"
                      />
                      <button
                        type="button"
                        className="button-ghost"
                        onClick={() => {
                          setManualResultsRows((prev) =>
                            prev.length > 1 ? prev.filter((_, i) => i !== index) : prev,
                          );
                        }}
                        aria-label="Remove row"
                      >
                        Remove
                      </button>
                    </div>
                  ))}
                  <button
                    type="button"
                    className="button-ghost"
                    onClick={() =>
                      setManualResultsRows((prev) => [...prev, { driverId: "", basePoints: 0 }])
                    }
                  >
                    + Add driver result
                  </button>
                </fieldset>
                <button type="submit" disabled={adminBusy}>
                  Save Manual Results
                </button>
              </form>

              <form
                className="stack-form"
                onSubmit={(event) => {
                  event.preventDefault();
                  if (!selectedLeagueId) {
                    return;
                  }

                  setAdminBusy(true);
                  setAdminError(null);
                  setAdminMessage("");

                  void addAdjustment({
                    leagueId: selectedLeagueId,
                    raceId: adjustmentDraft.raceId,
                    driverId: adjustmentDraft.driverId,
                    type: adjustmentDraft.type,
                    deltaPoints: adjustmentDraft.deltaPoints,
                    reason: adjustmentDraft.reason,
                    source: adjustmentDraft.source,
                  })
                    .then(() => {
                      setAdminMessage("Adjustment added.");
                    })
                    .catch((error) => {
                      setAdminError((error as Error).message);
                    })
                    .finally(() => {
                      setAdminBusy(false);
                    });
                }}
              >
                <h5>Add Penalty / Correction</h5>
                <p className="form-hint">
                  Apply a points adjustment to one driver for a specific race (e.g. penalty −10,
                  or a correction to fix a scoring error).
                </p>
                <label>
                  <span className="label-text">Race</span>
                  <select
                    value={adjustmentDraft.raceId}
                    onChange={(event) =>
                      setAdjustmentDraft((current) => ({
                        ...current,
                        raceId: event.target.value,
                      }))
                    }
                    required
                  >
                    <option value="">— Select race —</option>
                    {races.map((race) => (
                      <option key={race.id} value={race.id}>
                        {race.name} · {race.track}
                      </option>
                    ))}
                  </select>
                </label>
                <label>
                  <span className="label-text">Driver</span>
                  <select
                    value={adjustmentDraft.driverId}
                    onChange={(event) =>
                      setAdjustmentDraft((current) => ({
                        ...current,
                        driverId: event.target.value,
                      }))
                    }
                    required
                  >
                    <option value="">— Select driver —</option>
                    {driversState.data.map((d) => (
                      <option key={d.id} value={d.id}>
                        #{d.number} {d.name}
                      </option>
                    ))}
                  </select>
                </label>
                <label>
                  <span className="label-text">Type</span>
                  <select
                    value={adjustmentDraft.type}
                    onChange={(event) =>
                      setAdjustmentDraft((current) => ({
                        ...current,
                        type: event.target.value as "penalty" | "correction",
                      }))
                    }
                  >
                    <option value="penalty">Penalty</option>
                    <option value="correction">Correction</option>
                  </select>
                </label>
                <label>
                  <span className="label-text">Points change</span>
                  <input
                    type="number"
                    value={adjustmentDraft.deltaPoints}
                    onChange={(event) =>
                      setAdjustmentDraft((current) => ({
                        ...current,
                        deltaPoints: Number(event.target.value),
                      }))
                    }
                    placeholder="-10"
                    title="Negative = deduction, positive = addition"
                  />
                  <span className="input-hint">Negative = deduction, positive = addition</span>
                </label>
                <label>
                  <span className="label-text">Reason</span>
                  <input
                    value={adjustmentDraft.reason}
                    onChange={(event) =>
                      setAdjustmentDraft((current) => ({
                        ...current,
                        reason: event.target.value,
                      }))
                    }
                    placeholder="e.g. Post-race penalty"
                    required
                  />
                </label>
                <button type="submit" disabled={adminBusy}>
                  Add Adjustment
                </button>
              </form>
            </article>

            {adminMessage ? <p className="success-text">{adminMessage}</p> : null}
            {adminError ? <p className="error-text">{adminError}</p> : null}
          </section>
        ) : null}
      </main>

      {(racesState.error || driversState.error || leagueState.error || myMemberState.error || seasonScoresState.error || allWeeklyScoresState.error || tierState.error) && (
        <footer className="error-footer">
          {racesState.error || driversState.error || leagueState.error || myMemberState.error || seasonScoresState.error || allWeeklyScoresState.error || tierState.error}
        </footer>
      )}
    </div>
  );
}
