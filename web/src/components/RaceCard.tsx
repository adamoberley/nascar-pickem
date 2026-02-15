import type { Timestamp } from "firebase/firestore";
import { CountdownChip } from "./CountdownChip";

interface Props {
  name: string;
  track: string;
  startTime: Timestamp;
  lockTime: Timestamp;
  tvChannel?: string;
}

export function RaceCard({ name, track, startTime, lockTime, tvChannel }: Props) {
  return (
    <div className="app-card race-card">
      <h3 className="race-name">{name}</h3>
      <p className="race-meta">{track}</p>
      <p className="race-meta">
        {new Intl.DateTimeFormat("en-US", { dateStyle: "medium" }).format(new Date(startTime.toMillis()))}
        {" – "}
        {new Intl.DateTimeFormat("en-US", { timeStyle: "short" }).format(new Date(startTime.toMillis()))}
        {tvChannel ? ` · ${tvChannel}` : ""}
      </p>
      <div className="countdown-wrap">
        <CountdownChip lockTime={lockTime} />
      </div>
    </div>
  );
}
