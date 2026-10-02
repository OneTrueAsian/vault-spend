import { useState } from "react";
import { invoke } from "@tauri-apps/api/core";
import type { StartupState } from "./startup";
import { errorMessage } from "./errorMessage";

/** The registry exists but lists no profiles — a real, if unusual, state (deleting every entry, or
 * a hand-edited file) that must never silently open or invent a Default profile. The only way out
 * is creating a profile, which — like the existing in-app "create a profile" flow — opens it
 * immediately once made. Reuses `LaunchErrorScreen`'s card shell, same reasoning as `ProfileSelector`. */
export function EmptyRegistryScreen({ onResolved }: { onResolved: (next: StartupState) => void }) {
  const [name, setName] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");

  async function create() {
    setBusy(true);
    setError("");
    try {
      await invoke<string>("create_profile", { name });
      onResolved({ status: "open" });
    } catch (e) {
      setError(errorMessage(e));
    } finally {
      setBusy(false);
    }
  }

  return (
    <main className="launch-error" data-empty-registry>
      <div className="launch-error-card">
        <h1 tabIndex={-1}>No profiles are set up yet</h1>
        <p>Create one to get started.</p>
        <div className="password-form-field">
          <label htmlFor="empty-registry-name">Profile name</label>
          <input className="text-input" id="empty-registry-name" value={name} onChange={(e) => setName(e.target.value)} disabled={busy} />
        </div>
        <p className="launch-error-problem" role="alert">
          {error}
        </p>
        <button type="button" data-create-profile onClick={create} disabled={busy || name.trim() === ""}>
          Create a profile
        </button>
      </div>
    </main>
  );
}
