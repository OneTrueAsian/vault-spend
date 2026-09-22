import { useState } from "react";
import { selectProfile } from "./protection";
import type { SelectorEntry, StartupState } from "./startup";

/** Up to three profiles: a plain list. Four or more: a labelled drop-down. Neither view shows
 * anything about a profile's contents — only its name and, for a protected one, a lock glyph with
 * screen-reader text. Selecting is a single backend round trip; the backend decides whether that
 * lands on Open or Locked, this component never guesses. Reuses the launch-error screen's own card
 * styling (`.launch-error`/`.launch-error-card`) — this is the same shape of thing, a full-screen
 * gate shown instead of the app, so there's nothing new to design. */
export function ProfileSelector({
  profiles,
  lastUsedId,
  onResolved,
}: {
  profiles: SelectorEntry[];
  lastUsedId: string | null;
  onResolved: (next: StartupState) => void;
}) {
  const [selected, setSelected] = useState(lastUsedId ?? profiles[0]?.id ?? "");
  const [busy, setBusy] = useState(false);
  const [problem, setProblem] = useState("");

  async function open(id: string) {
    setBusy(true);
    setProblem("");
    try {
      onResolved(await selectProfile(id));
    } catch (e) {
      setProblem(String(e));
    } finally {
      setBusy(false);
    }
  }

  return (
    <main className="launch-error" data-profile-selector>
      <div className="launch-error-card">
        <h1 id="profile-selector-heading" tabIndex={-1}>
          Choose a profile
        </h1>
        {profiles.length <= 3 ? (
          <ul className="profile-selector-list">
            {profiles.map((p) => (
              <li key={p.id}>
                <button type="button" data-profile-option disabled={busy} onClick={() => open(p.id)} autoFocus={p.id === selected}>
                  <span>{p.name}</span>
                  {p.is_password_protected && <span aria-label="Password protected">🔒</span>}
                </button>
              </li>
            ))}
          </ul>
        ) : (
          <div className="profile-selector-dropdown-row">
            <label htmlFor="profile-selector-dropdown">Profile</label>
            <select id="profile-selector-dropdown" value={selected} onChange={(e) => setSelected(e.target.value)} disabled={busy}>
              {profiles.map((p) => (
                <option key={p.id} value={p.id}>
                  {p.name}
                  {p.is_password_protected ? " (password protected)" : ""}
                </option>
              ))}
            </select>
            <button type="button" disabled={busy || !selected} onClick={() => open(selected)}>
              Continue
            </button>
          </div>
        )}
        <p className="launch-error-problem" role="alert">
          {problem}
        </p>
      </div>
    </main>
  );
}
