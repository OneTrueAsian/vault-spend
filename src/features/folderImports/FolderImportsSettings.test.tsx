// @vitest-environment jsdom
import { afterEach, describe, expect, it, vi } from "vitest";
import { act } from "react";
import { createRoot } from "react-dom/client";
import { FolderImportsSettings } from "./FolderImportsSettings";
import type { FolderImports } from "./folderImportsApi";
import type { Account } from "../../shared/lib/types";

(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

const account = { id: 2, name: "Max Checking", hidden: false } as Account;

describe("FolderImportsSettings", () => {
  let cleanup: (() => void) | null = null;
  afterEach(() => cleanup?.());

  async function render(initial: Omit<FolderImports, "seen_activity_id">, pickFolder = vi.fn(async () => "D:\\Exports")) {
    let current: FolderImports = { ...initial, seen_activity_id: 0 };
    const call = vi.fn(async (command: string, args?: Record<string, unknown>) => {
      if (command === "get_folder_imports") return current;
      if (command === "set_folder_import_folder") {
        current = { ...current, folder: String(args?.dir) };
        return args?.dir;
      }
      if (command === "save_folder_import_mapping") {
        const input = args?.mapping as { id: number | null };
        if (input.id !== null) return input.id;
        current = {
          ...current,
          mappings: [{ id: 7, account_id: 2, account_name: "Max Checking", account_usable: true, stem: "Bank Max Checking", extensions: ["csv", "xlsx"], invert_amounts: true, initial_cutoff: null, watermark: null }],
        };
        return 7;
      }
      if (command === "delete_folder_import_mapping") {
        current = { ...current, mappings: current.mappings.filter((m) => m.id !== args?.id) };
        return undefined;
      }
      if (command === "clear_folder_import_watermark") {
        current = { ...current, mappings: current.mappings.map((m) => (m.id === args?.id ? { ...m, watermark: null } : m)) };
        return undefined;
      }
      return undefined;
    });
    const onChanged = vi.fn();
    const container = document.createElement("div");
    document.body.append(container);
    const root = createRoot(container);
    await act(async () => root.render(<FolderImportsSettings accounts={[account]} call={call as never} pickFolder={pickFolder} onChanged={onChanged} />));
    cleanup = () => {
      act(() => root.unmount());
      container.remove();
    };
    return { call, onChanged, pickFolder };
  }

  const toggle = () => document.querySelector<HTMLInputElement>("[data-folder-imports-toggle] input")!;
  /** Picks an account in the new name's Account menu. */
  const chooseAccount = async (name: string) => {
    const trigger = document.querySelector<HTMLButtonElement>("[data-folder-mapping='new'] [aria-haspopup='menu']")!;
    await act(async () => trigger.click());
    const option = [...document.querySelectorAll<HTMLElement>("[role='menuitemradio']")].find((o) => o.textContent === name)!;
    await act(async () => option.click());
  };
  const button = (selector: string) => document.querySelector<HTMLButtonElement>(selector)!;

  it("starts off, and can't be turned on until a folder and an export name exist", async () => {
    await render({ enabled: false, folder: null, folder_missing: false, mappings: [], pending: [] });
    expect(document.querySelector("[data-setting-card='folder-imports']")).not.toBeNull();
    expect(toggle().checked).toBe(false);
    expect(toggle().disabled).toBe(true);
    expect(document.body.textContent).toContain("Choose a folder and add at least one export name first.");
  });

  it("chooses the folder through the picker and saves an export name with its account, convention and start choice", async () => {
    const { call, onChanged } = await render({ enabled: false, folder: null, folder_missing: false, mappings: [], pending: [] });
    await act(async () => button("[data-folder-choose]").click());
    expect(call).toHaveBeenCalledWith("set_folder_import_folder", { dir: "D:\\Exports" });
    await act(async () => button("[data-folder-add-mapping]").click());
    const stem = document.querySelector<HTMLInputElement>("[data-folder-stem]")!;
    await act(async () => {
      const setter = Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, "value")!.set!;
      setter.call(stem, "Bank Max Checking_");
      stem.dispatchEvent(new Event("input", { bubbles: true }));
    });
    await act(async () => document.querySelector<HTMLInputElement>("[data-folder-include-existing]")!.click());
    await chooseAccount("Max Checking");
    await act(async () => button("[data-folder-save-mapping]").click());
    expect(call).toHaveBeenCalledWith("save_folder_import_mapping", {
      mapping: { id: null, account_id: 2, stem: "Bank Max Checking_", extensions: ["csv", "xlsx"], invert_amounts: false, initial_cutoff: null },
    });
    expect(onChanged).toHaveBeenCalled();
    expect(toggle().disabled).toBe(false);
  });

  it("shows a deleted or hidden account as needing a new one", async () => {
    await render({
      enabled: true,
      folder: "D:\\Exports",
      folder_missing: true,
      mappings: [{ id: 7, account_id: 9, account_name: null, account_usable: false, stem: "Bank", extensions: ["csv"], invert_amounts: false, initial_cutoff: "2026-11-01", watermark: "2026-11-18" }],
      pending: [],
    });
    expect(document.body.textContent).toContain("deleted or hidden");
    expect(document.body.textContent).toContain("can't be found right now");
    expect(document.body.textContent).toContain("Newest imported export");
  });

  it("starts a new name a week back, so a recent export already saved isn't skipped, and says what the date does", async () => {
    const { call } = await render({ enabled: false, folder: "D:\\Exports", folder_missing: false, mappings: [], pending: [] });
    await act(async () => button("[data-folder-add-mapping]").click());
    const stem = document.querySelector<HTMLInputElement>("[data-folder-stem]")!;
    await act(async () => {
      Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, "value")!.set!.call(stem, "Bank");
      stem.dispatchEvent(new Event("input", { bubbles: true }));
    });
    expect(document.body.textContent).toContain("Exports dated before this are skipped");
    await chooseAccount("Max Checking");
    await act(async () => button("[data-folder-save-mapping]").click());
    const weekAgo = new Date();
    weekAgo.setDate(weekAgo.getDate() - 7);
    const iso = `${weekAgo.getFullYear()}-${String(weekAgo.getMonth() + 1).padStart(2, "0")}-${String(weekAgo.getDate()).padStart(2, "0")}`;
    expect(call).toHaveBeenCalledWith("save_folder_import_mapping", { mapping: expect.objectContaining({ initial_cutoff: iso }) });
  });

  it("labels each name's fields by that name and groups its choices", async () => {
    await render({
      enabled: true,
      folder: "D:\\Exports",
      folder_missing: false,
      mappings: [
        { id: 7, account_id: 2, account_name: "Max Checking", account_usable: true, stem: "Bank Max Checking", extensions: ["csv"], invert_amounts: false, initial_cutoff: null, watermark: null },
        { id: 8, account_id: 2, account_name: "Max Checking", account_usable: false, stem: "Card", extensions: ["csv"], invert_amounts: false, initial_cutoff: null, watermark: null },
      ],
      pending: [],
    });
    // A menu's label also reads out its choice ("<name>: <choice>").
    const labels = [...document.querySelectorAll("[aria-label]")].map((e) => e.getAttribute("aria-label")!.split(":")[0]);
    expect(labels).toContain("Account for Bank Max Checking exports");
    expect(labels).toContain("Account for Card exports");
    expect(labels).toContain("How amounts read in Card exports");
    const legends = [...document.querySelectorAll("[data-folder-mapping='8'] fieldset legend")].map((l) => l.textContent);
    expect(legends).toEqual(["File types", "Which exports"]);
    expect(document.querySelector("[data-folder-mapping='8'] [role='alert']")!.className).toContain("import-review-notice");
  });

  const saved = (id: number, stem: string, watermark: string | null = null) => ({
    id,
    account_id: 2,
    account_name: "Max Checking",
    account_usable: true,
    stem,
    extensions: ["csv"],
    invert_amounts: false,
    initial_cutoff: null,
    watermark,
  });

  const typeInto = async (input: HTMLInputElement, value: string) =>
    act(async () => {
      Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, "value")!.set!.call(input, value);
      input.dispatchEvent(new Event("input", { bubbles: true }));
    });

  it("starts a new export name with no account chosen, so the right one is picked on purpose", async () => {
    await render({ enabled: false, folder: "D:/Exports", folder_missing: false, mappings: [], pending: [] });
    await act(async () => button("[data-folder-add-mapping]").click());
    const trigger = document.querySelector<HTMLButtonElement>("[data-folder-mapping='new'] [aria-haspopup='menu']")!;
    expect(trigger.textContent).toContain("Choose an account");
    await typeInto(document.querySelector<HTMLInputElement>("[data-folder-stem]")!, "Bank");
    expect(button("[data-folder-save-mapping]").disabled).toBe(true);
    await chooseAccount("Max Checking");
    expect(button("[data-folder-save-mapping]").disabled).toBe(false);
  });

  it("lays setup out in order: folder, then export names, then turning it on", async () => {
    await render({ enabled: false, folder: null, folder_missing: false, mappings: [], pending: [] });
    const steps = [...document.querySelectorAll("[data-folder-step]")].map((s) => s.textContent);
    expect(steps).toEqual(["1. Choose the folder", "2. Name your exports", "3. Turn it on"]);
    const order = ["[data-folder-choose]", "[data-folder-add-mapping]", "[data-folder-imports-toggle]"].map((s) => document.querySelector(s)!);
    expect(order[0].compareDocumentPosition(order[1]) & Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy();
    expect(order[1].compareDocumentPosition(order[2]) & Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy();
  });

  it("keeps unsaved names and edits when something else in the card is saved", async () => {
    await render({ enabled: false, folder: "D:/Exports", folder_missing: false, mappings: [saved(5, "Card"), saved(6, "Savings")], pending: [] });
    await typeInto(document.querySelector<HTMLInputElement>("[data-folder-mapping='5'] [data-folder-stem]")!, "Card edited");
    await act(async () => button("[data-folder-add-mapping]").click());
    await typeInto(document.querySelector<HTMLInputElement>("[data-folder-mapping='new'] [data-folder-stem]")!, "Half typed");
    await act(async () => button("[data-folder-mapping='6'] [data-folder-save-mapping]").click());
    expect(document.querySelector<HTMLInputElement>("[data-folder-mapping='5'] [data-folder-stem]")!.value).toBe("Card edited");
    expect(document.querySelector<HTMLInputElement>("[data-folder-mapping='new'] [data-folder-stem]")!.value).toBe("Half typed");
  });

  it("asks before removing an export name or stopping using the folder", async () => {
    const { call } = await render({ enabled: true, folder: "D:/Exports", folder_missing: false, mappings: [saved(5, "Card")], pending: [] });
    await act(async () => button("[data-folder-remove-mapping='5']").click());
    expect(call).not.toHaveBeenCalledWith("delete_folder_import_mapping", expect.anything());
    await act(async () => button("[data-folder-confirm-remove-mapping='5']").click());
    expect(call).toHaveBeenCalledWith("delete_folder_import_mapping", { id: 5 });
    await act(async () => button("[data-folder-stop]").click());
    expect(call).not.toHaveBeenCalledWith("set_folder_import_folder", { dir: null });
    await act(async () => button("[data-folder-confirm-stop]").click());
    expect(call).toHaveBeenCalledWith("set_folder_import_folder", { dir: null });
  });

  it("can start an export name over from its start date", async () => {
    const { call } = await render({ enabled: true, folder: "D:/Exports", folder_missing: false, mappings: [saved(5, "Card", "2099-01-01")], pending: [] });
    expect(document.body.textContent).toContain("Newest imported export");
    await act(async () => button("[data-folder-clear-watermark='5']").click());
    expect(call).toHaveBeenCalledWith("clear_folder_import_watermark", { id: 5 });
    expect(document.body.textContent).not.toContain("Newest imported export");
  });
});
