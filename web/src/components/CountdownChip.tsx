import { useEffect, useMemo, useState } from "react";
import type { Timestamp } from "firebase/firestore";

interface Props {
  lockTime: Timestamp;
}

/** Matches iOS: "Locks in Xd Xh XXm" or "Locks in XXm XXs" or "Locked" */
function formatDuration(ms: number): string {
  if (ms <= 0) {
    return "Locked";
  }

  const totalSeconds = Math.floor(ms / 1000);
  const hours = Math.floor(totalSeconds / 3600);
  const minutes = Math.floor((totalSeconds % 3600) / 60);
  const seconds = totalSeconds % 60;
  const days = Math.floor(hours / 24);
  const displayHours = hours % 24;

  if (hours >= 1) {
    return `${days}d ${displayHours}h ${String(minutes).padStart(2, "0")}m`;
  }
  return `${String(minutes).padStart(2, "0")}m ${String(seconds).padStart(2, "0")}s`;
}

export function CountdownChip({ lockTime }: Props) {
  const [nowMs, setNowMs] = useState(Date.now());

  useEffect(() => {
    const timer = window.setInterval(() => {
      setNowMs(Date.now());
    }, 1000);

    return () => window.clearInterval(timer);
  }, []);

  const remainingMs = useMemo(() => lockTime.toMillis() - nowMs, [lockTime, nowMs]);

  return (
    <span className={`countdown-chip ${remainingMs <= 0 ? "locked" : "open"}`}>
      {remainingMs <= 0 ? "Locked" : `Locks in ${formatDuration(remainingMs)}`}
    </span>
  );
}
