import { useEffect, useRef, useState, type ReactNode } from "react";
import { bundledLegalNotice } from "./legalNotice";
import { acknowledgeLegalNotice, getLegalNoticeAcknowledgement } from "./legalNoticeApi";
import { LegalNoticeText } from "./LegalNoticeText";
import { errorMessage } from "./errorMessage";

type Phase = "pending" | "show" | "through";

// Shows the legal notice once per version, before the profile picker or any lock screen. It is a notice,
// not a click-through contract, so there is one button and nothing here can keep someone out of the app:
// if the acknowledgement cannot be read, the app opens; if it cannot be saved, the button offers to
// continue anyway.
export function LegalNoticeGate({ children }: { children: ReactNode }) {
  const [phase, setPhase] = useState<Phase>("pending");
  const [previous, setPrevious] = useState<string | null>(null);
  const [problem, setProblem] = useState("");
  const [busy, setBusy] = useState(false);
  const headingRef = useRef<HTMLHeadingElement>(null);

  useEffect(() => {
    let cancelled = false;
    getLegalNoticeAcknowledgement()
      .then((ack) => {
        if (cancelled) return;
        if (ack.skip || ack.version === bundledLegalNotice.version) {
          setPhase("through");
        } else {
          setPrevious(ack.version);
          setPhase("show");
        }
      })
      .catch(() => {
        if (!cancelled) setPhase("through");
      });
    return () => {
      cancelled = true;
    };
  }, []);

  useEffect(() => {
    if (phase === "show") headingRef.current?.focus();
  }, [phase]);

  async function acknowledge() {
    if (problem) {
      setPhase("through");
      return;
    }
    setBusy(true);
    try {
      await acknowledgeLegalNotice(bundledLegalNotice.version);
      setPhase("through");
    } catch (e) {
      setProblem(`Your choice couldn't be saved (${errorMessage(e)}), so this notice may appear again next time.`);
    } finally {
      setBusy(false);
    }
  }

  if (phase === "pending") return null;
  if (phase === "through") return <>{children}</>;
  return (
    <main className="legal-notice" data-legal-notice>
      <div className="legal-notice-card">
        <h1 ref={headingRef} tabIndex={-1}>
          Legal notice
        </h1>
        <p className="legal-notice-version">Version {bundledLegalNotice.version}</p>
        {previous !== null && (
          <p className="legal-notice-changed" data-legal-notice-changed>
            <strong>What changed:</strong> {bundledLegalNotice.whatChanged}
          </p>
        )}
        <section aria-label="Summary" className="legal-notice-summary">
          <h2>In short</h2>
          <LegalNoticeText blocks={bundledLegalNotice.summary} />
        </section>
        <details className="legal-notice-full">
          <summary>Read the full notice</summary>
          <div className="legal-notice-scroll" tabIndex={0}>
            <LegalNoticeText blocks={bundledLegalNotice.full} />
          </div>
        </details>
        <p className="legal-notice-problem" role="alert" data-legal-notice-problem>
          {problem}
        </p>
        <div className="legal-notice-actions">
          <button type="button" className="primary" disabled={busy} data-legal-notice-ok onClick={() => void acknowledge()}>
            {problem ? "Continue anyway" : "OK, I've read this"}
          </button>
        </div>
      </div>
    </main>
  );
}
