// @vitest-environment jsdom
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { invoke } from "@tauri-apps/api/core";
import { useStatementReconcile } from "./useStatementReconcile";
import { sampleReview } from "./statementTestUtils";

(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

vi.mock("@tauri-apps/api/core", () => ({ invoke: vi.fn() }));
vi.mock("./nativeDialog", () => ({ open: vi.fn(() => Promise.resolve("C:/statements/aug.pdf")) }));
vi.mock("./profileUiState", () => ({ getCurrentGeneration: () => Promise.resolve(7) }));

let hook: ReturnType<typeof useStatementReconcile>;
function Probe() {
  hook = useStatementReconcile(5);
  return null;
}

const failing = { outcome: "failed", expected: "1", found: "2" } as const;

describe("useStatementReconcile", () => {
  let root: Root;
  beforeEach(async () => {
    root = createRoot(document.createElement("div"));
    await act(async () => root.render(<Probe />));
  });
  afterEach(() => {
    act(() => root.unmount());
    vi.mocked(invoke).mockReset();
  });

  it("reads the chosen file for the period and opens the review", async () => {
    vi.mocked(invoke).mockResolvedValueOnce({ token: "tok", sections: [{ index: 0, name: "Statement", row_count: 2, holding_count: 0 }], review: sampleReview() });
    await act(async () => hook.start("2026-07-22", "2026-08-21"));
    expect(invoke).toHaveBeenCalledWith("read_statement", { path: "C:/statements/aug.pdf", accountId: 5, periodStart: "2026-07-22", periodEnd: "2026-08-21", generation: 7 });
    expect(hook.phase.kind).toBe("review");
  });

  it("asks which account when the statement holds several", async () => {
    vi.mocked(invoke).mockResolvedValueOnce({ token: "tok", sections: [{ index: 0, name: "Savings", row_count: 0, holding_count: 0 }, { index: 1, name: "Checking", row_count: 5, holding_count: 0 }], review: null });
    await act(async () => hook.start("2026-08-01", "2026-08-31"));
    expect(hook.phase.kind).toBe("choose_section");
    vi.mocked(invoke).mockResolvedValueOnce(sampleReview());
    await act(async () => hook.chooseSection(1));
    expect(invoke).toHaveBeenLastCalledWith("review_statement", { token: "tok", sectionIndex: 1, flip: false, generation: 7 });
    expect(hook.phase.kind).toBe("review");
  });

  it("shows the backend's message and stays where it was when reading fails", async () => {
    vi.mocked(invoke).mockRejectedValueOnce("This PDF is a picture of the statement, so the app can't read its text.");
    await act(async () => hook.start("2026-08-01", "2026-08-31"));
    expect(hook.phase.kind).toBe("idle");
    expect(hook.error).toContain("picture of the statement");
  });

  it("counts teaching attempts", async () => {
    vi.mocked(invoke).mockResolvedValueOnce({ token: "tok", sections: [], review: sampleReview({ activity_check: failing }) });
    await act(async () => hook.start("2026-08-01", "2026-08-31"));
    vi.mocked(invoke).mockResolvedValueOnce([{ index: 0, page: 0, text: "Opening balance 1,250.00" }]);
    await act(async () => hook.openTeach());
    expect(hook.phase.kind).toBe("teach");
    vi.mocked(invoke).mockResolvedValueOnce(sampleReview({ activity_check: failing }));
    await act(async () => hook.teach({ rows: [], balances: null, holdings: [] }));
    expect(hook.phase.kind === "teach" && hook.phase.attempts).toBe(1);
  });

  it("always uses the newest token, because every step replaces it", async () => {
    vi.mocked(invoke).mockResolvedValueOnce({ token: "t1", sections: [], review: sampleReview({ token: "t1" }) });
    await act(async () => hook.start("2026-08-01", "2026-08-31"));
    vi.mocked(invoke).mockResolvedValueOnce(sampleReview({ token: "t2", flipped: true }));
    await act(async () => hook.setFlip(true));
    expect(invoke).toHaveBeenLastCalledWith("review_statement", { token: "t1", sectionIndex: 0, flip: true, generation: 7 });
    vi.mocked(invoke).mockResolvedValueOnce([{ index: 0, page: 0, text: "x" }]);
    await act(async () => hook.openTeach());
    expect(invoke).toHaveBeenLastCalledWith("statement_lines", { token: "t2", generation: 7 });
    vi.mocked(invoke).mockResolvedValueOnce(sampleReview({ token: "t3", activity_check: failing }));
    await act(async () => hook.teach({ rows: [], balances: null, holdings: [] }));
    vi.mocked(invoke).mockResolvedValueOnce({ reconciliation_id: 9, added: 1, layout_saved: null });
    const decisions = { matches: [], add: [], skip: [], startingBalance: null, endingBalance: null, holdings: [], finishWithoutHoldings: false, ignoreUnread: false, saveLayout: null };
    await act(async () => hook.finish(decisions));
    expect(invoke).toHaveBeenLastCalledWith("finish_statement_reconciliation", { token: "t3", decisions, generation: 7 });
    expect(hook.phase.kind).toBe("done");
  });

  it("refuses a response that doesn't have the expected shape", async () => {
    vi.mocked(invoke).mockResolvedValueOnce({ token: "tok", sections: [], review: { token: "tok" } });
    await act(async () => hook.start("2026-08-01", "2026-08-31"));
    expect(hook.phase.kind).toBe("idle");
    expect(hook.error).toContain("unexpected statement response");
  });

  it("cancelling tells the app to forget the review with its newest token", async () => {
    vi.mocked(invoke).mockResolvedValueOnce({ token: "tok", sections: [], review: sampleReview() });
    await act(async () => hook.start("2026-08-01", "2026-08-31"));
    vi.mocked(invoke).mockResolvedValueOnce(undefined);
    await act(async () => hook.cancel());
    expect(invoke).toHaveBeenLastCalledWith("cancel_statement_review", { token: "tok", generation: 7 });
    expect(hook.phase.kind).toBe("idle");
  });

  it("does nothing when the file picker is closed without a choice", async () => {
    const { open } = await import("./nativeDialog");
    vi.mocked(open).mockResolvedValueOnce(null);
    await act(async () => hook.start("2026-08-01", "2026-08-31"));
    expect(invoke).not.toHaveBeenCalled();
    expect(hook.phase.kind).toBe("idle");
  });

  const decisions = { matches: [], add: [], skip: [], startingBalance: null, endingBalance: null, holdings: [], finishWithoutHoldings: false, ignoreUnread: false, saveLayout: null };
  const cancelCalls = () => vi.mocked(invoke).mock.calls.filter((c) => c[0] === "cancel_statement_review");

  async function startReview(token = "tok") {
    vi.mocked(invoke).mockResolvedValueOnce({ token, sections: [], review: sampleReview({ token }) });
    await act(async () => hook.start("2026-08-01", "2026-08-31"));
  }

  it("ignores the answer of a read that finishes after cancel, and forgets that review", async () => {
    let resolve: (v: unknown) => void = () => {};
    vi.mocked(invoke).mockReturnValueOnce(new Promise((r) => (resolve = r)));
    let pending: Promise<void> = Promise.resolve();
    await act(async () => {
      pending = hook.start("2026-08-01", "2026-08-31") as Promise<void>;
    });
    await act(async () => hook.cancel());
    await act(async () => {
      resolve({ token: "late", sections: [], review: sampleReview({ token: "late" }) });
      await pending;
    });
    expect(hook.phase.kind).toBe("idle");
    expect(hook.busy).toBe(false);
    expect(cancelCalls()).toEqual([["cancel_statement_review", { token: "late", generation: 7 }]]);
  });

  it("sends one request for a double click", async () => {
    await startReview();
    let resolve: (v: unknown) => void = () => {};
    vi.mocked(invoke).mockReturnValueOnce(new Promise((r) => (resolve = r)));
    await act(async () => {
      void hook.setFlip(true);
      void hook.setFlip(true);
    });
    expect(vi.mocked(invoke).mock.calls.filter((c) => c[0] === "review_statement")).toHaveLength(1);
    await act(async () => resolve(sampleReview({ token: "t2" })));
    expect(hook.busy).toBe(false);
  });

  it("does not tell the app to forget a review that was already finished", async () => {
    await startReview();
    vi.mocked(invoke).mockResolvedValueOnce({ reconciliation_id: 1, added: 0, layout_saved: null });
    await act(async () => hook.finish(decisions));
    await act(async () => hook.cancel());
    expect(cancelCalls()).toHaveLength(0);
    expect(hook.phase.kind).toBe("idle");
  });

  it("forgets the open review when the screen goes away", async () => {
    await startReview("t9");
    vi.mocked(invoke).mockResolvedValue(undefined);
    await act(async () => root.unmount());
    expect(cancelCalls()).toEqual([["cancel_statement_review", { token: "t9", generation: 7 }]]);
    root = createRoot(document.createElement("div"));
  });

  async function twoPartsThenTeach(taughtSection: number) {
    vi.mocked(invoke).mockResolvedValueOnce({ token: "a", sections: [{ index: 0, name: "A", row_count: 1, holding_count: 0 }, { index: 1, name: "B", row_count: 1, holding_count: 0 }], review: null });
    await act(async () => hook.start("2026-08-01", "2026-08-31"));
    vi.mocked(invoke).mockResolvedValueOnce(sampleReview({ token: "b", section_index: 1, activity_check: failing }));
    await act(async () => hook.chooseSection(1));
    vi.mocked(invoke).mockResolvedValueOnce([]);
    await act(async () => hook.openTeach());
    vi.mocked(invoke).mockResolvedValueOnce(sampleReview({ token: "c", section_index: taughtSection }));
    await act(async () => hook.teach({ rows: [], balances: null, holdings: [] }));
    vi.mocked(invoke).mockResolvedValueOnce(sampleReview({ token: "d", section_index: taughtSection }));
    await act(async () => hook.setFlip(true));
  }

  it("flips the part the review says it shows after teaching left fewer parts", async () => {
    await twoPartsThenTeach(0);
    expect(invoke).toHaveBeenLastCalledWith("review_statement", { token: "c", sectionIndex: 0, flip: true, generation: 7 });
  });

  it("keeps flipping the same part when teaching kept it", async () => {
    await twoPartsThenTeach(1);
    expect(invoke).toHaveBeenLastCalledWith("review_statement", { token: "c", sectionIndex: 1, flip: true, generation: 7 });
  });

  it("follows the part a read opens straight into", async () => {
    vi.mocked(invoke).mockResolvedValueOnce({ token: "t", sections: [], review: sampleReview({ token: "t", section_index: 1 }) });
    await act(async () => hook.start("2026-08-01", "2026-08-31"));
    vi.mocked(invoke).mockResolvedValueOnce(sampleReview({ token: "u", section_index: 1 }));
    await act(async () => hook.setFlip(true));
    expect(invoke).toHaveBeenLastCalledWith("review_statement", { token: "t", sectionIndex: 1, flip: true, generation: 7 });
  });

  it("forgets a read that came back malformed so a later finish can't use it", async () => {
    vi.mocked(invoke).mockResolvedValueOnce({ token: "bad", sections: [], review: { token: "bad" } });
    vi.mocked(invoke).mockResolvedValueOnce(undefined);
    await act(async () => hook.start("2026-08-01", "2026-08-31"));
    expect(cancelCalls()).toEqual([["cancel_statement_review", { token: "bad", generation: 7 }]]);
    vi.mocked(invoke).mockClear();
    await act(async () => hook.cancel());
    expect(cancelCalls()).toHaveLength(0);
  });

  it("keeps the teaching attempt count when going back to the review and teaching again", async () => {
    await startReview();
    vi.mocked(invoke).mockResolvedValueOnce([]);
    await act(async () => hook.openTeach());
    vi.mocked(invoke).mockResolvedValueOnce(sampleReview({ token: "t2", activity_check: failing }));
    await act(async () => hook.teach({ rows: [], balances: null, holdings: [] }));
    await act(async () => hook.backToReview());
    vi.mocked(invoke).mockResolvedValueOnce([]);
    await act(async () => hook.openTeach());
    expect(hook.phase.kind === "teach" && hook.phase.attempts).toBe(1);
  });
});
