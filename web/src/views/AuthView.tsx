import { FormEvent, useState } from "react";
import {
  signInPassword,
  signUpPassword,
} from "../hooks/useAuth";

export function AuthView() {
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [isSignUpMode, setIsSignUpMode] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const onSubmit = async (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    setError(null);
    setBusy(true);

    try {
      if (isSignUpMode) {
        await signUpPassword(email, password);
      } else {
        await signInPassword(email, password);
      }
    } catch (err) {
      setError((err as Error).message);
    } finally {
      setBusy(false);
    }
  };

  return (
    <main className="auth-layout">
      <section className="auth-panel">
        <p className="auth-kicker">NASCAR PICK&apos;EM</p>
        <h1>{isSignUpMode ? "Create Account" : "Sign In"}</h1>

        <form onSubmit={onSubmit} className="stack-form auth-form">
          <label htmlFor="auth-email">Email</label>
          <input
            id="auth-email"
            value={email}
            onChange={(event) => setEmail(event.target.value)}
            placeholder="you@example.com"
            type="email"
            autoComplete="email"
            disabled={busy}
            required
          />
          <label htmlFor="auth-password">Password</label>
          <input
            id="auth-password"
            value={password}
            onChange={(event) => setPassword(event.target.value)}
            placeholder={isSignUpMode ? "At least 6 characters" : "Your password"}
            type="password"
            autoComplete={isSignUpMode ? "new-password" : "current-password"}
            minLength={isSignUpMode ? 6 : undefined}
            disabled={busy}
            required
          />
          <button type="submit" className="auth-primary-button" disabled={busy}>
            {busy ? "Working..." : isSignUpMode ? "Create Account" : "Sign In"}
          </button>
          <button
            type="button"
            className="auth-mode-toggle"
            onClick={() => setIsSignUpMode((current) => !current)}
            disabled={busy}
          >
            {isSignUpMode ? "Already have an account? Sign in" : "Need an account? Create one"}
          </button>
        </form>

        {error ? <p className="error-text">{error}</p> : null}
      </section>
    </main>
  );
}
