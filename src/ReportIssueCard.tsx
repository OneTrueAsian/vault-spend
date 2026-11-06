import { useEffect, useRef, useState } from "react";
import { openUrl } from "@tauri-apps/plugin-opener";

/** The public Jira form for bug and issue reports (owner-supplied, 5 Nov 2026). Nothing is ever added to it: no profile, financial data, logs or screenshots. */
export const REPORT_ISSUE_URL =
  "https://joeyfaas.atlassian.net/jira/software/form/b05db02e-19ee-4c91-88bb-ecb2a069c70a?atlOrigin=eyJpIjoiOGVhYTZjZWRhMjA5NDU4NzgxY2RlOTEyY2NjZGZiOWIiLCJwIjoiaiJ9";

/** Help's "Report a bug or issue" card. The form stays outside the app: the button hands the address to the system browser, and if that
 * fails the person gets the link to copy or select. Both live regions stay on the page so a screen reader announces what appears in them. */
export function ReportIssueCard() {
  const [opened, setOpened] = useState(false);
  const [openFailed, setOpenFailed] = useState(false);
  const [copied, setCopied] = useState(false);
  const [copyFailed, setCopyFailed] = useState(false);
  const [busy, setBusy] = useState(false);
  const opening = useRef(false);
  const live = useRef(true);
  useEffect(() => {
    live.current = true;
    return () => { live.current = false; };
  }, []);

  async function open() {
    if (opening.current) return;
    opening.current = true;
    setBusy(true);
    setOpened(false);
    setOpenFailed(false);
    setCopied(false);
    setCopyFailed(false);
    try {
      await openUrl(REPORT_ISSUE_URL);
      if (live.current) setOpened(true);
    } catch {
      if (live.current) setOpenFailed(true);
    } finally {
      opening.current = false;
      if (live.current) setBusy(false);
    }
  }

  async function copy() {
    setCopied(false);
    setCopyFailed(false);
    try {
      await navigator.clipboard.writeText(REPORT_ISSUE_URL);
      if (live.current) setCopied(true);
    } catch {
      if (live.current) setCopyFailed(true);
    }
  }

  return (
    <div className="card report-issue">
      <h2 className="reports-section-title">Found a problem?</h2>
      <p>
        Tell us what went wrong or what could be better. The button opens a short form in your web browser, and the form asks for your email
        address. Nothing from your budget, accounts or files is sent unless you type it into the form yourself.
      </p>
      <div className="report-issue-actions">
        <button type="button" aria-disabled={busy || undefined} onClick={() => void open()}>
          Report a bug or issue
        </button>
        {openFailed && (
          <button type="button" className="modal-secondary" onClick={() => void copy()}>
            Copy link
          </button>
        )}
      </div>
      {openFailed && (
        <p className="path-box" data-report-link style={{ userSelect: "text" }}>
          {REPORT_ISSUE_URL}
        </p>
      )}
      <div role="status" aria-live="polite" className="settings-feedback">
        {opened ? "The form opened in your web browser." : copied ? "Link copied. Paste it into your web browser." : ""}
      </div>
      <div role="alert" className="settings-feedback settings-feedback-error">
        {copyFailed
          ? "Couldn't copy the link. You can select it above and copy it yourself."
          : openFailed && !copied
            ? "Couldn't open your web browser. You can copy the link and paste it into a browser yourself."
            : ""}
      </div>
    </div>
  );
}
