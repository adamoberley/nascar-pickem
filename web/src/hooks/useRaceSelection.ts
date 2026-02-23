import { useEffect, useMemo, useState } from "react";
import type { RaceDoc } from "../lib/types";
import { nextDay10pmEasternMs } from "../lib/time";

export function useRaceSelection(
  races: Array<RaceDoc & { id: string }>,
  _isAdmin: boolean,
) {
  const upcomingRace = useMemo(() => {
    const now = Date.now();
    return (
      races.find(
        (race) => race.status === "scheduled" && race.lockTime.toMillis() > now,
      ) ?? races.find((race) => race.status === "scheduled")
    );
  }, [races]);

  const latestCompletedRace = useMemo(() => {
    const now = Date.now();
    return [...races].reverse().find(
      (race) => race.status === "completed" && race.startTime.toMillis() <= now,
    );
  }, [races]);

  const liveRace = useMemo(() => {
    return (
      races.find(
        (race) => race.status === "locked" && race.lockTime.toMillis() <= Date.now(),
      ) ?? null
    );
  }, [races]);

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
  const [autoFocusedRaceId, setAutoFocusedRaceId] = useState<string | null>(null);
  const preferredRaceId = useMemo(() => {
    if (liveRace) return liveRace.id;
    if (inProgressScheduledRace) return inProgressScheduledRace.id;
    if (latestCompletedRace) return latestCompletedRace.id;
    if (upcomingRace) return upcomingRace.id;
    return races[0]?.id ?? null;
  }, [
    inProgressScheduledRace?.id,
    latestCompletedRace?.id,
    liveRace?.id,
    races,
    upcomingRace?.id,
  ]);

  useEffect(() => {
    if (!selectedRaceId) {
      setSelectedRaceId(preferredRaceId);
      setAutoFocusedRaceId(preferredRaceId);
      return;
    }

    const raceExists = races.some((race) => race.id === selectedRaceId);
    if (!raceExists) {
      setSelectedRaceId(preferredRaceId);
      setAutoFocusedRaceId(preferredRaceId);
      return;
    }

    if (preferredRaceId && preferredRaceId !== autoFocusedRaceId) {
      setSelectedRaceId(preferredRaceId);
      setAutoFocusedRaceId(preferredRaceId);
    }
  }, [
    autoFocusedRaceId,
    preferredRaceId,
    races,
    selectedRaceId,
  ]);

  const selectedRace = useMemo(
    () => (selectedRaceId ? (races.find((r) => r.id === selectedRaceId) ?? null) : null),
    [races, selectedRaceId],
  );
  const selectedRaceStartMs = selectedRace?.startTime?.toMillis?.() ?? 0;
  const canReadAllPicksForSelectedRace = useMemo(() => {
    if (!selectedRace) return false;
    if (selectedRace.status === "completed") return true;
    return selectedRaceStartMs > 0 && selectedRaceStartMs <= Date.now();
  }, [selectedRace?.id, selectedRace?.status, selectedRaceStartMs]);

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
