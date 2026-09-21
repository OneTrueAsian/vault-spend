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
    startup.getStartupState.mockResolvedValue(brokenState);
    startup.retryStartup.mockResolvedValue({ status: "open" });
    await mount();

    await act(async () => {
      container.querySelector<HTMLButtonElement>("[data-launch-action='retry']")!.click();
    });

    expect(container.querySelector("[data-app]")).not.toBeNull();
    expect(container.querySelector("[data-launch-error]")).toBeNull();
  });

  it("puts the saved appearance on the page before anything else is shown", async () => {
    localStorage.setItem("meadow-theme", "dark");
    startup.getStartupState.mockReturnValue(new Promise(() => {}));

    await mount();

    expect(document.documentElement.getAttribute("data-theme")).toBe("dark");
  });
});
