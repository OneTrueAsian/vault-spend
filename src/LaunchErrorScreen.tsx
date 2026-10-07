import "./LaunchErrorScreen.css";
import { useEffect, useRef, useState } from "react";
import { open } from "@tauri-apps/plugin-dialog";
import {
  locateDataFile,
  openProfileAtLaunch,
  quitApp,
  restoreRegistryBackup,
  retryStartup,
  startWithNewDataFile,
  startWithNewProfileList,
  type LaunchError,
  type LaunchErrorKind,
  type StartupState,
} from "./startup";
import { errorMessage } from "./errorMessage";

const TITLES: Record<LaunchErrorKind, string> = {
  registry_unreadable: "Vault Spend can't read your profile list",
  location_unreadable: "Vault Spend can't tell where your data is kept",
  data_file_missing: "Your data file wasn't found",
  data_file_unreadable: "Vault Spend can't open your data file",
  startup_failed: "Vault Spend couldn't start",
};

const CAN_LOCATE: LaunchErrorKind[] = ["location_unreadable", "data_file_missing", "data_file_unreadable"];
const CAN_START_NEW_FILE: LaunchErrorKind[] = ["location_unreadable", "data_file_missing", "data_file_unreadable"];

// Shown instead of the app when no profile could be opened. Every recovery here works without a
// password, and none of them deletes anything: they choose which data file to open, or set the old
// one aside after asking.
export function LaunchErrorScreen({ error, onResolved }: { error: LaunchError; onResolved: (next: StartupState) => void }) {
  const headingRef = useRef<HTMLHeadingElement>(null);
  const confirmRef = useRef<HTMLDivElement>(null);
  const [busy, setBusy] = useState(false);
  const [problem, setProblem] = useState("");
  const [confirming, setConfirming] = useState<"file" | "list" | null>(null);

  useEffect(() => {
    headingRef.current?.focus();
  }, [error.kind]);

  useEffect(() => {
    if (confirming) confirmRef.current?.focus();
  }, [confirming]);

  async function run(action: () => Promise<StartupState>, stillBrokenNote?: string) {
    setBusy(true);
    setProblem("");
    try {
      const next = await action();
      if (next.status === "error" && stillBrokenNote) setProblem(stillBrokenNote);
      onResolved(next);
    } catch (e) {
      setProblem(errorMessage(e));
    } finally {
      setBusy(false);
    }
  }

  async function locate() {
    let picked: string | null;
    try {
      picked = await open({
        multiple: false,
        directory: false,
        title: "Find your Vault Spend data file",
        filters: [{ name: "Vault Spend data file", extensions: ["db"] }],
      });
    } catch (e) {
      setProblem(errorMessage(e));
      return;
    }
    if (typeof picked !== "string") return;
    await run(() => locateDataFile(picked));
  }

  async function confirmed() {
    const which = confirming;
    setConfirming(null);
    if (which === "file") await run(startWithNewDataFile);
    else if (which === "list") await run(startWithNewProfileList);
  }

  return (
    <main className="launch-error" data-launch-error data-launch-error-kind={error.kind}>
      <div className="launch-error-card">
        <h1 ref={headingRef} tabIndex={-1}>
          {TITLES[error.kind]}
        </h1>
        <p data-launch-error-message>{error.message}</p>
        <details>
          <summary>Technical details</summary>
          <pre>{error.details}</pre>
        </details>
        <p className="launch-error-problem" role="alert" data-launch-error-problem>
          {problem}
        </p>
        <div className="launch-error-actions">
          {error.can_restore_registry && (
            <button type="button" disabled={busy} data-launch-action="restore-registry" onClick={() => run(restoreRegistryBackup)}>
              Use the previous profile list
            </button>
          )}
          {CAN_LOCATE.includes(error.kind) && (
            <button type="button" disabled={busy} data-launch-action="locate" onClick={locate}>
              Find the data file…
            </button>
          )}
          <button type="button" disabled={busy} data-launch-action="retry" onClick={() => run(retryStartup, "It still can't be opened. The message above says why.")}>
            Try again
          </button>
          <button type="button" disabled={busy} data-launch-action="quit" onClick={() => void quitApp()}>
            Quit
          </button>
          {CAN_START_NEW_FILE.includes(error.kind) && (
            <button type="button" disabled={busy || confirming !== null} data-launch-action="start-new-file" onClick={() => setConfirming("file")}>
              Start with a new data file…
            </button>
          )}
          {error.kind === "registry_unreadable" && (
            <button type="button" disabled={busy || confirming !== null} data-launch-action="start-new-list" onClick={() => setConfirming("list")}>
              Start with a new profile list…
            </button>
          )}
        </div>
        {confirming && (
          <div className="launch-error-confirm" role="group" aria-labelledby="launch-error-confirm-title" tabIndex={-1} ref={confirmRef} data-launch-confirm>
            <h2 id="launch-error-confirm-title">{confirming === "file" ? "Start with a new, empty data file?" : "Start with a new profile list?"}</h2>
            <p>
              {confirming === "file"
                ? "Vault Spend will start with an empty data file. Your old file isn't touched or deleted; if it turns up later, add it back from Settings with Use existing data file."
                : "The damaged list is kept as profiles.json.damaged and Vault Spend opens the profile it was last using on its own. Your profiles' data files aren't touched; add the others back from Settings with Use existing data file."}
            </p>
            <div className="launch-error-actions">
              <button type="button" disabled={busy} data-launch-confirm-yes onClick={confirmed}>
                {confirming === "file" ? "Yes, start with a new file" : "Yes, start with a new list"}
              </button>
              <button type="button" data-launch-confirm-cancel onClick={() => setConfirming(null)}>
                Cancel
              </button>
            </div>
          </div>
        )}
        {error.other_profiles.length > 0 && (
          <section aria-labelledby="launch-error-other">
            <h2 id="launch-error-other">Open a different profile instead</h2>
            <ul className="launch-error-profiles">
              {error.other_profiles.map((profile) => (
                <li key={profile.id}>
                  <button type="button" disabled={busy} data-launch-profile={profile.id} onClick={() => run(() => openProfileAtLaunch(profile.id))}>
                    {profile.name}
                  </button>
                </li>
              ))}
            </ul>
          </section>
        )}
      </div>
    </main>
  );
}
