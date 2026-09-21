// @vitest-environment jsdom
//
// When Vault Spend cannot open a profile it shows this screen instead of the app. It must say what
// went wrong in plain words, offer only recoveries that make sense for that problem, and never leave
// the person at a dead end.
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import type { LaunchError } from "./startup";

(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

const startup = vi.hoisted(() => ({
  retryStartup: vi.fn(),
  restoreRegistryBackup: vi.fn(),
  openProfileAtLaunch: vi.fn(),
  locateDataFile: vi.fn(),
  quitApp: vi.fn(),
  startWithNewDataFile: vi.fn(),
  startWithNewProfileList: vi.fn(),
}));
const dialog = vi.hoisted(() => ({ open: vi.fn() }));
vi.mock("./startup", () => startup);
vi.mock("@tauri-apps/plugin-dialog", () => dialog);

import { LaunchErrorScreen } from "./LaunchErrorScreen";

function launchError(overrides: Partial<LaunchError> = {}): LaunchError {
  return {
    kind: "data_file_missing",
    message: "Vault Spend looked for your data file at E:\\gone.db and it isn't there.",
    details: "E:\\gone.db",
    db_path: "E:\\gone.db",
    can_restore_registry: false,
    other_profiles: [],
    ...overrides,
  };
}

describe("LaunchErrorScreen", () => {
  let container: HTMLDivElement;
  let root: Root;
  const onResolved = vi.fn();

  beforeEach(() => {
    Object.values(startup).forEach((fn) => fn.mockReset());
    dialog.open.mockReset();
    onResolved.mockReset();
    container = document.createElement("div");
    document.body.append(container);
    root = createRoot(container);
  });

  afterEach(() => {
    act(() => root.unmount());
    container.remove();
  });

  function show(error: LaunchError) {
    act(() => {
      root.render(<LaunchErrorScreen error={error} onResolved={onResolved} />);
    });
  }
  const action = (name: string) => container.querySelector<HTMLButtonElement>(`[data-launch-action='${name}']`);
  const problem = () => container.querySelector("[data-launch-error-problem]")?.textContent ?? "";
  async function click(element: Element | null) {
    expect(element).not.toBeNull();
    await act(async () => {
      (element as HTMLElement).click();
    });
  }

  it("names what went wrong, says the file was not changed, and puts focus on the heading", () => {
    show(launchError());

    const screen = container.querySelector("[data-launch-error]");
    expect(screen?.getAttribute("data-launch-error-kind")).toBe("data_file_missing");
    const heading = container.querySelector("h1");
    expect(heading?.textContent).toMatch(/data file/i);
    expect(document.activeElement).toBe(heading);
    expect(container.querySelector("[data-launch-error-message]")?.textContent).toContain("E:\\gone.db");
  });

  it("always offers Try again and Quit", () => {
    for (const kind of ["registry_unreadable", "location_unreadable", "data_file_missing", "data_file_unreadable", "startup_failed"] as const) {
      show(launchError({ kind }));
      expect(action("retry"), kind).not.toBeNull();
      expect(action("quit"), kind).not.toBeNull();
    }
  });

  it("offers Find the data file for file problems only", () => {
    for (const kind of ["location_unreadable", "data_file_missing", "data_file_unreadable"] as const) {
      show(launchError({ kind }));
      expect(action("locate"), kind).not.toBeNull();
    }
    for (const kind of ["registry_unreadable", "startup_failed"] as const) {
      show(launchError({ kind }));
      expect(action("locate"), kind).toBeNull();
    }
  });

  it("offers the previous profile list only when it can come back", () => {
    show(launchError({ kind: "registry_unreadable", can_restore_registry: true }));
    expect(action("restore-registry")).not.toBeNull();

    show(launchError({ kind: "registry_unreadable", can_restore_registry: false }));
    expect(action("restore-registry")).toBeNull();
  });

  it("keeps the technical reason behind a details disclosure", () => {
    show(launchError({ details: "file is not a database" }));

    const details = container.querySelector("details");
    expect(details?.querySelector("summary")?.textContent).toMatch(/details/i);
    expect(details?.textContent).toContain("file is not a database");
  });

  it("lists other profiles as buttons and opens the one chosen", async () => {
    startup.openProfileAtLaunch.mockResolvedValue({ status: "open" });
    show(launchError({ other_profiles: [{ id: "second", name: "Second" }] }));

    const button = container.querySelector("[data-launch-profile='second']");
    expect(button?.textContent).toBe("Second");
    await click(button);

    expect(startup.openProfileAtLaunch).toHaveBeenCalledWith("second");
    expect(onResolved).toHaveBeenCalledWith({ status: "open" });
  });

  it("hands the new state up when Try again works, and says so when it does not", async () => {
    const stillBroken = { status: "error", error: launchError() };
    startup.retryStartup.mockResolvedValueOnce(stillBroken).mockResolvedValueOnce({ status: "open" });
    show(launchError());

    await click(action("retry"));
    expect(onResolved).toHaveBeenLastCalledWith(stillBroken);
    expect(problem()).toMatch(/still/i);

    await click(action("retry"));
    expect(onResolved).toHaveBeenLastCalledWith({ status: "open" });
    expect(problem()).toBe("");
  });

  it("shows the reason a recovery failed and keeps the screen", async () => {
    startup.openProfileAtLaunch.mockRejectedValue("Alpha's data file wasn't found at E:\\a.db");
    show(launchError({ other_profiles: [{ id: "alpha", name: "Alpha" }] }));

    await click(container.querySelector("[data-launch-profile='alpha']"));

    expect(problem()).toContain("wasn't found");
    expect(onResolved).not.toHaveBeenCalled();
    expect(container.querySelector("[data-launch-error]")).not.toBeNull();
  });

  it("opens the file picker for Find the data file and passes the choice on", async () => {
    dialog.open.mockResolvedValue("E:\\found\\vaultspend.db");
    startup.locateDataFile.mockResolvedValue({ status: "open" });
    show(launchError());

    await click(action("locate"));

    expect(startup.locateDataFile).toHaveBeenCalledWith("E:\\found\\vaultspend.db");
    expect(onResolved).toHaveBeenCalledWith({ status: "open" });
  });

  it("does nothing when the file picker is cancelled", async () => {
    dialog.open.mockResolvedValue(null);
    show(launchError());

    await click(action("locate"));

    expect(startup.locateDataFile).not.toHaveBeenCalled();
    expect(onResolved).not.toHaveBeenCalled();
  });

  it("uses the previous profile list and quits when asked", async () => {
    startup.restoreRegistryBackup.mockResolvedValue({ status: "open" });
    show(launchError({ kind: "registry_unreadable", can_restore_registry: true }));

    await click(action("restore-registry"));
    expect(onResolved).toHaveBeenCalledWith({ status: "open" });

    await click(action("quit"));
    expect(startup.quitApp).toHaveBeenCalledTimes(1);
  });

  // ---- the escape actions ----

  it("offers a new data file for file problems and a new profile list for a damaged one, never both", () => {
    for (const kind of ["location_unreadable", "data_file_missing", "data_file_unreadable"] as const) {
      show(launchError({ kind }));
      expect(action("start-new-file"), kind).not.toBeNull();
      expect(action("start-new-list"), kind).toBeNull();
    }
    show(launchError({ kind: "registry_unreadable" }));
    expect(action("start-new-list")).not.toBeNull();
    expect(action("start-new-file")).toBeNull();
    show(launchError({ kind: "startup_failed" }));
    expect(action("start-new-file")).toBeNull();
    expect(action("start-new-list")).toBeNull();
  });

  it("asks first, says nothing is deleted, and only then starts with a new data file", async () => {
    startup.startWithNewDataFile.mockResolvedValue({ status: "open" });
    show(launchError());

    await click(action("start-new-file"));

    const confirm = container.querySelector("[data-launch-confirm]");
    expect(confirm).not.toBeNull();
    expect(confirm?.textContent).toMatch(/isn't touched or deleted/i);
    expect(startup.startWithNewDataFile).not.toHaveBeenCalled();

    await click(container.querySelector("[data-launch-confirm-yes]"));

    expect(startup.startWithNewDataFile).toHaveBeenCalledTimes(1);
    expect(onResolved).toHaveBeenCalledWith({ status: "open" });
    expect(container.querySelector("[data-launch-confirm]")).toBeNull();
  });

  it("changes nothing when the confirmation is cancelled", async () => {
    show(launchError());
    await click(action("start-new-file"));

    await click(container.querySelector("[data-launch-confirm-cancel]"));

    expect(container.querySelector("[data-launch-confirm]")).toBeNull();
    expect(startup.startWithNewDataFile).not.toHaveBeenCalled();
    expect(onResolved).not.toHaveBeenCalled();
  });

  it("asks first before starting with a new profile list, too", async () => {
    startup.startWithNewProfileList.mockResolvedValue({ status: "open" });
    show(launchError({ kind: "registry_unreadable" }));

    await click(action("start-new-list"));
    expect(container.querySelector("[data-launch-confirm]")?.textContent).toMatch(/profiles\.json\.damaged/);
    expect(startup.startWithNewProfileList).not.toHaveBeenCalled();

    await click(container.querySelector("[data-launch-confirm-yes]"));
    expect(startup.startWithNewProfileList).toHaveBeenCalledTimes(1);
    expect(onResolved).toHaveBeenCalledWith({ status: "open" });
  });

  it("shows why starting fresh failed and keeps the screen", async () => {
    startup.startWithNewDataFile.mockRejectedValue("Couldn't create a new data file");
    show(launchError());
    await click(action("start-new-file"));

    await click(container.querySelector("[data-launch-confirm-yes]"));

    expect(problem()).toContain("Couldn't create");
    expect(onResolved).not.toHaveBeenCalled();
  });
});
