// @vitest-environment jsdom
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { invoke } from "@tauri-apps/api/core";
import { listen } from "@tauri-apps/api/event";
import { HoldingImportDialog } from "./HoldingImportDialog";
import type { Account } from "./types";
import type { HoldingImportRow, HoldingPreview } from "./holdingImport";

vi.mock("@tauri-apps/api/core", () => ({ invoke: vi.fn() }));
vi.mock("@tauri-apps/api/event", () => ({ listen: vi.fn(() => Promise.resolve(vi.fn())) }));
vi.mock("@tauri-apps/api/webview", () => ({ getCurrentWebview: () => ({ onDragDropEvent: () => Promise.resolve(vi.fn()) }) }));
vi.mock("./profileUiState", () => ({ getCurrentGeneration: () => Promise.resolve(7) }));
(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

const accounts = [{ id: 2, name: "Brokerage", account_type: "investment" }, { id: 1, name: "Checking", account_type: "checking" }] as Account[];
const row = (number: number, symbol: string, overrides: Partial<HoldingImportRow> = {}): HoldingImportRow => ({ row_number: number, holding: { symbol, name: symbol, shares: "0.125", price: "100.10", cost_basis: "10", asset_class: null }, error: null, repeated: false, already_exists: false, value: "12.51250", ...overrides });
const preview: HoldingPreview = { account_name: "Brokerage", current_value: "500", holdings_value: "0", has_holdings: false, rows: [row(2, "NEW"), row(3, "OLD", { already_exists: true }), row(4, "BAD", { holding: null, error: "Enter total cost." }), row(5, "DUP", { repeated: true }), row(6, "DUP", { repeated: true })] };

describe("holding import review", () => {
  let root: Root, container: HTMLDivElement;
  const onClose = vi.fn(), onSaved = vi.fn(async () => {});
  beforeEach(async () => {
    vi.clearAllMocks();
    vi.mocked(invoke).mockImplementation(async (command) => {
      if (command === "load_holding_import") return { id: "preview-1", headers: ["Symbol", "Shares", "Price", "Cost Basis"], samples: [["NEW", "0.125", "100.10", "10"]], row_count: 5 };
      if (command === "preview_holding_import") return preview;
      if (command === "commit_holding_import") return 1;
      return undefined;
    });
    container = document.createElement("div"); document.body.append(container); root = createRoot(container);
    await act(async () => root.render(<HoldingImportDialog accounts={accounts} onClose={onClose} onSaved={onSaved} />));
  });
  afterEach(async () => { await act(async () => root.unmount()); container.remove(); });
  function button(text: string) { return [...document.querySelectorAll<HTMLButtonElement>("button")].find(b => b.textContent === text)!; }
  async function click(text: string) { await act(async () => button(text).click()); }
  async function reviewRows() {
    await click("Paste rows");
    const textarea = document.querySelector("textarea")!;
    await act(async () => { Object.getOwnPropertyDescriptor(HTMLTextAreaElement.prototype, "value")!.set!.call(textarea, "Symbol,Shares,Price,Cost Basis\nNEW,0.125,100.10,10"); textarea.dispatchEvent(new Event("input", { bubbles: true })); });
    await click("Match columns"); await click("Review holdings");
  }
  it("uses app controls without any native file or dropdown picker", () => {
    expect(document.querySelector("select, input[type=file], datalist")).toBeNull();
    expect(button("Browse files…")).toBeTruthy();
    expect(document.querySelector('[aria-label^="Import account"]')?.textContent).toContain("Brokerage");
  });
  it("excludes existing and invalid rows and makes repeated rows an explicit choice", async () => {
    await reviewRows();
    const boxes = [...document.querySelectorAll<HTMLInputElement>('input[type=checkbox]')];
    expect(boxes.map(b => b.checked)).toEqual([true, false, false, false, false]);
    expect(boxes.map(b => b.disabled)).toEqual([false, true, true, false, false]);
    await act(async () => boxes[3].click());
    expect(boxes[4].disabled).toBe(true);
    expect(document.body.textContent).toContain("Include all current positions");
  });
  it("saves only reviewed row IDs and the profile generation, never client prices", async () => {
    await reviewRows(); await click("Add 1 holdings");
    expect(invoke).toHaveBeenCalledWith("commit_holding_import", { id: "preview-1", selectedRows: [2], generation: 7 });
    expect(onSaved).toHaveBeenCalledWith(1, "Brokerage");
    expect(document.body.textContent).toContain("Your holdings are saved");
    expect(document.querySelector("[data-add-imported-holdings]")).toBeNull();
  });
  it("keeps a rejected save in review with its failure message", async () => {
    await reviewRows();
    vi.mocked(invoke).mockRejectedValueOnce("This account changed. Review again.");
    await click("Add 1 holdings");
    expect(document.querySelector('[role="alert"]')?.textContent).toContain("This account changed");
    expect(onSaved).not.toHaveBeenCalled(); expect(button("Add 1 holdings").disabled).toBe(false);
  });
  it("clears the preview on unmount and closes on a profile change", async () => {
    await reviewRows();
    const callback = vi.mocked(listen).mock.calls[0][1];
    await act(async () => callback({ event: "profile-lock-state-changed", id: 1, payload: {} }));
    expect(onClose).toHaveBeenCalledOnce();
    await act(async () => root.unmount());
    expect(invoke).toHaveBeenCalledWith("cancel_holding_import", { id: "preview-1" });
  });
});
