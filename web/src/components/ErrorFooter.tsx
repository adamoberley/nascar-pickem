type MaybeError = string | null | undefined;

export function ErrorFooter({ errors }: { errors: MaybeError[] }) {
  const visible = errors.filter((err): err is string => Boolean(err));
  if (visible.length === 0) return null;
  return (
    <footer className="error-footer">
      <ul className="error-footer-list">
        {visible.map((err, i) => (
          <li key={i}>{err}</li>
        ))}
      </ul>
    </footer>
  );
}
