import { FormEvent, useEffect, useMemo, useState } from "react";
import {
  collection,
  doc,
  orderBy,
  query,
  where,
  type Query,
} from "firebase/firestore";
import { db } from "./lib/firebase";
import {
  addAdjustment,
  createLeague,
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
        <p className="subtitle">Private league picks, scoring, and standings.</p>

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

  const [leagueName, setLeagueName] = useState("");
  const [seasonYear, setSeasonYear] = useState(new Date().getFullYear());
  const [newInviteCode, setNewInviteCode] = useState("");
  const [payoutConfigText, setPayoutConfigText] = useState("");

  const [busy, setBusy] = useState(false);
  const [message, setMessage] = useState("");
  const [error, setError] = useState<string | null>(null);

  const onJoin = async (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    setBusy(true);
    setMessage("");
    setError(null);

    try {
      await joinLeagueByInvite({
        inviteCode,
        displayName,
      });
      setMessage("Joined league successfully.");
      await onJoined();
    } catch (err) {
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
        <h2>Join Private League</h2>
        <form onSubmit={onJoin} className="stack-form">
          <label htmlFor="display-name">Display Name</label>
          <input
            id="display-name"
            value={displayName}
            onChange={(event) => setDisplayName(event.target.value)}
            placeholder="Your name"
            required
          />
          <label htmlFor="invite-code">Invite Code</label>
          <input
            id="invite-code"
            value={inviteCode}
            onChange={(event) => setInviteCode(event.target.value.toUpperCase())}
            placeholder="RACER-2026"
            required
          />
          <button type="submit" disabled={busy}>
            Join League
          </button>
        </form>
      </section>

      <section className="setup-panel">
        <h2>Create League (Admin)</h2>
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
          <label htmlFor="payout-config">Payout Notes (optional)</label>
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

  const racesState = useFirestoreCollection<RaceDoc>(racesQuery);
  const driversState = useFirestoreCollection<DriverDoc>(driversQuery);
  const membersState = useFirestoreCollection<MemberDoc>(membersQuery);
  const seasonScoresState = useFirestoreCollection<SeasonScoreDoc>(seasonScoresQuery);

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

  const pickState = useFirestoreDocument<PickDoc>(
    selectedLeagueId && upcomingRace && user
      ? pickDocRef(selectedLeagueId, upcomingRace.id, user.uid)
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

  const [selectedStandingsUserId, setSelectedStandingsUserId] = useState<string | null>(null);
  useEffect(() => {
    if (membersState.data.length === 0) {
      setSelectedStandingsUserId(null);
      return;
    }

    if (!selectedStandingsUserId) {
      setSelectedStandingsUserId(membersState.data[0].id);
      return;
    }

    const userStillExists = membersState.data.some((member) => member.id === selectedStandingsUserId);
    if (!userStillExists) {
      setSelectedStandingsUserId(membersState.data[0].id);
    }
  }, [membersState.data, selectedStandingsUserId]);

  const selectedUserWeeklyScoresQuery = useMemo<Query | null>(() => {
    if (!selectedLeagueId || !selectedStandingsUserId) {
      return null;
    }

    return query(
      collection(db, "leagues", selectedLeagueId, "weeklyScores"),
      where("userId", "==", selectedStandingsUserId),
    );
  }, [selectedLeagueId, selectedStandingsUserId]);

  const selectedUserWeeklyScoresState = useFirestoreCollection<WeeklyScoreDoc>(
    selectedUserWeeklyScoresQuery,
  );

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

  const [draftPick, setDraftPick] = useState<{ tierA: string[]; tierB: string[]; tierC: string[] }>({
    tierA: [],
    tierB: [],
    tierC: [],
  });
  const [pickError, setPickError] = useState<string | null>(null);
  const [pickStatus, setPickStatus] = useState("");
  const [pickSaving, setPickSaving] = useState(false);

  useEffect(() => {
    if (!upcomingRace) {
      setDraftPick({ tierA: [], tierB: [], tierC: [] });
      return;
    }

    if (pickState.data) {
      setDraftPick({
        tierA: pickState.data.tierA,
        tierB: pickState.data.tierB,
        tierC: pickState.data.tierC,
      });
      return;
    }

    setDraftPick({ tierA: [], tierB: [], tierC: [] });
  }, [pickState.data, upcomingRace?.id]);

  const isPickLocked =
    !upcomingRace ||
    upcomingRace.status !== "scheduled" ||
    upcomingRace.lockTime.toMillis() <= Date.now();

  const togglePick = (tier: "tierA" | "tierB" | "tierC", driverId: string, limit: number) => {
    setPickError(null);
    setPickStatus("");

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
  const [manualResultsJson, setManualResultsJson] = useState(
    '[{"driverId":"sample-driver","basePoints":40}]',
  );

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
    return <main className="loading-view">Checking sign-in state...</main>;
  }

  if (!user) {
    return <AuthView />;
  }

  if (membershipsLoading) {
    return <main className="loading-view">Loading league memberships...</main>;
  }

  if (memberships.length === 0) {
    return (
      <>
        <LeagueAccessView onJoined={refreshMemberships} />
        {membershipsError ? <p className="error-text centered">{membershipsError}</p> : null}
      </>
    );
  }

  return (
    <div className="app-shell">
      <header className="topbar">
        <div>
          <h1>{leagueState.data?.name ?? selectedMembership?.league.name ?? "NASCAR Pick'Em"}</h1>
          <p className="subtitle">
            Season {leagueState.data?.seasonYear ?? selectedMembership?.league.seasonYear}
          </p>
        </div>

        <div className="topbar-actions">
          <label className="league-switcher" htmlFor="league-switch">
            League
            <select
              id="league-switch"
              value={selectedLeagueId ?? ""}
              onChange={(event) => setSelectedLeagueId(event.target.value)}
            >
              {memberships.map((membership) => (
                <option key={membership.leagueId} value={membership.leagueId}>
                  {membership.league.name}
                </option>
              ))}
            </select>
          </label>
          <button type="button" onClick={() => void logout()} className="secondary-button">
            Sign Out
          </button>
        </div>
      </header>

      <nav className="tabs">
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

      <main className="content-grid">
        {tab === "home" ? (
          <section className="panel">
            <h2>Next Race</h2>
            {upcomingRace ? (
              <>
                <div className="race-card">
                  <h3>{upcomingRace.name}</h3>
                  <p>{upcomingRace.track}</p>
                  <p>{formatDate(upcomingRace.startTime.toMillis())}</p>
                  <CountdownChip lockTime={upcomingRace.lockTime} />
                </div>
                <p className="status-pill">
                  {pickState.data
                    ? `Picks saved (${formatDate(pickState.data.lockedAt?.toMillis?.() ?? Date.now())})`
                    : "No picks submitted yet"}
                </p>
              </>
            ) : (
              <p>No upcoming race is loaded yet.</p>
            )}

            {leagueState.data?.payoutConfigText ? (
              <article className="callout">
                <h4>Payouts</h4>
                <pre>{leagueState.data.payoutConfigText}</pre>
              </article>
            ) : null}

            {isAdmin ? (
              <article className="callout">
                <h4>Invite Code</h4>
                <p>{leagueState.data?.inviteCode ?? selectedMembership?.league.inviteCode}</p>
              </article>
            ) : null}
          </section>
        ) : null}

        {tab === "picks" ? (
          <section className="panel">
            <h2>Weekly Picks</h2>
            {upcomingRace ? (
              <>
                <div className="race-card compact">
                  <h3>{upcomingRace.name}</h3>
                  <p>{formatDate(upcomingRace.startTime.toMillis())}</p>
                  <CountdownChip lockTime={upcomingRace.lockTime} />
                </div>

                {tierState.data ? (
                  <div className="tier-layout">
                    <TierBucket
                      title="Tier A"
                      limit={3}
                      driverIds={tierState.data.tierA}
                      selected={draftPick.tierA}
                      disabled={isPickLocked}
                      driversById={driversById}
                      onToggle={(driverId, limit) => togglePick("tierA", driverId, limit)}
                    />
                    <TierBucket
                      title="Tier B"
                      limit={2}
                      driverIds={tierState.data.tierB}
                      selected={draftPick.tierB}
                      disabled={isPickLocked}
                      driversById={driversById}
                      onToggle={(driverId, limit) => togglePick("tierB", driverId, limit)}
                    />
                    <TierBucket
                      title="Tier C"
                      limit={1}
                      driverIds={tierState.data.tierC}
                      selected={draftPick.tierC}
                      disabled={isPickLocked}
                      driversById={driversById}
                      onToggle={(driverId, limit) => togglePick("tierC", driverId, limit)}
                    />
                  </div>
                ) : (
                  <p>Tiers are not available yet. Ask admin to refresh standings.</p>
                )}

                <div className="button-row">
                  <button type="button" onClick={() => void savePickSubmit()} disabled={isPickLocked || pickSaving}>
                    {isPickLocked ? "Picks Locked" : pickSaving ? "Saving..." : "Save Picks"}
                  </button>
                </div>
                {pickStatus ? <p className="success-text">{pickStatus}</p> : null}
                {pickError ? <p className="error-text">{pickError}</p> : null}
              </>
            ) : (
              <p>No scheduled race found.</p>
            )}
          </section>
        ) : null}

        {tab === "standings" ? (
          <section className="panel wide">
            <h2>Season Standings</h2>
            <div className="table-scroll">
              <table>
                <thead>
                  <tr>
                    <th>Rank</th>
                    <th>Player</th>
                    <th>Total</th>
                    <th>Paid</th>
                  </tr>
                </thead>
                <tbody>
                  {seasonScoresState.data.map((score) => (
                    <tr
                      key={score.id}
                      onClick={() => setSelectedStandingsUserId(score.id)}
                      className={selectedStandingsUserId === score.id ? "selected-row" : ""}
                    >
                      <td>{score.rank}</td>
                      <td>{memberById[score.id]?.displayName ?? score.id}</td>
                      <td>{score.seasonTotal}</td>
                      <td>{memberById[score.id]?.paidStatus ?? "--"}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>

            {selectedStandingsUserId ? (
              <article className="callout">
                <h4>
                  Weekly Breakdown: {memberById[selectedStandingsUserId]?.displayName ?? selectedStandingsUserId}
                </h4>
                <ul className="breakdown-list">
                  {[...selectedUserWeeklyScoresState.data]
                    .sort((a, b) => a.raceId.localeCompare(b.raceId))
                    .map((weekly) => {
                      const raceLabel = races.find((race) => race.id === weekly.raceId)?.name ?? weekly.raceId;
                      return (
                        <li key={weekly.id}>
                          <strong>{raceLabel}</strong>
                          <span>{weekly.weeklyTotal} pts</span>
                          {weekly.hasAdjustments ? <em className="adjusted-tag">Adjusted</em> : null}
                        </li>
                      );
                    })}
                </ul>
              </article>
            ) : null}
          </section>
        ) : null}

        {tab === "race" ? (
          <section className="panel wide">
            <h2>Race Results</h2>
            <label htmlFor="race-select" className="inline-label">
              Choose race
              <select
                id="race-select"
                value={selectedRaceId ?? ""}
                onChange={(event) => setSelectedRaceId(event.target.value)}
              >
                {races.map((race) => (
                  <option key={race.id} value={race.id}>
                    Week {race.weekIndex}: {race.name}
                  </option>
                ))}
              </select>
            </label>

            {selectedRaceId ? (
              <div className="race-results-layout">
                <article className="callout">
                  <h4>Official Points</h4>
                  <ul className="results-list">
                    {[...(selectedRacePointsState.data?.drivers ?? [])]
                      .sort((a, b) => b.basePoints - a.basePoints)
                      .map((entry) => {
                        const adjustmentTotal = selectedRaceAdjustmentsState.data
                          .filter((adj) => adj.driverId === entry.driverId)
                          .reduce((sum, adj) => sum + adj.deltaPoints, 0);
                        return (
                          <li key={entry.driverId}>
                            <span>
                              {driversById[entry.driverId]?.name ?? entry.driverId} ({entry.basePoints} pts)
                            </span>
                            {adjustmentTotal !== 0 ? <em className="adjusted-tag">Adjusted</em> : null}
                          </li>
                        );
                      })}
                  </ul>
                </article>

                <article className="callout">
                  <h4>Your Race Score</h4>
                  {selectedRaceScoreState.data ? (
                    <>
                      <p className="big-number">{selectedRaceScoreState.data.weeklyTotal} pts</p>
                      <ul className="results-list">
                        {selectedRaceScoreState.data.breakdown.map((item) => (
                          <li key={item.driverId}>
                            <span>
                              {driversById[item.driverId]?.name ?? item.driverId}: {item.finalPointsApplied} pts
                            </span>
                            {item.adjusted ? <em className="adjusted-tag">Adjusted</em> : null}
                          </li>
                        ))}
                      </ul>
                    </>
                  ) : (
                    <p>No score yet for this race.</p>
                  )}
                </article>
              </div>
            ) : (
              <p>No race data loaded yet.</p>
            )}
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
              <h4>Pick Monitoring ({monitorRaceId ?? "No race"})</h4>
              <p>
                Submitted {raceMonitorPicksState.data.length}/{membersState.data.length} picks
              </p>
              <ul className="results-list">
                {membersState.data.map((member) => {
                  const hasPick = raceMonitorPicksState.data.some((pick) => pick.userId === member.id);
                  return (
                    <li key={member.id}>
                      <span>{member.displayName}</span>
                      <strong>{hasPick ? "Submitted" : "Missing"}</strong>
                    </li>
                  );
                })}
              </ul>
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

                  setAdminBusy(true);
                  setAdminError(null);
                  setAdminMessage("");

                  try {
                    const parsed = JSON.parse(manualResultsJson) as Array<{
                      driverId: string;
                      basePoints: number;
                    }>;

                    void manualUpsertRacePoints({
                      leagueId: selectedLeagueId,
                      raceId: manualResultsRaceId,
                      source: manualResultsSource,
                      drivers: parsed,
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
                  } catch (error) {
                    setAdminBusy(false);
                    setAdminError(`Invalid results JSON: ${(error as Error).message}`);
                  }
                }}
              >
                <h5>Manual Results / Override</h5>
                <input
                  value={manualResultsRaceId}
                  onChange={(event) => setManualResultsRaceId(event.target.value)}
                  placeholder="raceId"
                  required
                />
                <input
                  value={manualResultsSource}
                  onChange={(event) => setManualResultsSource(event.target.value)}
                  placeholder="source"
                />
                <textarea
                  rows={4}
                  value={manualResultsJson}
                  onChange={(event) => setManualResultsJson(event.target.value)}
                />
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
                <input
                  value={adjustmentDraft.raceId}
                  onChange={(event) =>
                    setAdjustmentDraft((current) => ({
                      ...current,
                      raceId: event.target.value,
                    }))
                  }
                  placeholder="raceId"
                  required
                />
                <input
                  value={adjustmentDraft.driverId}
                  onChange={(event) =>
                    setAdjustmentDraft((current) => ({
                      ...current,
                      driverId: event.target.value,
                    }))
                  }
                  placeholder="driverId"
                  required
                />
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
                <input
                  type="number"
                  value={adjustmentDraft.deltaPoints}
                  onChange={(event) =>
                    setAdjustmentDraft((current) => ({
                      ...current,
                      deltaPoints: Number(event.target.value),
                    }))
                  }
                />
                <input
                  value={adjustmentDraft.reason}
                  onChange={(event) =>
                    setAdjustmentDraft((current) => ({
                      ...current,
                      reason: event.target.value,
                    }))
                  }
                  placeholder="Reason"
                  required
                />
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

      {(racesState.error || driversState.error || leagueState.error || myMemberState.error) && (
        <footer className="error-footer">
          {racesState.error || driversState.error || leagueState.error || myMemberState.error}
        </footer>
      )}
    </div>
  );
}
