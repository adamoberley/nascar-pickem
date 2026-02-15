import { FormEvent, useState } from "react";
import { createLeague, joinLeagueByInvite } from "../lib/api";
import { logout } from "../hooks/useAuth";

interface Props {
  onJoined: () => Promise<void>;
}

export function LeagueAccessView({ onJoined }: Props) {
  const [displayName, setDisplayName] = useState("");
  const [inviteCode, setInviteCode] = useState("");
  const [leagueName, setLeagueName] = useState("");
  const [seasonYear, setSeasonYear] = useState(new Date().getFullYear());
  const [newInviteCode, setNewInviteCode] = useState("");
  const [payoutConfigText, setPayoutConfigText] = useState("");

  const [busy, setBusy] = useState(false);
  const [message, setMessage] = useState("");
  const [error, setError] = useState<string | null>(null);

  const handleJoin = async (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    setBusy(true);
    setMessage("");
    setError(null);

    try {
      await joinLeagueByInvite({
        inviteCode,
        displayName: displayName.trim(),
      });
      setMessage("Joined league successfully.");
      await new Promise((resolve) => setTimeout(resolve, 2000));
      await onJoined();
    } catch (err) {
      setError((err as Error).message);
    } finally {
      setBusy(false);
    }
  };

  const onCreateLeague = async (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    setBusy(true);
    setMessage("");
    setError(null);

    try {
      const response = await createLeague({
        name: leagueName,
        seasonYear,
        inviteCode: newInviteCode,
        payoutConfigText,
      });
      setMessage(`League created with invite code ${response.inviteCode}.`);
      await onJoined();
    } catch (err) {
      setError((err as Error).message);
    } finally {
      setBusy(false);
    }
  };

  return (
    <main className="setup-layout">
      <section className="setup-panel">
        <h2>JOIN LEAGUE</h2>
        <p className="setup-description">
          Use your invite code to connect to an existing NASCAR Pick&apos;Em league.
        </p>
        <form onSubmit={handleJoin} className="stack-form">
          <label htmlFor="invite-code">Invite Code</label>
          <input
            id="invite-code"
            value={inviteCode}
            onChange={(event) => setInviteCode(event.target.value.toUpperCase())}
            placeholder="RACER-2026"
            required
          />
          <label htmlFor="display-name">First and Last Name</label>
          <input
            id="display-name"
            value={displayName}
            onChange={(event) => setDisplayName(event.target.value)}
            placeholder="Your name"
            required
          />
          <button type="submit" className="setup-join-button" disabled={busy || !(displayName.trim() && inviteCode.trim())}>
            Join League
          </button>
        </form>
      </section>

      <section className="setup-panel">
        <h2>CREATE LEAGUE</h2>
        <form onSubmit={onCreateLeague} className="stack-form">
          <label htmlFor="league-name">League Name</label>
          <input
            id="league-name"
            value={leagueName}
            onChange={(event) => setLeagueName(event.target.value)}
            placeholder="Sunday Pit Crew"
            required
          />
          <label htmlFor="season-year">Season Year</label>
          <input
            id="season-year"
            type="number"
            value={seasonYear}
            onChange={(event) => setSeasonYear(Number(event.target.value))}
            min={2020}
            max={2100}
            required
          />
          <label htmlFor="new-invite-code">Invite Code</label>
          <input
            id="new-invite-code"
            value={newInviteCode}
            onChange={(event) => setNewInviteCode(event.target.value.toUpperCase())}
            placeholder="RACER-2026"
            required
          />
          <label htmlFor="payout-config">Payout Notes (Optional)</label>
          <textarea
            id="payout-config"
            value={payoutConfigText}
            onChange={(event) => setPayoutConfigText(event.target.value)}
            placeholder="1st: $200, 2nd: $100"
            rows={4}
          />
          <button type="submit" disabled={busy}>
            Create League
          </button>
        </form>
      </section>

      {message ? <p className="success-text full-row">{message}</p> : null}
      {error ? <p className="error-text full-row">{error}</p> : null}
      <div className="full-row sign-out-row">
        <button type="button" onClick={() => void logout()} className="secondary-button sign-out-button">
          Sign Out
        </button>
      </div>
    </main>
  );
}
