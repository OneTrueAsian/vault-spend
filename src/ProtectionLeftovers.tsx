import { useEffect, useState } from "react";
import { deleteProtectionLeftovers, listProtectionLeftovers, type LeftoverEntry, type LeftoverKind } from "./protection";
import type { Profile } from "./types";

const KIND_LABEL: Record<LeftoverKind, string> = {
  original_database: "Original (unprotected) database",
  plaintext_backup: "Unprotected backup",
  mirrored_plaintext_backup: "Unprotected backup (second copy)",
};

/** A persistent Settings banner offering to delete whatever converting a profile to password
 * protection left behind: the plaintext original file and its backups stay on disk, fully
 * readable, right beside the new encrypted one. There is no separate persisted "already handled"
 * flag — the banner just re-asks the backend whenever the active profile's identity or protected
 * state changes, and renders nothing once that answer comes back empty, so it needs no
 * coordination with whatever screen just turned protection on. */
export function ProtectionLeftovers({ profiles }: { profiles: Profile[] }) {
  const active = profiles.find((p) => p.is_active);
  const [entries, setEntries] = useState<LeftoverEntry[]>([]);
  const [includeMirror, setIncludeMirror] = useState(false);
  const [dismissed, setDismissed] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");

  useEffect(() => {
    if (!active?.is_password_protected) {
      setEntries([]);
      return;
    }
    setDismissed(false);
    setError("");
    listProtectionLeftovers()
      .then(setEntries)
      .catch(() => setEntries([]));
  }, [active?.id, active?.is_password_protected]);

  const visible = entries.filter((e) => includeMirror || e.kind !== "mirrored_plaintext_backup");
  const hasMirrorEntries = entries.some((e) => e.kind === "mirrored_plaintext_backup");

  // Kept visible on an error even if the retry-fetch came back empty (or shorter) — otherwise a
  // partial delete failure would vanish along with the entries that DID delete successfully.
  if (dismissed || (visible.length === 0 && !error)) return null;

  async function deleteAll() {
    setBusy(true);
    setError("");
    try {
      const failed = await deleteProtectionLeftovers(visible.map((e) => e.path));
      if (failed.length > 0) setError(`Couldn't delete: ${failed.join(", ")}`);
      setEntries(await listProtectionLeftovers());
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="card" role="region" aria-label="Leftover plaintext files">
      <div className="card-head">
        <span className="reports-section-title">Plaintext files left behind</span>
      </div>
      {visible.length > 0 && (
        <>
          <p className="modal-message-secondary">
            Turning on password protection made a new, encrypted copy of your data. The original,
            unprotected {visible.length === 1 ? "file is" : "files are"} still on disk and still
            readable by anyone with access to this computer.
          </p>
          <ul className="review-list">
            {visible.map((e) => (
              <li key={e.path}>
                {KIND_LABEL[e.kind]} — {e.path}
              </li>
            ))}
          </ul>
        </>
      )}
      {hasMirrorEntries && (
        <label>
          <input type="checkbox" checked={includeMirror} onChange={(ev) => setIncludeMirror(ev.target.checked)} />
          Also delete the copies in the second backup folder
        </label>
      )}
      {error && (
        <p className="launch-error-problem" role="alert">
          {error}
        </p>
      )}
      <div className="modal-actions">
        <button type="button" className="modal-secondary" onClick={() => setDismissed(true)} disabled={busy}>
          Keep for now
        </button>
        <button type="button" onClick={() => void deleteAll()} disabled={busy || visible.length === 0}>
          Delete plaintext copies now
        </button>
      </div>
    </div>
  );
}
