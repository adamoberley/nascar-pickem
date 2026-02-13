import { useState, useRef, useEffect } from "react";

interface Membership {
  leagueId: string;
  league: { name: string };
}

interface HeaderProps {
  title: string;
  memberships: Membership[];
  selectedLeagueId: string | null;
  onSelectLeague: (leagueId: string) => void;
  onSignOut: () => void;
  /** Payout notes for selected league (shown in dropdown, matches iOS) */
  payoutConfigText?: string | null;
  /** Invite code for selected league (shown in dropdown for admins) */
  inviteCode?: string | null;
  isAdmin?: boolean;
}

function LeagueMenuStripesIcon({ rotated }: { rotated?: boolean }) {
  return (
    <span className={`header-stripes-icon${rotated ? " header-stripes-icon--rotated" : ""}`} aria-hidden>
      <i style={{ flex: "1 1 8.93%", minWidth: 2, background: "var(--nascar-yellow)" }} />
      <i style={{ flex: "0.5 1 4.46%", minWidth: 1, background: "transparent" }} />
      <i style={{ flex: "1 1 8.93%", minWidth: 2, background: "var(--nascar-yellow)" }} />
      <i style={{ flex: "1 1 8.93%", minWidth: 2, background: "transparent" }} />
      <i style={{ flex: "1.6 1 14.29%", minWidth: 3, background: "var(--nascar-red)" }} />
      <i style={{ flex: "0.5 1 4.46%", minWidth: 1, background: "transparent" }} />
      <i style={{ flex: "1.6 1 14.29%", minWidth: 3, background: "var(--nascar-red)" }} />
      <i style={{ flex: "1 1 8.93%", minWidth: 2, background: "transparent" }} />
      <i style={{ flex: "3 1 26.79%", minWidth: 6, background: "var(--nascar-blue)" }} />
    </span>
  );
}

export function Header({
  title,
  memberships,
  selectedLeagueId,
  onSelectLeague,
  onSignOut,
  payoutConfigText,
  inviteCode,
  isAdmin,
}: HeaderProps) {
  const [menuOpen, setMenuOpen] = useState(false);
  const menuRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (!menuOpen) return;
    const close = (e: MouseEvent) => {
      if (menuRef.current && !menuRef.current.contains(e.target as Node)) {
        setMenuOpen(false);
      }
    };
    document.addEventListener("click", close);
    return () => document.removeEventListener("click", close);
  }, [menuOpen]);

  const showPayoutNotes = payoutConfigText != null && payoutConfigText.trim() !== "";
  const showInviteCode = isAdmin && inviteCode != null && inviteCode.trim() !== "";

  return (
    <header className="app-header">
      <div className="app-header-inner">
        <div className="app-header-brand">
          <img
            src="/NASCAR_Icon.png"
            alt=""
            className="app-header-logo-img"
            width={38}
            height={38}
          />
          <h1 className="app-header-title">{title}</h1>
        </div>

        <div className="app-header-trailing" ref={menuRef}>
          <button
            type="button"
            className="app-header-menu-btn"
            onClick={() => setMenuOpen((o) => !o)}
            aria-expanded={menuOpen}
            aria-haspopup="true"
            aria-label="League menu"
          >
            <LeagueMenuStripesIcon rotated={menuOpen} />
          </button>
          {menuOpen && (
            <div className="app-header-dropdown">
              {memberships.map((m) => (
                <button
                  key={m.leagueId}
                  type="button"
                  className="app-header-dropdown-item"
                  onClick={() => {
                    onSelectLeague(m.leagueId);
                    setMenuOpen(false);
                  }}
                >
                  {m.league.name}
                  {m.leagueId === selectedLeagueId ? (
                    <span className="app-header-check" aria-hidden>✓</span>
                  ) : null}
                </button>
              ))}
              {showPayoutNotes && (
                <>
                  <hr className="app-header-divider" />
                  <div className="app-header-dropdown-notes">
                    <span className="app-header-dropdown-notes-title">Payout Notes</span>
                    <span className="app-header-dropdown-notes-text">{payoutConfigText}</span>
                  </div>
                </>
              )}
              {showInviteCode && (
                <>
                  <hr className="app-header-divider" />
                  <div className="app-header-dropdown-notes">
                    <span className="app-header-dropdown-notes-title">Invite Code</span>
                    <span className="app-header-dropdown-notes-code">{inviteCode}</span>
                  </div>
                </>
              )}
              <hr className="app-header-divider" />
              <button
                type="button"
                className="app-header-dropdown-item app-header-signout"
                onClick={() => {
                  onSignOut();
                  setMenuOpen(false);
                }}
              >
                Sign Out
              </button>
            </div>
          )}
        </div>
      </div>
    </header>
  );
}
