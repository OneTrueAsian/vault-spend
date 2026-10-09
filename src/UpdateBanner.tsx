import { useEffect, useState } from "react";
import { invoke } from "@tauri-apps/api/core";
import { getVersion } from "@tauri-apps/api/app";
import { openUrl } from "@tauri-apps/plugin-opener";
import { errorMessage } from "./errorMessage";

const DISMISSED_VERSION_KEY = "vaultspend-dismissed-update-version";
const RELEASE_PAGE = "https://github.com/OneTrueAsian/vault-spend/releases";
type LatestRelease = { tag_name: string };

function parseVersion(v: string): number[] {
  return v.replace(/^v/, "").split(".").map((n) => parseInt(n, 10) || 0);
}

function isNewer(latest: string, current: string): boolean {
  const a = parseVersion(latest);
  const b = parseVersion(current);
  for (let i = 0; i < Math.max(a.length, b.length); i++) {
    const x = a[i] ?? 0;
    const y = b[i] ?? 0;
    if (x !== y) return x > y;
  }
  return false;
}

/** Notify through the backend, then offer the fixed official release page.
 * In-app downloading/opening stays disabled until publisher verification and
 * production signing are integrated. Dismissal remembers only the version. */
export function UpdateBanner() {
  const [latest, setLatest] = useState<{ tag: string; version: string } | null>(null);
  const [dismissed, setDismissed] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    let cancelled = false;
    (async () => {
      try {
        const [current, data] = await Promise.all([getVersion(), invoke<LatestRelease>("fetch_latest_release")]);
        const tag = data.tag_name ?? "";
        if (!tag || !isNewer(tag, current)) return;
        let dismissedVersion: string | null = null;
        try {
          dismissedVersion = localStorage.getItem(DISMISSED_VERSION_KEY);
        } catch {
          // Storage unavailable: showing a notice on the next launch is harmless.
        }
        if (dismissedVersion !== tag && !cancelled) setLatest({ tag, version: tag.replace(/^v/, "") });
      } catch {
        // Offline/rate-limited checks must not block normal app use.
      }
    })();
    return () => { cancelled = true; };
  }, []);

  function dismiss() {
    if (latest) {
      try {
        localStorage.setItem(DISMISSED_VERSION_KEY, latest.tag);
      } catch {
        // Per-viewer preference only.
      }
    }
    setDismissed(true);
  }

  async function viewRelease() {
    setError(null);
    try {
      await openUrl(RELEASE_PAGE);
    } catch (e) {
      setError(`Couldn't open the release page. ${errorMessage(e)}`);
    }
  }

  if (!latest || dismissed) return null;
  return (
    <div className="update-banner">
      <span>
        A new version of Vault Spend ({latest.version}) is available. Download the installer from the release page.
        {error && <span className="update-banner-error" role="alert"> {error}</span>}
      </span>
      <span className="update-banner-actions">
        <button type="button" className="modal-secondary" onClick={() => void viewRelease()}>View release</button>
        <button type="button" className="modal-secondary" onClick={dismiss}>Dismiss</button>
      </span>
    </div>
  );
}
