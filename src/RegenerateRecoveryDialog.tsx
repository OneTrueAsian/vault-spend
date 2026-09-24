import { useState } from "react";
import { ModalShell } from "./Modal";
import {
  beginRegenerateRecovery,
  cancelProtectionSetup,
  commitRegenerateRecovery,
  type SetupChallenge,
} from "./protection";

type Step = "current" | "recovery" | "confirm";

export function RegenerateRecoveryDialog({
  expectedGeneration,
  onDone,
  onCancel,
}: {
  expectedGeneration: number;
  onDone: () => void;
  onCancel: () => void;
}) {
  const [step, setStep] = useState<Step>("current");
  const [currentPassword, setCurrentPassword] = useState("");
  const [challenge, setChallenge] = useState<SetupChallenge | null>(null);
  const [answers, setAnswers] = useState<[string, string]>(["", ""]);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");

  async function begin() {
    setBusy(true);
    setError("");
    try {
      setChallenge(await beginRegenerateRecovery(currentPassword, expectedGeneration));
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
      const committedRecovery = await commitRegenerateRecovery(challenge.token, answers);
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

  const stepNumber = step === "current" ? 1 : step === "recovery" ? 2 : 3;
  const stepLabel = step === "current" ? "Current password" : step === "recovery" ? "Save recovery key" : "Confirm recovery key";

  return (
    <ModalShell title="Regenerate recovery key" onCancel={cancel}>
      <div className="protection-setup regenerate-recovery-dialog">
        <p className="protection-setup-step">Step {stepNumber} of 3 · {stepLabel}</p>
        {step === "current" && (
          <>
            <p className="modal-message modal-message-secondary">Enter your current password. Your password and financial data will not change.</p>
            <div className="password-form-field">
              <label htmlFor="regenerate-recovery-current">Current password</label>
              <input id="regenerate-recovery-current" className="text-input" type="password" autoComplete="current-password" autoFocus value={currentPassword} onChange={(event) => setCurrentPassword(event.target.value)} disabled={busy} />
            </div>
            {error && <p className="launch-error-problem" role="alert">{error}</p>}
            <div className="modal-actions">
              <button type="button" className="modal-secondary" onClick={cancel} disabled={busy}>Cancel</button>
              <button type="button" onClick={begin} disabled={busy || currentPassword === ""}>Continue</button>
            </div>
          </>
        )}
        {step === "recovery" && challenge && (
          <>
            <p className="modal-message">Write down this new recovery key. Your previous recovery key will stop working.</p>
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
                <label htmlFor={`regenerate-recovery-answer-${index}`}>Group {challenge.challenge_group_indices[index] + 1}</label>
                <input id={`regenerate-recovery-answer-${index}`} className="text-input" autoFocus={index === 0} value={answers[index]} onChange={(event) => setAnswers(index === 0 ? [event.target.value, answers[1]] : [answers[0], event.target.value])} disabled={busy} />
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
