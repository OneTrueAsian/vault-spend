import { useCallback, useEffect, useRef, useState } from "react";
import { invoke } from "@tauri-apps/api/core";
import { getVersion } from "@tauri-apps/api/app";
import { openUrl } from "@tauri-apps/plugin-opener";
import { errorMessage } from "./errorMessage";
import { listen } from "@tauri-apps/api/event";
import { ModalShell } from "./Modal";
import {
  prepareSignedUpdate,
  downloadSignedUpdate,
  cancelSignedUpdate,
  installSignedUpdate,
  type SignedUpdateOffer,
} from "./signedUpdates";

const DISMISSED_VERSION_KEY = "vaultspend-dismissed-update-version";
const RELEASE_PAGE = "https://github.com/OneTrueAsian/vault-spend/releases";
type LatestRelease = { tag_name: string };

function parseVersion(v: string): number[] {
  return v
    .replace(/^v/, "")
    .split(".")
    .map((n) => parseInt(n, 10) || 0);
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

/** Native code owns publisher trust, download paths and installer handoff.
 * Dismissal remembers only the version; unsigned releases retain manual access. */
export function UpdateBanner() {
  const [latest, setLatest] = useState<{ tag: string; version: string } | null>(null);
  const [dismissed, setDismissed] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [offer, setOffer] = useState<SignedUpdateOffer | null>(null);
  const [phase, setPhase] = useState<
    "notice" | "checking" | "ready" | "downloading" | "verifying" | "staged" | "cancelling" | "installing" | "opened"
  >("notice");
  const [progress, setProgress] = useState(0);
  const [confirm, setConfirm] = useState(false);
  const live = useRef(false),
    handle = useRef<string | null>(null),
    sequence = useRef(0);
  const installing = useRef(false);
  const downloading = useRef(false);

  const checkSignedUpdate = useCallback(async () => {
    const request = ++sequence.current;
    setPhase("checking");
    setError(null);
    try {
      const next = await prepareSignedUpdate();
      if (!live.current || request !== sequence.current) {
        if (next) await cancelSignedUpdate(next.handle).catch(() => {});
        return;
      }
      handle.current = next?.handle ?? null;
      setOffer(next);
      setPhase(next ? "ready" : "notice");
      if (next) setLatest({ tag: `v${next.version}`, version: next.version });
    } catch (error) {
      if (live.current && request === sequence.current) {
        setPhase("notice");
        setError(errorMessage(error));
      }
    }
  }, []);

  async function download() {
    if (!offer || !handle.current || downloading.current) return;
    downloading.current = true;
    const request = ++sequence.current,
      id = handle.current;
    setPhase("downloading");
    setProgress(0);
    setError(null);
    try {
      const token = await downloadSignedUpdate(id);
      if (!live.current || request !== sequence.current) {
        await cancelSignedUpdate(token).catch(() => {});
        return;
      }
      handle.current = token;
      setPhase("staged");
    } catch (error) {
      if (live.current && request === sequence.current) {
        handle.current = null;
        setOffer(null);
        setPhase("notice");
        setError(errorMessage(error));
      }
    } finally {
      downloading.current = false;
    }
  }
  async function cancel() {
    const id = handle.current;
    handle.current = null;
    ++sequence.current;
    setPhase("cancelling");
    setConfirm(false);
    try {
      if (id) await cancelSignedUpdate(id);
    } catch (error) {
      if (live.current) setError(errorMessage(error));
    } finally {
      if (live.current) {
        setOffer(null);
        setPhase("notice");
      }
    }
  }
  async function install() {
    const token = handle.current;
    if (!token || installing.current) return;
    installing.current = true;
    setPhase("installing");
    setError(null);
    try {
      await installSignedUpdate(token);
      if (live.current) {
        handle.current = null;
        setConfirm(false);
        setPhase("opened");
      }
    } catch (error) {
      if (live.current) {
        handle.current = null;
        setOffer(null);
        setConfirm(false);
        setPhase("notice");
        setError(errorMessage(error));
      }
    } finally {
      installing.current = false;
    }
  }

  useEffect(() => {
    let cancelled = false;
    live.current = true;
    const unlisten = listen<unknown>("signed-update-progress", ({ payload }) => {
      if (!live.current || !payload || typeof payload !== "object") return;
      const p = payload as Record<string, unknown>;
      if (
        p.handle !== handle.current ||
        typeof p.received !== "number" ||
        typeof p.total !== "number" ||
        !Number.isSafeInteger(p.received) ||
        !Number.isSafeInteger(p.total) ||
        p.received < 0 ||
        p.total <= 0 ||
        p.received > p.total ||
        typeof p.verifying !== "boolean"
      )
        return;
      setProgress(Math.round((100 * p.received) / p.total));
      setPhase(p.verifying ? "verifying" : "downloading");
    }).catch(() => null);
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
        if (dismissedVersion !== tag && !cancelled) {
          setLatest({ tag, version: tag.replace(/^v/, "") });
          await unlisten;
          await checkSignedUpdate();
        }
      } catch {
        // Offline/rate-limited checks must not block normal app use.
      }
    })();
    return () => {
      cancelled = true;
      live.current = false;
      ++sequence.current;
      unlisten.then((stop) => stop?.());
      if (handle.current) void cancelSignedUpdate(handle.current).catch(() => {});
      handle.current = null;
    };
  }, [checkSignedUpdate]);

  function dismiss() {
    if (handle.current) void cancelSignedUpdate(handle.current).catch(() => {});
    handle.current = null;
    ++sequence.current;
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
      <span role="status" aria-live="polite">
        A new version of Vault Spend ({latest.version}) is available.
        {phase === "notice" && " Use the official release page, or check for a signed update."}
        {phase === "checking" && " Checking its signature…"}
        {phase === "ready" && " A signed installer is available."}
        {phase === "downloading" && ` Downloading… ${progress}%`}
        {phase === "verifying" && " Verifying downloaded bytes…"}
        {phase === "staged" && " Installer verified and ready."}
        {phase === "cancelling" && " Cancelling download…"}
        {phase === "installing" && " Opening verified installer…"}
        {phase === "opened" &&
          " Installer opened. Follow its instructions and close Vault Spend when requested. On macOS, finish installation from the disk image."}
        {error && (
          <span className="update-banner-error" role="alert">
            {" "}
            {error}
          </span>
        )}
      </span>
      <span className="update-banner-actions">
        {phase === "ready" && (
          <button type="button" onClick={() => void download()}>
            Download update
          </button>
        )}
        {phase === "staged" && (
          <button type="button" onClick={() => setConfirm(true)}>
            Open verified installer
          </button>
        )}
        {["downloading", "verifying", "staged"].includes(phase) && (
          <button type="button" className="modal-secondary" onClick={() => void cancel()}>
            Cancel update
          </button>
        )}
        {phase === "notice" && (
          <button type="button" className="modal-secondary" onClick={() => void checkSignedUpdate()}>
            Check signed update
          </button>
        )}
        <button type="button" className="modal-secondary" onClick={() => void viewRelease()}>
          View release
        </button>
        <button
          type="button"
          className="modal-secondary"
          disabled={["downloading", "verifying", "cancelling", "installing"].includes(phase)}
          onClick={dismiss}
        >
          Dismiss
        </button>
      </span>
      {confirm && (
        <ModalShell
          title="Open verified installer?"
          onCancel={() => {
            if (phase !== "installing") setConfirm(false);
          }}
          dismissOnOverlayClick={phase !== "installing"}
          footer={
            <>
              <button
                type="button"
                className="modal-secondary"
                disabled={phase === "installing"}
                onClick={() => setConfirm(false)}
              >
                Not now
              </button>
              <button type="button" disabled={phase === "installing"} onClick={() => void install()}>
                Open installer
              </button>
            </>
          }
        >
          <p>
            Vault Spend will recheck version {latest.version}'s downloaded installer, then open it. Save your work and
            follow the installer's instructions. Your financial data is not part of the download.
          </p>
        </ModalShell>
      )}
    </div>
  );
}
