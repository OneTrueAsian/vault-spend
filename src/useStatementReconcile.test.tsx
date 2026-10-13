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
});
