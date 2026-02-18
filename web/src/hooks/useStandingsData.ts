import { useMemo } from "react";
import type {
  MemberDoc,
  RaceDoc,
  SeasonScoreDoc,
  WeeklyScoreDoc,
} from "../lib/types";

interface SprintConfigLike {
  index: number;
}

interface StandingsRow {
  id: string;
  displayName: string;
  seasonTotal: number;
  rank: number;
}

interface WeeklyLeaderboardRow {
  rank: number;
  userId: string;
  points: number;
}

interface SprintLeaderboardRow {
  userId: string;
  total: number;
}

interface WeeklyRacePickerOption {
  id: string | null;
  label: string;
}

interface Input {
  seasonScores: Array<SeasonScoreDoc & { id: string }>;
  members: Array<MemberDoc & { id: string }>;
  memberById: Record<string, MemberDoc>;
  allWeeklyScores: Array<WeeklyScoreDoc & { id: string }>;
  races: Array<RaceDoc & { id: string }>;
  effectiveLiveRaceId: string | null;
  latestCompletedRaceId: string | null;
  upcomingRaceId: string | null;
  selectedRaceIdForWeekly: string | null;
  selectedSprintIndex: number;
  sprintConfigs: readonly SprintConfigLike[];
}

export function useStandingsData(input: Input) {
  const {
    seasonScores,
    members,
    memberById,
    allWeeklyScores,
    races,
    effectiveLiveRaceId,
    latestCompletedRaceId,
    upcomingRaceId,
    selectedRaceIdForWeekly,
    selectedSprintIndex,
    sprintConfigs,
  } = input;

  const mergedStandingsRows = useMemo((): StandingsRow[] => {
    const scoreIds = new Set(seasonScores.map((s) => s.id));
    const rows: StandingsRow[] = seasonScores.map((score) => ({
      id: score.id,
      displayName: memberById[score.id]?.displayName ?? score.id,
      seasonTotal: score.seasonTotal,
      rank: score.rank,
    }));
    members.forEach((member) => {
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
  }, [seasonScores, members, memberById]);

  const currentRaceIdForWeekly = effectiveLiveRaceId ?? latestCompletedRaceId ?? upcomingRaceId ?? null;
  const effectiveWeeklyRaceId = selectedRaceIdForWeekly ?? currentRaceIdForWeekly;

  const weeklyLeaderboardRows = useMemo((): WeeklyLeaderboardRow[] => {
    if (!effectiveWeeklyRaceId) return [];
    const byRace = allWeeklyScores.filter((s) => s.raceId === effectiveWeeklyRaceId);
    const sorted = [...byRace].sort((a, b) => b.weeklyTotal - a.weeklyTotal);
    return sorted.map((s, i) => ({ rank: i + 1, userId: s.userId, points: s.weeklyTotal }));
  }, [allWeeklyScores, effectiveWeeklyRaceId]);

  const raceIdToSprintIndex = useMemo((): Record<string, number> => {
    const map: Record<string, number> = {};
    races.forEach((race) => {
      const month = new Date(race.startTime.toMillis()).getMonth() + 1;
      if (month >= 2 && month <= 8) map[race.id] = month - 1;
    });
    return map;
  }, [races]);

  const currentSprintIndex = useMemo(() => {
    if (!latestCompletedRaceId) return 1;
    return raceIdToSprintIndex[latestCompletedRaceId] ?? 1;
  }, [latestCompletedRaceId, raceIdToSprintIndex]);

  const effectiveSprintIndex = selectedSprintIndex === 0 ? currentSprintIndex : selectedSprintIndex;
  const sprintLeaderboardRows = useMemo((): SprintLeaderboardRow[] => {
    const config = sprintConfigs.find((c) => c.index === effectiveSprintIndex) ?? sprintConfigs[0];
    const byUser: Record<string, number> = {};
    allWeeklyScores.forEach((s) => {
      const sprint = raceIdToSprintIndex[s.raceId];
      if (sprint !== config.index) return;
      byUser[s.userId] = (byUser[s.userId] ?? 0) + s.weeklyTotal;
    });
    return Object.entries(byUser)
      .sort(([, a], [, b]) => b - a)
      .map(([userId, total]) => ({ userId, total }));
  }, [allWeeklyScores, effectiveSprintIndex, raceIdToSprintIndex, sprintConfigs]);

  const weeklyRacePickerOptions = useMemo((): WeeklyRacePickerOption[] => {
    const options: WeeklyRacePickerOption[] = [];
    if (currentRaceIdForWeekly) {
      const race = races.find((r) => r.id === currentRaceIdForWeekly);
      if (race) options.push({ id: null, label: `Current (${race.name})` });
    }
    races
      .filter((r) => r.status === "completed")
      .forEach((race) => options.push({ id: race.id, label: race.name }));
    return options;
  }, [races, currentRaceIdForWeekly]);

  return {
    mergedStandingsRows,
    weeklyLeaderboardRows,
    sprintLeaderboardRows,
    weeklyRacePickerOptions,
    currentSprintIndex,
  };
}
