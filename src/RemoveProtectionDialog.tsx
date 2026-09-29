import { useState } from "react";
import { ModalShell } from "./Modal";
import { removeProtection, verifyCurrentPassword } from "./protection";

export function RemoveProtectionDialog({ expectedGeneration, onDone, onCancel }: { expectedGeneration: number; onDone: () => void; onCancel: () => void }) {
  const [step, setStep] = useState<"password" | "warning">("password");
  const [password, setPassword] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  async function verify() {
    setBusy(true); setError("");
    try { await verifyCurrentPassword(password, expectedGeneration); setStep("warning"); }
    catch (reason) { setError(String(reason)); }
    finally { setBusy(false); }
  }
  async function remove() {
    setBusy(true); setError("");
    try { await removeProtection(password, expectedGeneration); onDone(); }
    catch (reason) { setError(String(reason)); setBusy(false); }
  }
  return <ModalShell title="Remove password protection" onCancel={onCancel}>
    <div className="protection-setup remove-protection-dialog">
      {step === "password" ? <>
        <p className="modal-message modal-message-secondary">Enter your current password first.</p>
        <div className="password-form-field"><label htmlFor="remove-protection-current">Current password</label><input id="remove-protection-current" className="text-input" type="password" autoFocus value={password} onChange={(event) => setPassword(event.target.value)} disabled={busy} /></div>
        {error && <p className="launch-error-problem" role="alert">{error}</p>}
        <div className="modal-actions"><button type="button" className="modal-secondary" onClick={onCancel}>Cancel</button><button type="button" onClick={verify} disabled={busy || !password}>Continue</button></div>
      </> : <>
        <p className="modal-message">Removing protection means the data file and future backups become readable by others signed into this computer.</p>
        <p className="modal-message modal-message-secondary">One final encrypted rollback backup will be kept.</p>
        {error && <p className="launch-error-problem" role="alert">{error}</p>}
        <div className="modal-actions"><button type="button" className="modal-secondary" onClick={onCancel}>Cancel</button><button type="button" className="danger-button" onClick={remove} disabled={busy}>Remove protection</button></div>
      </>}
    </div>
  </ModalShell>;
}
