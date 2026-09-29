import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const dialog = vi.hoisted(() => ({ open: vi.fn(), save: vi.fn() }));
vi.mock("@tauri-apps/plugin-dialog", () => dialog);

const invokeMock = vi.hoisted(() => vi.fn());
vi.mock("@tauri-apps/api/core", () => ({ invoke: invokeMock }));

describe("nativeDialog", () => {
  beforeEach(() => {
    dialog.open.mockReset();
    dialog.save.mockReset();
    invokeMock.mockReset().mockResolvedValue(undefined);
  });

  afterEach(() => {
    vi.resetModules();
  });

  it("marks a dialog open before calling through, and closed again once it resolves", async () => {
    const { open } = await import("./nativeDialog");
    let stateWhenDialogRan: unknown;
    dialog.open.mockImplementation(async () => {
      stateWhenDialogRan = invokeMock.mock.calls.find((call) => call[0] === "note_native_dialog_state")?.[1];
      return "/picked/path";
    });

    const result = await open({ multiple: false });

    expect(stateWhenDialogRan).toEqual({ open: true });
    expect(result).toBe("/picked/path");
    expect(invokeMock).toHaveBeenNthCalledWith(1, "note_native_dialog_state", { open: true });
    expect(invokeMock).toHaveBeenNthCalledWith(2, "note_native_dialog_state", { open: false });
  });

  it("still marks the dialog closed when it's cancelled or rejects", async () => {
    const { save } = await import("./nativeDialog");
    dialog.save.mockRejectedValue(new Error("boom"));

    await expect(save({})).rejects.toThrow("boom");

    expect(invokeMock).toHaveBeenNthCalledWith(1, "note_native_dialog_state", { open: true });
    expect(invokeMock).toHaveBeenNthCalledWith(2, "note_native_dialog_state", { open: false });
  });

  it("still calls through and closes even when the backend notification itself fails", async () => {
    const { open } = await import("./nativeDialog");
    invokeMock.mockRejectedValue(new Error("no such command"));
    dialog.open.mockResolvedValue("/picked/path");

    const result = await open({ multiple: false });

    expect(result).toBe("/picked/path");
  });
});
