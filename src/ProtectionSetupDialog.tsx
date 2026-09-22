import { useState } from "react";
import { ModalShell } from "./Modal";
import { beginProtectionSetup, cancelProtectionSetup, commitProtectionSetup, type SetupChallenge } from "./protection";
import type { StartupState } from "./startup";

type Step = "password" | "recovery" | "confirm";

function scalarLength(s: string): number {
  return Array.from(s.normalize("NFC")).length;
}

/** The 3-step password-and-recovery-key wizard shared by "turn on password protection for this
 * profile" and "create a new protected profile" — which of those two this is for is expressed by
 * exactly one of `targetProfileId`/`newProfileName` being set, mirroring `commitProtectionSetup`'s
 * own two nullable arguments rather than re-deriving a union type on top of them. */
export function ProtectionSetupDialog({
  targetProfileId,
  newProfileName,
  expectedGeneration,
  onDone,
  onCancel,
}: {
  targetProfileId: string | null;
  newProfileName: string | null;
  expectedGeneration: number;
  onDone: (next: StartupState) => void;
  onCancel: () => void;
}) {
  const [step, setStep] = useState<Step>("password");
  const [password, setPassword] = useState("");
  const [confirmValue, setConfirmValue] = useState("");
  const [challenge, setChallenge] = useState<SetupChallenge | null>(null);
  const [answers, setAnswers] = useState<[string, string]>(["", ""]);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");

  const lengthOk = scalarLength(password) >= 8;
  const matches = password === confirmValue;

  async function startRecovery() {
    setBusy(true);
    setError("");
    try {
      setChallenge(await beginProtectionSetup(password, expectedGeneration));
      setStep("recovery");
    } catch (e) {
      setError(String(e));
    } finally {
      setBusy(false);
    }
  }

  async function commit() {
    if (!challenge) return;
    setBusy(true);
    setError("");
    try {
      onDone(await commitProtectionSetup(challenge.token, answers, targetProfileId, newProfileName));
    } catch (e) {
      setError(String(e));
    } finally {
      setBusy(false);
    }
  }

  async function cancel() {
    if (challenge) await cancelProtectionSetup(challenge.token);
    onCancel();
  }

  return (
    <ModalShell title="Protect this profile with a password" onCancel={cancel}>
      {step === "password" && (
        <>
          <label htmlFor="protection-setup-password">Password</label>
          <input
            id="protection-setup-password"
            type="password"
            autoFocus
            value={password}
            onChange={(e) => setPassword(e.target.value)}
            disabled={busy}
          />
          <label htmlFor="protection-setup-confirm">Confirm password</label>
          <input
            id="protection-setup-confirm"
            type="password"
            value={confirmValue}
            onChange={(e) => setConfirmValue(e.target.value)}
            disabled={busy}
          />
          {error && (
            <p className="launch-error-problem" role="alert">
              {error}
            </p>
          )}
          <div className="modal-actions">
            <button type="button" className="modal-secondary" onClick={cancel} disabled={busy}>
              Cancel
            </button>
            <button type="button" onClick={startRecovery} disabled={busy || !lengthOk || !matches}>
              Continue
            </button>
          </div>
        </>
      )}
      {step === "recovery" && challenge && (
        <>
          <p className="modal-message">
            Write this recovery key down and keep it somewhere safe. If you forget your password, this is the only
            way back into this profile.
          </p>
          <p className="path-box" style={{ userSelect: "text" }}>
            {challenge.recovery_display}
          </p>
          <div className="modal-actions">
            <button type="button" className="modal-secondary" onClick={cancel}>
              Cancel
            </button>
            <button type="button" onClick={() => setStep("confirm")}>
              I&apos;ve saved it
            </button>
          </div>
        </>
      )}
      {step === "confirm" && challenge && (
        <>
          <p className="modal-message">
            To confirm you saved it, type groups {challenge.challenge_group_indices[0] + 1} and{" "}
            {challenge.challenge_group_indices[1] + 1} below.
          </p>
          <label htmlFor="protection-setup-answer-0">{`Group ${challenge.challenge_group_indices[0] + 1}`}</label>
          <input
            id="protection-setup-answer-0"
            autoFocus
            value={answers[0]}
            onChange={(e) => setAnswers([e.target.value, answers[1]])}
            disabled={busy}
          />
          <label htmlFor="protection-setup-answer-1">{`Group ${challenge.challenge_group_indices[1] + 1}`}</label>
          <input
            id="protection-setup-answer-1"
            value={answers[1]}
            onChange={(e) => setAnswers([answers[0], e.target.value])}
            disabled={busy}
          />
          {error && (
            <p className="launch-error-problem" role="alert">
              {error}
            </p>
          )}
          <div className="modal-actions">
            <button type="button" className="modal-secondary" onClick={cancel} disabled={busy}>
              Cancel
            </button>
            <button type="button" onClick={commit} disabled={busy || answers[0] === "" || answers[1] === ""}>
              Finish
            </button>
          </div>
        </>
      )}
    </ModalShell>
  );
}
