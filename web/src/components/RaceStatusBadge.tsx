interface Props {
  label: string;
  tone: "live" | "finished" | "unofficial";
}

export function RaceStatusBadge({ label, tone }: Props) {
  return <span className={`race-status-badge race-status-badge--${tone}`}>{label}</span>;
}
