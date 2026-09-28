import { useState } from "react";
import { ModalShell } from "./Modal";
import { beginRecovery, cancelProtectionSetup, commitRecovery, verifyRecoveryCode, type SetupChallenge } from "./protection";

type Step = "code" | "new" | "recovery" | "confirm";

const scalarLength = (value: string) => Array.from(value.normalize("NFC")).length;

export function RecoverProfileDialog({
  profileId,
  expectedGeneration,
  onDone,
  onCancel,
}: {
  profileId: string;
  expectedGeneration: number;
  onDone: () => void;
  onCancel: () => void;
}) {
  const [step, setStep] = useState<Step>("code");
  const [code, setCode] = useState("");
  const [newPassword, setNewPassword] = useState("");
  const [confirmValue, setConfirmValue] = useState("");
  const [challenge, setChallenge] = useState<SetupChallenge | null>(null);
  const [answers, setAnswers] = useState<[string, string]>(["", ""]);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");

  async function checkCode() {
    setBusy(true);
    setError("");
    try {
      await verifyRecoveryCode(profileId, code);
      setStep("new");
    } catch (reason) {
      setError(String(reason));
    } finally {
      setBusy(false);
    }
  }

  async function startChallenge() {
    setBusy(true);
    setError("");
    try {
      setChallenge(await beginRecovery(profileId, code, newPassword, expectedGeneration));
      setStep("recovery");
    } catch (reason) {
      setError(String(reason));
    } finally {
      setBusy(false);
    }
  }

  async function commit() {
    if (!challenge) return;
    setBusy(true);
    setError("");
    try {
      const committedRecovery = await commitRecovery(profileId, code, challenge.token, answers);
      if (committedRecovery !== challenge.recovery_display) {
        throw new Error("The saved recovery key did not match the committed key.");
      }
      onDone();
    } catch (reason) {
      setError(String(reason));
    } finally {
      setBusy(false);
    }
  }

  async function cancel() {
    if (challenge) await cancelProtectionSetup(challenge.token);
    onCancel();
  }

  const matches = newPassword === confirmValue;
  const stepNumber = step === "code" ? 1 : step === "new" ? 2 : step === "recovery" ? 3 : 4;
  const stepLabel = step === "code" ? "Recovery key" : step === "new" ? "New password" : step === "recovery" ? "Save recovery key" : "Confirm recovery key";

  return (
    <ModalShell title="Recover this profile" onCancel={cancel}>
      <div className="protection-setup recover-profile-dialog">
        <p className="protection-setup-step">Step {stepNumber} of 4 · {stepLabel}</p>
        {step === "code" && (
          <>
            <p className="modal-message modal-message-secondary">Enter the recovery key you saved when protection was set up.</p>
            <div className="password-form-field">
              <label htmlFor="recover-profile-code">Recovery key</label>
              <input id="recover-profile-code" className="text-input" autoFocus value={code} onChange={(event) => setCode(event.target.value)} disabled={busy} />
            </div>
            {error && <p className="launch-error-problem" role="alert">{error}</p>}
            <div className="modal-actions">
              <button type="button" className="modal-secondary" onClick={cancel} disabled={busy}>Cancel</button>
              <button type="button" onClick={checkCode} disabled={busy || code === ""}>Continue</button>
            </div>
          </>
        )}
        {step === "new" && (
          <>
            <p className="modal-message modal-message-secondary">Choose a new password for this profile.</p>
            <div className="password-form-field">
              <label htmlFor="recover-profile-new">New password</label>
              <input id="recover-profile-new" className="text-input" type="password" autoComplete="new-password" autoFocus value={newPassword} onChange={(event) => setNewPassword(event.target.value)} disabled={busy} />
              <p className="protection-setup-hint">At least 8 characters.</p>
            </div>
            <div className="password-form-field">
              <label htmlFor="recover-profile-confirm">Confirm new password</label>
              <input id="recover-profile-confirm" className="text-input" type="password" autoComplete="new-password" value={confirmValue} onChange={(event) => setConfirmValue(event.target.value)} aria-invalid={confirmValue.length > 0 && !matches} disabled={busy} />
              {confirmValue.length > 0 && !matches && <p className="protection-setup-hint protection-setup-error">Passwords do not match.</p>}
            </div>
            {error && <p className="launch-error-problem" role="alert">{error}</p>}
            <div className="modal-actions">
              <button type="button" className="modal-secondary" onClick={cancel} disabled={busy}>Cancel</button>
              <button type="button" onClick={startChallenge} disabled={busy || scalarLength(newPassword) < 8 || !matches}>Continue</button>
            </div>
          </>
        )}
        {step === "recovery" && challenge && (
          <>
            <p className="modal-message">Write down this new recovery key. The key you just used to recover will stop working.</p>
            <p className="path-box protection-setup-key">{challenge.recovery_display}</p>
            <div className="modal-actions">
              <button type="button" className="modal-secondary" onClick={cancel}>Cancel</button>
              <button type="button" autoFocus onClick={() => setStep("confirm")}>I&apos;ve saved it</button>
            </div>
          </>
        )}
        {step === "confirm" && challenge && (
          <>
            <p className="modal-message">Type the characters from groups {challenge.challenge_group_indices[0] + 1} and {challenge.challenge_group_indices[1] + 1} of the recovery key you just saved.</p>
            {[0, 1].map((index) => (
              <div className="password-form-field" key={index}>
                <label htmlFor={`recover-profile-answer-${index}`}>Group {challenge.challenge_group_indices[index] + 1}</label>
                <input id={`recover-profile-answer-${index}`} className="text-input" autoFocus={index === 0} value={answers[index]} onChange={(event) => setAnswers(index === 0 ? [event.target.value, answers[1]] : [answers[0], event.target.value])} disabled={busy} />
              </div>
            ))}
            {error && <p className="launch-error-problem" role="alert">{error}</p>}
            <div className="modal-actions">
              <button type="button" className="modal-secondary" onClick={cancel} disabled={busy}>Cancel</button>
              <button type="button" onClick={commit} disabled={busy || answers.some((answer) => answer === "")}>Finish</button>
            </div>
          </>
        )}
      </div>
    </ModalShell>
  );
}
