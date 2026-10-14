// @vitest-environment jsdom
import { afterEach, describe, expect, it, vi } from "vitest";
import { act } from "react";
import { createRoot } from "react-dom/client";
import { useImportReview } from "./useImportReview";
import type { ColumnInspection, ColumnMap } from "./columnMapping";

(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

const MAP: ColumnMap = { date: 0, description: 1, amount: { kind: "single", column: 2 } };
const MAP2: ColumnMap = { date: 0, description: 2, amount: { kind: "single", column: 1 } };
const INSPECTION: ColumnInspection = {
  status: "needs_mapping",
  headers: ["Posted", "Memo", "Amt"],
  sample_rows: [["2026-01-02", "Coffee", "-4.50"]],
  missing: ["date", "description", "amount"],
  guess: { date: null, description: null, amount: null, debit: null, credit: null },
  map: null,
};
const PREVIEW = { rows: [{ index: 0, is_duplicate: false, matched_category: "Food", category: null, suggestion: null }], unmatched_categories: [], review_token: "t", choice_below: 0.5 };

describe("useImportReview column map", () => {
  let cleanup: (() => void) | null = null;
  afterEach(() => cleanup?.());

  function mount(call: (command: string, args?: Record<string, unknown>) => Promise<unknown>) {
    let api!: ReturnType<typeof useImportReview>;
    function Probe() {
      api = useImportReview({
        accounts: [],
        busy: false,
        setBusy: () => undefined,
        setStatus: () => undefined,
        refresh: async () => undefined,
        onImported: () => undefined,
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
    return () => api;
  }

  it("sends the column map with the first preview, the retry preview and the commit", async () => {
    let commits = 0;
    const call = vi.fn(async (command: string, _args?: Record<string, unknown>) => {
      if (command === "commit_import") {
        commits += 1;
        if (commits === 1) throw new Error("File changed.");
        return { inserted: 1, inserted_ids: [], auto_linked: 0, row_errors: 0 };
      }
      if (command === "list_categories") return [];
      return PREVIEW;
    });
    const api = mount(call);
    await act(async () => api().begin("C:/bank.csv", false, 7, MAP, { inspection: INSPECTION, source: "chosen" }));
    expect(call).toHaveBeenCalledWith("preview_import", {
      path: "C:/bank.csv",
      invertAmounts: false,
      accountId: 7,
      columnMap: MAP,
      columnHeaders: ["Posted", "Memo", "Amt"],
    });

    await act(async () => api().confirmPendingImport());
    const commit = call.mock.calls.find(([c]) => c === "commit_import")![1] as Record<string, unknown>;
    expect(commit.columnMap).toEqual(MAP);
    expect(commit.columnHeaders).toEqual(["Posted", "Memo", "Amt"]);
    const previews = call.mock.calls.filter(([c]) => c === "preview_import");
    expect(previews).toHaveLength(2); // the retry after the failed commit
    expect(previews[1][1]).toMatchObject({ columnMap: MAP });
  });

  it("changing the columns reads the file again with the new map and keeps the account and the sign choice", async () => {
    const call = vi.fn(async (_command: string, _args?: Record<string, unknown>) => PREVIEW);
    const api = mount(call);
    await act(async () => api().begin("C:/bank.csv", true, 7, MAP, { inspection: INSPECTION, source: "saved" }));
    expect(api().pendingImport?.columns?.source).toBe("saved");
    // The picker starts from the columns in use.
    expect(api().columnsToChange()?.guess).toMatchObject({ date: 0, description: 1, amount: 2 });
    await act(async () => api().changeColumns(MAP2));
    expect(call).toHaveBeenLastCalledWith("preview_import", {
      path: "C:/bank.csv",
      invertAmounts: true,
      accountId: 7,
      columnMap: MAP2,
      columnHeaders: ["Posted", "Memo", "Amt"],
    });
    expect(api().pendingImport).toMatchObject({ columnMap: MAP2, defaultAccountId: 7, invertAmounts: true });
    expect(api().pendingImport?.columns?.source).toBe("chosen");
    expect(api().columnsToChange()?.guess).toMatchObject({ description: 2, amount: 1 });
  });

  it("keeps the review as it was, and says why, when the new columns can't be read", async () => {
    let fail = false;
    const call = vi.fn(async (_command: string, _args?: Record<string, unknown>) => {
      if (fail) throw new Error("Pick a different column for each question.");
      return PREVIEW;
    });
    const api = mount(call);
    await act(async () => api().begin("C:/bank.csv", false, 7, MAP, { inspection: INSPECTION, source: "saved" }));
    fail = true;
    await act(async () => api().changeColumns(MAP2));
    expect(api().pendingImport?.columnMap).toEqual(MAP);
    expect(api().pendingImport?.columns?.source).toBe("saved");
    expect(api().notice).toBe("Pick a different column for each question.");
  });

  it("offers nothing to change when the import had no column choice", async () => {
    const api = mount(vi.fn(async () => PREVIEW));
    await act(async () => api().begin("C:/bank.csv", false, 7, null));
    expect(api().columnsToChange()).toBeNull();
  });

  it("sends null when no mapping was needed", async () => {
    const call = vi.fn(async (_command: string, _args?: Record<string, unknown>) => PREVIEW);
    const api = mount(call);
    await act(async () => api().begin("C:/bank.csv", false, 7, null));
    expect(call).toHaveBeenCalledWith("preview_import", expect.objectContaining({ columnMap: null, columnHeaders: null }));
  });
});
