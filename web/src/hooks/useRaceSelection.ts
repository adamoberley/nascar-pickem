import { useEffect, useMemo, useState } from "react";
import type { RaceDoc } from "../lib/types";
import { nextDay10pmEasternMs } from "../lib/time";

export function useRaceSelection(
  races: Array<RaceDoc & { id: string }>,
  isAdmin: boolean,
) {
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

  const liveRace = useMemo(
    () => races.find((race) => race.status === "locked") ?? null,
    [races],
  );

  const inProgressScheduledRace = useMemo(() => {
    const now = Date.now();
    return (
      races.find(
        (race) =>
          race.status === "scheduled" && race.lockTime.toMillis() <= now,
      ) ?? null
    );
  }, [races]);

  const nextDay10pmETMs = useMemo(() => {
    if (!latestCompletedRace) return 0;
    return nextDay10pmEasternMs(latestCompletedRace.startTime.toMillis());
  }, [latestCompletedRace?.id, latestCompletedRace?.startTime?.toMillis?.()]);

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
  const selectedRaceLockMs = selectedRace?.lockTime?.toMillis?.() ?? 0;
  const canReadAllPicksForSelectedRace = useMemo(() => {
    if (!selectedRace) return false;
    if (isAdmin) return true;
    if (selectedRace.status === "locked" || selectedRace.status === "completed") return true;
    return selectedRaceLockMs > 0 && selectedRaceLockMs <= Date.now();
  }, [isAdmin, selectedRace?.id, selectedRace?.status, selectedRaceLockMs]);

  return {
    upcomingRace,
    latestCompletedRace,
    liveRace,
    inProgressScheduledRace,
    primaryRace,
    effectiveLiveRace,
    selectedRaceId,
    setSelectedRaceId,
    selectedRace,
    canReadAllPicksForSelectedRace,
  };
}
