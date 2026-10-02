import { useEffect, useId, useRef, useState, type FormEvent } from "react";
import { errorMessage } from "./errorMessage";

const LOCKOUT_RE = /^Try again in (\d+) seconds\.$/;

/** A password field + submit button, sharing the exact same focus/error/clear behavior on a failed
 * attempt — used by `ProfileLockScreen` (locked at launch) and the in-app "switch to a protected
 * profile" prompt, so the two never drift apart into two slightly different copies. Moving focus
 * back to the field has to wait for the re-render that clears `busy`, since a disabled control can't
 * take focus — an effect keyed on `error`, not an imperative call inside the submit handler, runs
 * after that commit. */
export function PasswordForm({
  onSubmit,
  onCancel,
  submitLabel,
}: {
  onSubmit: (password: string) => Promise<void>;
  onCancel?: () => void;
  submitLabel: string;
}) {
  const passwordRef = useRef<HTMLInputElement>(null);
  const errorId = useId();
  const [password, setPassword] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const [lockoutRemaining, setLockoutRemaining] = useState<number | null>(null);

  useEffect(() => {
    if (error) passwordRef.current?.focus();
  }, [error]);

  // A lockout error ("Try again in N seconds.") is a snapshot from the moment the attempt was
  // rejected, not a live value — left alone, it would keep claiming a wait that already passed.
  // Count it down locally and clear it once real time actually catches up.
  useEffect(() => {
    const match = LOCKOUT_RE.exec(error);
    setLockoutRemaining(match ? Number(match[1]) : null);
  }, [error]);

  useEffect(() => {
    if (lockoutRemaining === null) return;
    if (lockoutRemaining <= 0) {
      setError("");
      return;
    }
    const timer = setTimeout(() => setLockoutRemaining((s) => (s === null ? null : s - 1)), 1000);
    return () => clearTimeout(timer);
  }, [lockoutRemaining]);

  const displayedError = lockoutRemaining !== null ? `Try again in ${lockoutRemaining} seconds.` : error;

  async function submit(e: FormEvent) {
    e.preventDefault();
    setBusy(true);
    setError("");
    try {
      await onSubmit(password);
    } catch (e) {
      setError(errorMessage(e));
      setPassword("");
    } finally {
      setBusy(false);
    }
  }

  return (
    <form onSubmit={submit} className="password-form">
      <div className="password-form-field">
        <label htmlFor="password-form-field">Password</label>
        <input
          id="password-form-field"
          className="text-input"
          ref={passwordRef}
          type="password"
          autoComplete="current-password"
          autoFocus
          value={password}
          onChange={(e) => setPassword(e.target.value)}
          aria-invalid={error !== ""}
          aria-describedby={error ? errorId : undefined}
          disabled={busy}
        />
      </div>
      <p id={errorId} className="launch-error-problem" role="alert">
        {displayedError}
      </p>
      <div className="launch-error-actions">
        <button type="submit" className="password-form-submit" disabled={busy || password === ""}>
          {submitLabel}
        </button>
        {onCancel && (
          <button type="button" className="modal-secondary" data-password-form-cancel onClick={onCancel} disabled={busy}>
            Cancel
          </button>
        )}
      </div>
    </form>
  );
}
