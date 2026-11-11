import { useState, FormEvent } from "react";
import { errorMessage } from "../../shared/lib/errorMessage";
import { ModalShell } from "../../shared/ui/Modal";

/** The last step of "Use existing file" in Settings → Profiles: the native
 * file picker (driven by `App.tsx`, same as every other file-open in this
 * app) has already returned `path`; this just asks what to call the new
 * profile before registering it. Mirrors `NewAccountDialog`'s shape more
 * than `ProfilesSection`'s own inline "New profile" form, since a picked
 * file (unlike a brand-new empty profile) needs its path shown so the user
 * can confirm it's the right one before it becomes live. */
export function UseExistingDataFileDialog({
  path,
  isProtectedPackage = false,
  requiresPassword = false,
  onCancel,
  onSubmit,
}: {
  path: string;
  isProtectedPackage?: boolean;
  /** A bare, in-place `.db` that's encrypted (its `.key` sits beside it) — unlike a `.vaultspend`
   * package, nothing is copied, but a password is still needed to open it. Lets a profile removed
   * from the list ("forgot the password? remove it" or a plain Delete) be re-added with the correct
   * password or recovery key, matching what the lock screen's own wording already promises. */
  requiresPassword?: boolean;
  onCancel: () => void;
  onSubmit: (name: string, password?: string) => void | Promise<void>;
}) {
  const needsPassword = isProtectedPackage || requiresPassword;
  const [name, setName] = useState("");
  const [password, setPassword] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");

  async function handleSubmit(e: FormEvent) {
    e.preventDefault();
    if (!name.trim() || (needsPassword && !password)) return;
    setBusy(true);
    setError("");
    try {
      await onSubmit(name.trim(), needsPassword ? password : undefined);
    } catch (e) {
      setError(errorMessage(e));
      setPassword("");
    } finally {
      setBusy(false);
    }
  }

  return (
    <ModalShell title={isProtectedPackage ? "Import a protected profile" : "Use an existing data file"} onCancel={onCancel}>
      <p className="modal-message-secondary" style={{ userSelect: "text", wordBreak: "break-all" }}>
        {path}
      </p>
      <p className="modal-message modal-message-secondary">
        {isProtectedPackage
          ? "The encrypted database and its protection information will be verified, then copied into Vault Spend as a new profile. The package stays unchanged."
          : "Vault Spend will start using this file right away, registered as a new profile you can switch away from anytime. The file stays exactly where it is — nothing is copied or moved."}
      </p>
      <form onSubmit={handleSubmit}>
        <label className="modal-field">
          <span>Profile name</span>
          <input
            autoFocus
            value={name}
            onChange={(e) => setName(e.target.value)}
            placeholder='e.g. "Old Laptop"'
          />
        </label>
        {needsPassword && (
          <label className="modal-field">
            <span>{isProtectedPackage ? "Package password" : "Password"}</span>
            <input
              type="password"
              autoComplete="current-password"
              value={password}
              onChange={(e) => setPassword(e.target.value)}
              disabled={busy}
            />
          </label>
        )}
        <p className="launch-error-problem" role="alert">{error}</p>
        <div className="modal-actions">
          <button type="button" className="modal-secondary" onClick={onCancel} disabled={busy}>
            Cancel
          </button>
          <button type="submit" disabled={busy || !name.trim() || (needsPassword && !password)}>
            {isProtectedPackage ? "Import profile" : "Use this file"}
          </button>
        </div>
      </form>
    </ModalShell>
  );
}
