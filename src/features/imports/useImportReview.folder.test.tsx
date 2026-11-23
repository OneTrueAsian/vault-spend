// @vitest-environment jsdom
// VS-102: the shared import review reading a watched folder's saved export instead of a picked file.
import { afterEach, describe, expect, it, vi } from "vitest";
import { act } from "react";
import { createRoot } from "react-dom/client";
import { useImportReview } from "./useImportReview";

(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

const row = (index: number, extra: Record<string, unknown> = {}) => ({
  index,
  date: "2026-11-18",
  description: `Row ${index}`,
  amount: "-1.00",
  is_duplicate: false,
  source_pending: false,
  account_name: null,
  category: null,
  matched_category: "Food",
  suggestion: null,
  ...extra,
});

const preview = (token: string) => ({
  rows: [row(0), row(1, { is_duplicate: true }), row(2, { source_pending: true })],
  row_errors: 0,
  row_problems: [],
  unmatched_categories: [],
  review_token: token,
  choice_below: 0.5,
});

const batch = (rowVersion = 3) => ({ id: 41, row_version: rowVersion, file_name: "Bank Max Checking_2026-11-18.csv", source_present: false });

describe("useImportReview with a folder export", () => {
  let cleanup: (() => void) | null = null;
  afterEach(() => cleanup?.());

  function mount(call: (command: string, args?: Record<string, unknown>) => Promise<unknown>) {
    let api!: ReturnType<typeof useImportReview>;
    const status = vi.fn();
    const onFolderChanged = vi.fn();
    function Probe() {
      api = useImportReview({
        accounts: [],
        busy: false,
        setBusy: () => undefined,
        setStatus: status,
        refresh: async () => undefined,
        onImported: () => undefined,
        onFolderChanged,
        call: call as never,
      });
      return null;
    }
    const container = document.createElement("div");
    document.body.append(container);
    const root = createRoot(container);
    act(() => root.render(<Probe />));
    cleanup = () => {
      act(() => root.unmount());
      container.remove();
    };
    return { api: () => api, status, onFolderChanged };
  }

  it("opens the saved export's review by batch, with duplicates and bank-pending rows unticked", async () => {
    const call = vi.fn(async (command: string) => (command === "list_categories" ? [] : { batch: batch(), preview: preview("t1") }));
    const { api } = mount(call);
    await act(async () => {
      expect(await api().beginFolder(41, true, 7)).toBeNull();
    });
    expect(call).toHaveBeenCalledWith("preview_folder_import", { batchId: 41, invertAmounts: true, columnMap: null, columnHeaders: null });
    expect(call.mock.calls.some(([c]) => c === "preview_import")).toBe(false);
    expect(api().pendingImport?.folder).toEqual({ batchId: 41, rowVersion: 3, fileName: "Bank Max Checking_2026-11-18.csv", sourcePresent: false, nameInvert: true });
    expect([...api().includedIndices]).toEqual([0]);
  });

  it("commits by batch and reviewed version, never by path, and tells the page the queue changed", async () => {
    const call = vi.fn(async (command: string, _args?: Record<string, unknown>) => {
      if (command === "list_categories") return [];
      if (command === "commit_folder_import") return { inserted: 1, inserted_ids: [9], auto_linked: 0, row_errors: 0 };
      return { batch: batch(), preview: preview("t1") };
    });
    const { api, onFolderChanged } = mount(call);
    await act(async () => void (await api().beginFolder(41, false, 7)));
    await act(async () => api().confirmPendingImport());
    const commit = call.mock.calls.find(([c]) => c === "commit_folder_import")!;
    expect(commit[1]).toMatchObject({ batchId: 41, rowVersion: 3, invertAmounts: false, reviewToken: "t1", includedIndices: [0] });
    expect(commit[1]).not.toHaveProperty("path");
    expect(api().pendingImport).toBeNull();
    expect(onFolderChanged).toHaveBeenCalledTimes(1);
  });

  it("flipping the amount signs reads the export again as a new review", async () => {
    let token = 0;
    const call = vi.fn(async (command: string, _args?: Record<string, unknown>) => (command === "list_categories" ? [] : { batch: batch(), preview: preview(`t${++token}`) }));
    const { api } = mount(call);
    await act(async () => void (await api().beginFolder(41, false, 7)));
    await act(async () => api().flipFolderSigns());
    const previews = call.mock.calls.filter(([c]) => c === "preview_folder_import").map(([, args]) => (args as { invertAmounts: boolean }).invertAmounts);
    expect(previews).toEqual([false, true]);
    expect(api().pendingImport?.invertAmounts).toBe(true);
    expect(api().pendingImport?.preview.review_token).toBe("t2");
  });

  it("flipping the signs keeps the bank-category answers, row categories and ticks already made", async () => {
    let token = 0;
    const withCategories = (t: string) => ({
      ...preview(t),
      rows: [
        row(0, { category: "Merchandise", matched_category: null }),
        row(1, { is_duplicate: true }),
        row(2, { source_pending: true, matched_category: null }),
      ],
      unmatched_categories: [{ name: "Merchandise", count: 1, remembered_category: null }],
    });
    const call = vi.fn(async (command: string) => {
      if (command === "list_categories") return ["Shopping", "Food"];
      return { batch: batch(), preview: withCategories(`t${++token}`) };
    });
    const { api } = mount(call);
    await act(async () => void (await api().beginFolder(41, false, 7)));
    act(() => api().updateImportCategoryChoices({ Merchandise: { action: "map_to", category: "Shopping" } }));
    act(() => api().setImportRowChoices(new Map([[2, "Food"]])));
    act(() => api().toggleIncluded(2));
    await act(async () => api().flipFolderSigns());
    expect(api().pendingImport?.preview.review_token).toBe("t2");
    expect(api().importCategoryChoices).toEqual({ Merchandise: { action: "map_to", category: "Shopping" } });
    expect(api().importRowChoices.get(2)).toBe("Food");
    expect([...api().includedIndices].sort()).toEqual([0, 2]);
  });

  it("a flipped review can be remembered for the export name, and only when asked", async () => {
    const call = vi.fn(async (command: string, _args?: Record<string, unknown>) => {
      if (command === "list_categories") return [];
      if (command === "commit_folder_import") return { inserted: 1, inserted_ids: [9], auto_linked: 0, row_errors: 0 };
      return { batch: batch(), preview: preview("t1") };
    });
    const { api } = mount(call);
    await act(async () => void (await api().beginFolder(41, false, 7)));
    expect(api().pendingImport?.folder?.nameInvert).toBe(false);
    await act(async () => api().flipFolderSigns());
    expect(api().pendingImport?.folder?.nameInvert, "the saved convention is still the name's").toBe(false);
    act(() => api().setRememberSigns(true));
    await act(async () => api().confirmPendingImport());
    const commit = call.mock.calls.find(([c]) => c === "commit_folder_import")!;
    expect(commit[1]).toMatchObject({ invertAmounts: true, rememberSigns: true });

    call.mockClear();
    await act(async () => void (await api().beginFolder(41, false, 7)));
    expect(api().rememberSigns, "a new review starts unticked").toBe(false);
    await act(async () => api().confirmPendingImport());
    expect(call.mock.calls.find(([c]) => c === "commit_folder_import")![1]).toMatchObject({ rememberSigns: false });
  });

  it("Review later keeps the export waiting and says so instead of 'cancelled'", async () => {
    const call = vi.fn(async (command: string) => (command === "list_categories" ? [] : { batch: batch(), preview: preview("t1") }));
    const { api, status, onFolderChanged } = mount(call);
    await act(async () => void (await api().beginFolder(41, false, 7)));
    act(() => api().cancelPendingImport());
    expect(api().pendingImport).toBeNull();
    expect(status).toHaveBeenLastCalledWith("Saved for later. The export is still waiting for review.", "info");
    expect(onFolderChanged).toHaveBeenCalled();
    expect(call.mock.calls.some(([c]) => String(c).startsWith("commit") || c === "dismiss_folder_import")).toBe(false);
  });

  it("a refused commit re-reads the same export and keeps the review open", async () => {
    let commits = 0;
    const call = vi.fn(async (command: string) => {
      if (command === "list_categories") return [];
      if (command === "commit_folder_import") {
        commits += 1;
        throw new Error("This export changed since you opened it.");
      }
      return { batch: batch(commits > 0 ? 4 : 3), preview: preview(commits > 0 ? "t2" : "t1") };
    });
    const { api } = mount(call);
    await act(async () => void (await api().beginFolder(41, false, 7)));
    await act(async () => api().confirmPendingImport());
    expect(api().pendingImport?.folder?.rowVersion).toBe(4);
    expect(api().notice).toContain("This export changed since you opened it.");
  });
});
