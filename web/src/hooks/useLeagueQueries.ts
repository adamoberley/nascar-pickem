import { useMemo } from "react";
import {
  collection,
  doc,
  limit,
  orderBy,
  query,
  type Query,
} from "firebase/firestore";
import { db } from "../lib/firebase";
import { leagueDocRef } from "../lib/api";
import type {
  AppTab,
  DriverDoc,
  LeagueDoc,
  MemberDoc,
  RaceDoc,
  SeasonScoreDoc,
  StandingsSnapshotDoc,
  UserNotificationDoc,
  WeeklyScoreDoc,
} from "../lib/types";
import { useFirestoreCollection, useFirestoreDocument } from "./useFirestore";

/**
 * Owns all league-scoped Firestore listeners plus the small derived maps
 * (driversById, memberById, races sorted by startTime, unreadNotifications).
 *
 * Tab gating mirrors what App.tsx had inline: standings-only queries are
 * mounted only on the standings tab.
 */
export function useLeagueQueries(params: {
  selectedLeagueId: string | null;
  userId: string | null;
  tab: AppTab;
}) {
  const { selectedLeagueId, userId, tab } = params;

  const leagueState = useFirestoreDocument<LeagueDoc>(
    selectedLeagueId ? leagueDocRef(selectedLeagueId) : null,
  );

  const myMemberState = useFirestoreDocument<MemberDoc>(
    selectedLeagueId && userId
      ? doc(db, "leagues", selectedLeagueId, "members", userId)
      : null,
  );
  const isAdmin = myMemberState.data?.role === "admin";

  const racesQuery = useMemo<Query | null>(() => {
    if (!selectedLeagueId) return null;
    return query(
      collection(db, "leagues", selectedLeagueId, "races"),
      orderBy("startTime", "asc"),
    );
  }, [selectedLeagueId]);

  const driversQuery = useMemo<Query | null>(() => {
    if (!selectedLeagueId) return null;
    return query(collection(db, "leagues", selectedLeagueId, "drivers"));
  }, [selectedLeagueId]);

  const membersQuery = useMemo<Query | null>(() => {
    if (!selectedLeagueId) return null;
    return query(
      collection(db, "leagues", selectedLeagueId, "members"),
      orderBy("displayName", "asc"),
    );
  }, [selectedLeagueId]);

  const seasonScoresQuery = useMemo<Query | null>(() => {
    if (!selectedLeagueId || tab !== "standings") return null;
    return query(
      collection(db, "leagues", selectedLeagueId, "seasonScores"),
      orderBy("rank", "asc"),
    );
  }, [selectedLeagueId, tab]);

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
    if (!userId) return null;
    return query(
      collection(db, "users", userId, "notifications"),
      orderBy("createdAt", "desc"),
      limit(5),
    );
  }, [userId]);

  const racesState = useFirestoreCollection<RaceDoc>(racesQuery);
  const driversState = useFirestoreCollection<DriverDoc>(driversQuery);
  const membersState = useFirestoreCollection<MemberDoc>(membersQuery);
  const seasonScoresState = useFirestoreCollection<SeasonScoreDoc>(seasonScoresQuery);
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

  const driversById = useMemo(
    () =>
      driversState.data.reduce<Record<string, DriverDoc>>((acc, driver) => {
        acc[driver.id] = driver;
        return acc;
      }, {}),
    [driversState.data],
  );

  const memberById = useMemo(
    () =>
      membersState.data.reduce<Record<string, MemberDoc>>((acc, member) => {
        acc[member.id] = member;
        return acc;
      }, {}),
    [membersState.data],
  );

  return {
    leagueState,
    myMemberState,
    isAdmin,
    racesState,
    driversState,
    membersState,
    seasonScoresState,
    allWeeklyScoresState,
    latestStandingsState,
    notificationsState,
    unreadNotifications,
    races,
    driversById,
    memberById,
  };
}
