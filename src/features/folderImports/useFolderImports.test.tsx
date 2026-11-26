// @vitest-environment jsdom
import { afterEach, describe, expect, it, vi } from "vitest";
import { act } from "react";
import { createRoot } from "react-dom/client";
import { useFolderImports, type FolderImportsState } from "./useFolderImports";
import { FOLDER_IMPORTS_CHANGED, type FolderActivity } from "./folderImportsApi";

(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

const entry = (id: number, outcome: string): FolderActivity => ({
  id,
  at: "2026-11-22T10:00:00",
  file_name: `f${id}.csv`,
  account_name: null,
  outcome,
  reason: "r",
  batch_id: null,
  can_review_again: false,
  copy_cleared: false,
});

describe("useFolderImports", () => {
  let cleanup: (() => void) | null = null;
  afterEach(() => cleanup?.());

  function mount(active: boolean, activity: () => FolderActivity[], seen = 0) {
    let api!: FolderImportsState;
    const handlers = new Map<string, () => void>();
    const stop = vi.fn();
    const listenTo = vi.fn(async (event: string, handler: () => void) => {
      handlers.set(event, handler);
      return stop;
    });
    const call = vi.fn(async (command: string) => {
      if (command === "get_folder_imports") return { enabled: true, folder: "D:\\Exports", folder_missing: false, mappings: [], pending: [], seen_activity_id: seen };
      if (command === "list_folder_import_activity") return activity();
      return undefined;
    });
    function Probe({ on }: { on: boolean }) {
      api = useFolderImports({ active: on, call: call as never, listenTo });
      return null;
    }
    const container = document.createElement("div");
    document.body.append(container);
    const root = createRoot(container);
    act(() => root.render(<Probe on={active} />));
    cleanup = () => {
      act(() => root.unmount());
      container.remove();
    };
    return { api: () => api, call, handlers, stop, rerender: (on: boolean) => act(() => root.render(<Probe on={on} />)) };
  }

  it("does nothing until the profile's data has loaded, then looks at the folder and reads the queue", async () => {
    const { call, rerender } = mount(false, () => []);
    expect(call).not.toHaveBeenCalled();
    await act(async () => rerender(true));
    expect(call).toHaveBeenCalledWith("scan_folder_imports_now");
    expect(call).toHaveBeenCalledWith("get_folder_imports");
  });

  it("reads again when discovery reports a change and looks again when the window comes back", async () => {
    const { call, handlers, api } = mount(true, () => []);
    await act(async () => undefined);
    const reads = () => call.mock.calls.filter(([c]) => c === "get_folder_imports").length;
    const before = reads();
    await act(async () => handlers.get(FOLDER_IMPORTS_CHANGED)!());
    expect(reads()).toBe(before + 1);
    const scans = call.mock.calls.filter(([c]) => c === "scan_folder_imports_now").length;
    await act(async () => void window.dispatchEvent(new Event("focus")));
    expect(call.mock.calls.filter(([c]) => c === "scan_folder_imports_now").length).toBe(scans + 1);
    expect(api().configured).toBe(true);
  });

  it("counts files skipped since Folder activity was last opened until it is opened again", async () => {
    let entries = [entry(1, "older")];
    const { api, handlers, call } = mount(true, () => entries, 1);
    await act(async () => undefined);
    expect(api().skippedSinceSeen).toBe(0);
    entries = [entry(3, "already_dismissed"), entry(2, "queued"), ...entries];
    await act(async () => handlers.get(FOLDER_IMPORTS_CHANGED)!());
    expect(api().skippedSinceSeen).toBe(1);
    await act(async () => api().markActivitySeen());
    expect(api().skippedSinceSeen).toBe(0);
    expect(call).toHaveBeenCalledWith("mark_folder_activity_seen", { through: 3 });
  });

  it("announces files skipped before the page first loaded (found at startup)", async () => {
    const { api } = mount(true, () => [entry(7, "older"), entry(6, "bad_name"), entry(5, "older")], 5);
    await act(async () => undefined);
    expect(api().skippedSinceSeen).toBe(2);
  });

  it("stops listening when the profile goes away", async () => {
    const { stop, rerender } = mount(true, () => []);
    await act(async () => undefined);
    await act(async () => rerender(false));
    expect(stop).toHaveBeenCalled();
  });
});
