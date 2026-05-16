import { useEffect, useState } from "react";
import type { AppTab, RaceStatus } from "../lib/types";

type HomeRace = { id: string; status: RaceStatus } | null;

/**
 * 1-second ticker that runs only while the Home tab is showing a not-yet-started
 * race. Returns a `nowMs` value that callers can compare to race start time.
 * When inactive, returns the value from the moment the ticker last stopped (or
 * the initial mount time).
 */
export function useHomeNowTicker(params: {
  tab: AppTab;
  homeRace: HomeRace;
  homeRaceStartMs: number;
}): number {
  const { tab, homeRace, homeRaceStartMs } = params;
  const [nowMs, setNowMs] = useState(() => Date.now());

  useEffect(() => {
    if (
      tab !== "home" ||
      !homeRace ||
      homeRace.status === "completed" ||
      homeRaceStartMs <= 0
    ) {
      return;
    }

    setNowMs(Date.now());
    if (homeRaceStartMs <= Date.now()) {
      return;
    }
    const intervalId = window.setInterval(() => {
      setNowMs(Date.now());
    }, 1000);
    return () => window.clearInterval(intervalId);
  }, [homeRace?.id, homeRace?.status, homeRaceStartMs, tab]);

  return nowMs;
}
