// @vitest-environment jsdom
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { invoke } from "@tauri-apps/api/core";
import { StatementLayoutsSection } from "./StatementLayoutsSection";

(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;
vi.mock("@tauri-apps/api/core", () => ({ invoke: vi.fn() }));
vi.mock("./profileUiState", () => ({ getCurrentGeneration: () => Promise.resolve(7) }));

let container: HTMLDivElement;
let root: Root;
const layout = { id: 3, name: "Riverbend", phrases: ["Riverbend Mutual Bank"], updated_at: "2026-10-11 10:00:00" };
const click = (selector: string) => act(async () => container.querySelector<HTMLButtonElement>(selector)!.click());

describe("StatementLayoutsSection", () => {
  beforeEach(() => {
    container = document.createElement("div");
    document.body.appendChild(container);
    root = createRoot(container);
  });
  afterEach(() => {
    act(() => root.unmount());
    container.remove();
    vi.mocked(invoke).mockReset();
  });

  it("lists learned statements and removes one only after a second click", async () => {
    vi.mocked(invoke).mockImplementation(async (cmd) => (cmd === "list_statement_layouts" ? [layout] : null));
    const messages: string[] = [];
    await act(async () => root.render(<StatementLayoutsSection onMessage={(t) => messages.push(t)} />));
    expect(vi.mocked(invoke)).toHaveBeenCalledWith("list_statement_layouts", { generation: 7 });
    expect(container.textContent).toContain("Riverbend");
    expect(container.textContent).toContain("Recognized by: “Riverbend Mutual Bank”");

    await click("[data-remove-layout='3']");
    expect(vi.mocked(invoke)).not.toHaveBeenCalledWith("delete_statement_layout", expect.anything());
    await click("[data-confirm-remove-layout='3']");
    expect(vi.mocked(invoke)).toHaveBeenCalledWith("delete_statement_layout", { id: 3, generation: 7 });
    expect(messages.at(-1)).toContain("Removed.");
  });

  it("renames a learned statement", async () => {
    vi.mocked(invoke).mockImplementation(async (cmd) => (cmd === "list_statement_layouts" ? [layout] : null));
    await act(async () => root.render(<StatementLayoutsSection onMessage={() => {}} />));
    await click("[data-rename-layout='3']");
    await act(async () => {
      const input = container.querySelector<HTMLInputElement>("[data-rename-input]")!;
      Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, "value")!.set!.call(input, "Riverbend Credit Union");
      input.dispatchEvent(new Event("input", { bubbles: true }));
    });
    await click("[data-save-layout-name='3']");
    expect(vi.mocked(invoke)).toHaveBeenCalledWith("rename_statement_layout", { id: 3, name: "Riverbend Credit Union", generation: 7 });
    expect(container.querySelector("[data-rename-input]")).toBeNull();
  });

  it("shows the app's message when a change is refused and keeps the list", async () => {
    vi.mocked(invoke).mockImplementation(async (cmd) => {
      if (cmd === "list_statement_layouts") return [layout];
      throw "The profile changed. Close this statement and start again in the current profile.";
    });
    const messages: string[] = [];
    await act(async () => root.render(<StatementLayoutsSection onMessage={(t) => messages.push(t)} />));
    await click("[data-remove-layout='3']");
    await click("[data-confirm-remove-layout='3']");
    expect(messages.at(-1)).toContain("The profile changed.");
    expect(container.textContent).toContain("Riverbend");
  });

  it("explains when there are none", async () => {
    vi.mocked(invoke).mockResolvedValue([]);
    await act(async () => root.render(<StatementLayoutsSection onMessage={() => {}} />));
    expect(container.textContent).toContain("When you upload a statement from a new bank");
  });
});
