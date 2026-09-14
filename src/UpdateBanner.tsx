import { useEffect, useState } from "react";
import { invoke } from "@tauri-apps/api/core";
import { getVersion } from "@tauri-apps/api/app";
import { openPath, openUrl } from "@tauri-apps/plugin-opener";

const DISMISSED_VERSION_KEY = "vaultspend-dismissed-update-version";
const REPO = "OneTrueAsian/vault-spend";

type ReleaseAsset = { name: string; browser_download_url: string };

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

/** This app only ships Windows and macOS builds, so a simple user-agent
 * sniff is enough here — not reaching for a whole extra plugin (e.g.
 * `@tauri-apps/plugin-os`) just to learn this one fact inside a WebView
 * whose UA is already reliable (unlike an arbitrary public browser). */
function detectPlatform(): "windows" | "macos" | null {
  const ua = navigator.userAgent;
  if (ua.includes("Windows")) return "windows";
  if (ua.includes("Macintosh") || ua.includes("Mac OS")) return "macos";
  return null;
}

/** Picks the one release asset "Update now" should download for this OS —
 * the NSIS installer on Windows (falling back to the .msi if that's ever
 * missing), the universal .dmg on macOS. Returns null if the release
 * doesn't have a matching asset (an unexpected release shape), in which
 * case the banner just falls back to "View release" only. */
function pickAsset(assets: ReleaseAsset[], platform: "windows" | "macos" | null): ReleaseAsset | null {
  if (platform === "windows") {
    return (
      assets.find((a) => a.name.endsWith("-setup.exe")) ?? assets.find((a) => a.name.endsWith(".msi")) ?? null
    );
  }
  if (platform === "macos") {
    return assets.find((a) => a.name.endsWith(".dmg")) ?? null;
  }
  return null;
}

/** A small, dismissible banner that checks GitHub's latest release once on
 * launch and nudges the user if the installed app is behind. "Update now"
 * downloads the right installer for this OS and hands it to `openPath`,
 * which launches the OS's normal installer UI — this app has no silent
 * auto-updater (that needs a signing keypair and CI changes this project
 * deliberately hasn't taken on); it just saves the trip to GitHub to find
 * and download the file by hand. Failures — offline, GitHub unreachable,
 * rate-limited, download failed — are handled gracefully: checking/
 * updating is a nice-to-have and should never strand the user, so a failed
 * "Update now" falls back to just opening the release page. Dismissing
 * remembers that specific version (per viewer, in localStorage) so it
 * won't nag again until a *newer* one ships.
 *
 * `openPath` requires `opener:allow-open-path` in
 * `src-tauri/capabilities/default.json` — `opener:default` alone (the
 * plugin's own bundled default permission set) only covers `open_url` and
 * `reveal_item_in_dir`, not `open_path`. And the permission string alone
 * isn't enough either: the plugin's own docs describe it as enabling the
 * command "without any pre-configured scope," meaning zero paths are
 * actually allowed until one is granted separately — it must be the
 * *object* form, with an `allow: [{ path: ... }]` scope matching wherever
 * `download_asset` (`updater.rs`) actually saves the file
 * (`std::env::temp_dir()`, i.e. `$TEMP`), not the bare permission string.
 * Getting either of these wrong doesn't crash anything (the catch block
 * below falls back gracefully) — it just silently/visibly never actually
 * launches the installer. Both have already shipped unnoticed once each:
 * the missing permission, then the missing scope on the fix for that. */
export function UpdateBanner() {
  const [latest, setLatest] = useState<{ tag: string; version: string; url: string; asset: ReleaseAsset | null } | null>(
    null,
  );
  const [dismissed, setDismissed] = useState(false);
  const [downloading, setDownloading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    (async () => {
      try {
        const [current, res] = await Promise.all([
          getVersion(),
          fetch(`https://api.github.com/repos/${REPO}/releases/latest`),
        ]);
        if (!res.ok) return;
        const data = await res.json();
        const tag: string = data.tag_name ?? "";
        if (!tag || !isNewer(tag, current)) return;

        let dismissedVersion: string | null = null;
        try {
          dismissedVersion = localStorage.getItem(DISMISSED_VERSION_KEY);
        } catch {
          // storage unavailable — just show the banner every launch, harmless
        }
        if (dismissedVersion === tag) return;

        const asset = pickAsset(data.assets ?? [], detectPlatform());
        setLatest({ tag, version: tag.replace(/^v/, ""), url: data.html_url ?? `https://github.com/${REPO}/releases`, asset });
      } catch {
        // offline, rate-limited, or GitHub unreachable — silently skip
      }
    })();
  }, []);

  function dismiss() {
    if (latest) {
      try {
        localStorage.setItem(DISMISSED_VERSION_KEY, latest.tag);
      } catch {
        // per-viewer preference only — fine to skip if storage is unavailable
      }
    }
    setDismissed(true);
  }

  async function handleUpdateNow() {
    if (!latest?.asset) return;
    setError(null);
    setDownloading(true);
    try {
      const localPath = await invoke<string>("download_update_asset", {
        url: latest.asset.browser_download_url,
        filename: latest.asset.name,
      });
      await openPath(localPath);
    } catch (e) {
      // A failed download shouldn't leave the user stuck — fall back to
      // the same manual path this banner always offered.
      setError(`Couldn't download the update automatically (${String(e)}) — opening the release page instead.`);
      await openUrl(latest.url);
    } finally {
      setDownloading(false);
    }
  }

  if (!latest || dismissed) return null;

  return (
    <div className="update-banner">
      <span>
        A new version of Vault Spend ({latest.version}) is available.
        {error && <span className="update-banner-error"> {error}</span>}
      </span>
      <span className="update-banner-actions">
        {latest.asset && (
          <button type="button" onClick={handleUpdateNow} disabled={downloading}>
            {downloading ? "Downloading…" : "Update now"}
          </button>
        )}
        <button type="button" className="modal-secondary" onClick={() => openUrl(latest.url)}>
          View release
        </button>
        <button type="button" className="modal-secondary" onClick={dismiss}>
          Dismiss
        </button>
      </span>
    </div>
  );
}
