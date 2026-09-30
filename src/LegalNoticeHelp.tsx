import { useEffect, useState } from "react";
import { bundledLegalNotice } from "./legalNotice";
import { getLegalNoticeAcknowledgement, type LegalNoticeAcknowledgement } from "./legalNoticeApi";
import { LegalNoticeText } from "./LegalNoticeText";

function describe(ack: LegalNoticeAcknowledgement): string | null {
  if (ack.version === null) return null;
  if (ack.version !== bundledLegalNotice.version) return `Last acknowledged here: version ${ack.version}. You'll be shown this version the next time Vault Spend starts.`;
  const when = ack.acknowledged_at ? new Date(ack.acknowledged_at) : null;
  return when && !Number.isNaN(when.getTime()) ? `Acknowledged on ${when.toLocaleDateString(undefined, { dateStyle: "long" })}.` : "Acknowledged on this computer.";
}

// Help's entry for the legal notice: the version, when this computer acknowledged it, and the full text.
export function LegalNoticeHelp() {
  const [status, setStatus] = useState<string | null>(null);

  useEffect(() => {
    let cancelled = false;
    getLegalNoticeAcknowledgement()
      .then((ack) => {
        if (!cancelled) setStatus(describe(ack));
      })
      .catch(() => {
        /* the notice itself still reads fine without the acknowledgement date */
      });
    return () => {
      cancelled = true;
    };
  }, []);

  return (
    <>
      <p>
        Version {bundledLegalNotice.version}.
        {status && (
          <>
            {" "}
            <span data-legal-notice-status>{status}</span>
          </>
        )}
      </p>
      <details className="third-party-notices">
        <summary>Read the legal notice</summary>
        <div className="legal-notice-scroll legal-notice-help">
          <h4>In short</h4>
          <LegalNoticeText blocks={bundledLegalNotice.summary} />
          <LegalNoticeText blocks={bundledLegalNotice.full} />
        </div>
      </details>
    </>
  );
}
