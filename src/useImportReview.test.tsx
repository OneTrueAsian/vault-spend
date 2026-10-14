// @vitest-environment jsdom
import { afterEach, describe, expect, it, vi } from "vitest";
import { act } from "react";
import { createRoot } from "react-dom/client";
import { useImportReview } from "./useImportReview";
import type { ColumnMap } from "./columnMapping";

(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

const MAP: ColumnMap = { date: 0, description: 1, amount: { kind: "single", column: 2 } };
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
    await act(async () => api().begin("C:/bank.csv", false, 7, MAP));
    expect(call).toHaveBeenCalledWith("preview_import", { path: "C:/bank.csv", invertAmounts: false, accountId: 7, columnMap: MAP });

    await act(async () => api().confirmPendingImport());
    const commit = call.mock.calls.find(([c]) => c === "commit_import")![1] as Record<string, unknown>;
    expect(commit.columnMap).toEqual(MAP);
    const previews = call.mock.calls.filter(([c]) => c === "preview_import");
    expect(previews).toHaveLength(2); // the retry after the failed commit
    expect(previews[1][1]).toMatchObject({ columnMap: MAP });
  });

  it("sends null when no mapping was needed", async () => {
    const call = vi.fn(async (_command: string, _args?: Record<string, unknown>) => PREVIEW);
    const api = mount(call);
    await act(async () => api().begin("C:/bank.csv", false, 7, null));
    expect(call).toHaveBeenCalledWith("preview_import", expect.objectContaining({ columnMap: null }));
  });
});
