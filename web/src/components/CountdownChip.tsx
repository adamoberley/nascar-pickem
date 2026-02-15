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
    const daysPart = days > 0 ? `${days}d ` : "";
    return `${daysPart}${displayHours}h ${minutes}m`;
  }
  return `${minutes}m ${seconds}s`;
}

export function CountdownChip({ lockTime }: Props) {
  const [nowMs, setNowMs] = useState(Date.now());

  useEffect(() => {
    const update = () => setNowMs(Date.now());
    const remaining = lockTime.toMillis() - Date.now();
    const intervalMs =
      remaining > 3600_000 ? 60_000 : remaining > 60_000 ? 15_000 : 1000;
    const timer = window.setInterval(update, intervalMs);
    return () => window.clearInterval(timer);
  }, [lockTime]);

  const remainingMs = useMemo(() => lockTime.toMillis() - nowMs, [lockTime, nowMs]);

  return (
    <span className={`countdown-chip ${remainingMs <= 0 ? "locked" : "open"}`}>
      {remainingMs <= 0 ? "Locked" : `Locks in ${formatDuration(remainingMs)}`}
    </span>
  );
}
