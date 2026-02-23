interface Props {
  label: string;
  tone: "live" | "finished" | "unofficial";
}

export function RaceStatusBadge({ label, tone }: Props) {
  return (
    <span className={`race-status-badge race-status-badge--${tone}`}>
      <svg
        className="race-status-badge-icon"
        viewBox="0 0 24 24"
        role="img"
        aria-hidden
      >
        <path
          fill="currentColor"
          d="M4.8 12.2h1.4l.9-2.3a2 2 0 0 1 1.86-1.27h6.02c.83 0 1.57.5 1.86 1.27l.9 2.3h1.4A2.2 2.2 0 0 1 21.4 14v2.4a2.2 2.2 0 0 1-2.2 2.2h-.5a2.6 2.6 0 0 1-5.2 0h-3a2.6 2.6 0 0 1-5.2 0h-.5a2.2 2.2 0 0 1-2.2-2.2V14a2.2 2.2 0 0 1 2.2-1.8Zm3.3-1.2h7.8l-.56-1.44a.7.7 0 0 0-.65-.44H8.75a.7.7 0 0 0-.65.44L7.54 11ZM6.9 16.8a1.1 1.1 0 1 0 0 .01v-.01Zm10.2 0a1.1 1.1 0 1 0 0 .01v-.01ZM5.2 13.6a.8.8 0 1 0 0 1.6h.5a2.6 2.6 0 0 1 2.4-1.6h7.8a2.6 2.6 0 0 1 2.4 1.6h.5a.8.8 0 1 0 0-1.6H5.2Z"
        />
      </svg>
      <span>{label}</span>
    </span>
  );
}
