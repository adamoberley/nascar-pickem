import { useEffect, useMemo, useState } from "react";
import type { Timestamp } from "firebase/firestore";

interface Props {
  lockTime: Timestamp;
}

function formatDuration(ms: number): string {
  if (ms <= 0) {
    return "Locked";
  }

  const totalSeconds = Math.floor(ms / 1000);
  const days = Math.floor(totalSeconds / 86400);
  const hours = Math.floor((totalSeconds % 86400) / 3600);
  const minutes = Math.floor((totalSeconds % 3600) / 60);
  const seconds = totalSeconds % 60;

  if (days > 0) {
    return `${days}d ${hours}h ${minutes}m`;
  }

  return `${hours}h ${minutes}m ${seconds}s`;
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
