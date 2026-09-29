// @vitest-environment jsdom
//
// The gate asks the backend where startup stands before the app mounts: nothing until it answers, the
// app when a profile is open, the launch error screen when none is.
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { act } from "react";
import { createRoot, type Root } from "react-dom/client";

(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

const startup = vi.hoisted(() => ({
  getStartupState: vi.fn(),
  retryStartup: vi.fn(),
  restoreRegistryBackup: vi.fn(),
  openProfileAtLaunch: vi.fn(),
  locateDataFile: vi.fn(),
  quitApp: vi.fn(),
  startWithNewDataFile: vi.fn(),
  startWithNewProfileList: vi.fn(),
  startupFailure: (reason: unknown) => ({
    kind: "startup_failed",
    message: "The backend could not be asked.",
    details: String(reason),
    db_path: null,
    can_restore_registry: false,
    other_profiles: [],
  }),
}));
vi.mock("./startup", () => startup);
vi.mock("@tauri-apps/plugin-dialog", () => ({ open: vi.fn() }));
vi.mock("./AutoLockSession", () => ({ AutoLockSession: () => <div data-auto-lock-session /> }));
const listenMock = vi.hoisted(() => vi.fn());
vi.mock("@tauri-apps/api/event", () => ({ listen: listenMock }));

import { StartupGate } from "./StartupGate";

const brokenState = {
  status: "error",
  error: { kind: "data_file_unreadable", message: "It can't be opened.", details: "x", db_path: "E:\\a.db", can_restore_registry: false, other_profiles: [] },
};

describe("StartupGate", () => {
  let container: HTMLDivElement;
  let root: Root;

  beforeEach(() => {
    [
      startup.getStartupState,
      startup.retryStartup,
      startup.restoreRegistryBackup,
      startup.openProfileAtLaunch,
      startup.locateDataFile,
      startup.quitApp,
      startup.startWithNewDataFile,
      startup.startWithNewProfileList,
    ].forEach((fn) => fn.mockReset());
    listenMock.mockReset();
    listenMock.mockResolvedValue(() => {});
    container = document.createElement("div");
    document.body.append(container);
    root = createRoot(container);
  });

  afterEach(() => {
    act(() => root.unmount());
    container.remove();
    localStorage.clear();
    document.documentElement.removeAttribute("data-theme");
  });

  async function mount() {
    await act(async () => {
      root.render(
        <StartupGate>
          <div data-app>the app</div>
        </StartupGate>,
      );
    });
  }

  it("renders nothing until the backend has answered", async () => {
    startup.getStartupState.mockReturnValue(new Promise(() => {}));

    await mount();

    expect(container.innerHTML).toBe("");
  });

  it("shows the app when a profile is open", async () => {
    startup.getStartupState.mockResolvedValue({ status: "open" });

    await mount();

    expect(container.querySelector("[data-app]")).not.toBeNull();
    expect(container.querySelector("[data-auto-lock-session]")).not.toBeNull();
    expect(container.querySelector("[data-launch-error]")).toBeNull();
  });

  it("shows the launch error screen, and not the app, when none could be opened", async () => {
    startup.getStartupState.mockResolvedValue(brokenState);

    await mount();

    expect(container.querySelector("[data-launch-error]")).not.toBeNull();
    expect(container.querySelector("[data-app]")).toBeNull();
  });

  it("shows a launch error of its own when the backend cannot even be asked", async () => {
    startup.getStartupState.mockRejectedValue("the bridge is down");

    await mount();

    expect(container.querySelector("[data-launch-error-kind='startup_failed']")).not.toBeNull();
  });

  it("swaps to the app once Try again succeeds", async () => {
    // Broken at launch; open by the time the retry has succeeded.
    startup.getStartupState.mockResolvedValueOnce(brokenState).mockResolvedValue({ status: "open" });
    startup.retryStartup.mockResolvedValue({ status: "open" });
    await mount();

    await act(async () => {
      container.querySelector<HTMLButtonElement>("[data-launch-action='retry']")!.click();
    });

    expect(container.querySelector("[data-app]")).not.toBeNull();
    expect(container.querySelector("[data-launch-error]")).toBeNull();
  });

  // An unlock, a retry or a select comes back as a command's return value, which can reach the page after
  // an automatic lock (focus loss, tray, Windows lock) has already locked the profile again and broadcast
  // that. Applying the older "open" over the newer "locked" left the app on screen over a locked profile.
  it("does not leave the app showing when the backend has locked again by the time an open result arrives", async () => {
    startup.getStartupState
      .mockResolvedValueOnce(brokenState)
      .mockResolvedValue({ status: "locked", profile_id: "a", profile_name: "Alex" });
    startup.retryStartup.mockResolvedValue({ status: "open" });
    await mount();

    await act(async () => {
      container.querySelector<HTMLButtonElement>("[data-launch-action='retry']")!.click();
    });

    expect(container.querySelector("[data-profile-lock-screen] h1")?.textContent).toContain("Alex is locked");
    expect(container.querySelector("[data-app]")).toBeNull();
  });

  it("lets a broadcast that arrives after an open result win over the re-check of that result", async () => {
    let emit: ((state: unknown) => void) | undefined;
    listenMock.mockImplementation((_event: string, handler: (e: { payload: unknown }) => void) =>
      Promise.resolve().then(() => {
        emit = (payload) => handler({ payload });
        return () => {};
      }),
    );
    let answerRecheck: ((state: unknown) => void) | undefined;
    startup.getStartupState.mockResolvedValueOnce(brokenState).mockImplementationOnce(
      () => new Promise((resolve) => (answerRecheck = resolve)),
    );
    startup.retryStartup.mockResolvedValue({ status: "open" });
    await mount();

    await act(async () => {
      container.querySelector<HTMLButtonElement>("[data-launch-action='retry']")!.click();
    });
    // While the re-check is still in flight, a newer broadcast says the profile is locked...
    await act(async () => emit!({ status: "locked", profile_id: "a", profile_name: "Alex" }));
    // ...and the re-check then answers with what was true before it.
    await act(async () => answerRecheck!({ status: "open" }));

    expect(container.querySelector("[data-profile-lock-screen] h1")?.textContent).toContain("Alex is locked");
  });

  it("puts the saved appearance on the page before anything else is shown", async () => {
    localStorage.setItem("meadow-theme", "dark");
    startup.getStartupState.mockReturnValue(new Promise(() => {}));

    await mount();

    expect(document.documentElement.getAttribute("data-theme")).toBe("dark");
  });

  it("subscribes to profile-lock-state-changed before its first fetch, and a state broadcast during the fetch wins", async () => {
    // The subscription only becomes "live" once listen()'s own returned promise settles — modelled
    // here as a real microtask delay, the same way the actual Tauri IPC round trip that registers
    // the listener would be — not by assigning emitLockedEvent synchronously inside listen() itself.
    // A mock that assigned it synchronously couldn't tell a correct "subscribe, wait, then fetch"
    // implementation apart from a wrong "subscribe and fetch at the same time" one, since the
    // assignment would already exist by the time either fired the fetch.
    let emitLockedEvent: (() => void) | undefined;
    listenMock.mockImplementation((_event: string, handler: (e: { payload: unknown }) => void) =>
      Promise.resolve().then(() => {
        emitLockedEvent = () => handler({ payload: { status: "locked", profile_id: "a", profile_name: "Alex" } });
        return () => {};
      }),
    );
    startup.getStartupState.mockImplementation(
      () =>
        new Promise((resolve) => {
          emitLockedEvent?.(); // the event "arrives" while the fetch is still in flight
          setTimeout(() => resolve({ status: "open" }), 0); // the fetch's own (now-stale) answer resolves after
        }),
    );

    await mount();

    expect(container.querySelector("[data-profile-lock-screen] h1")?.textContent).toContain("Alex is locked");
    expect(container.querySelector("[data-auto-lock-session]")).toBeNull();
  });

  it("renders EmptyRegistryScreen for an empty_registry state", async () => {
    startup.getStartupState.mockResolvedValue({ status: "empty_registry" });

    await mount();

    expect(container.querySelector("[data-empty-registry] h1")?.textContent).toMatch(/no profiles/i);
  });
});
