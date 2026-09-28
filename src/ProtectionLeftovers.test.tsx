// @vitest-environment jsdom
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import type { Profile } from "./types";

const protection = vi.hoisted(() => ({
  listProtectionLeftovers: vi.fn(),
  deleteProtectionLeftovers: vi.fn(),
}));
vi.mock("./protection", () => protection);

import { ProtectionLeftovers } from "./ProtectionLeftovers";

(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

const PROTECTED_PROFILE: Profile[] = [
  { id: "a", name: "Alex", is_active: true, icon_key: null, is_password_protected: true },
];
const UNPROTECTED_PROFILE: Profile[] = [
  { id: "a", name: "Alex", is_active: true, icon_key: null, is_password_protected: false },
];

async function flush() {
  await act(async () => {
    await Promise.resolve();
    await Promise.resolve();
  });
}

describe("ProtectionLeftovers", () => {
  let container: HTMLDivElement;
  let root: Root;

  beforeEach(() => {
    protection.listProtectionLeftovers.mockReset();
    protection.deleteProtectionLeftovers.mockReset();
    container = document.createElement("div");
    document.body.append(container);
    root = createRoot(container);
  });

  afterEach(() => {
    act(() => root.unmount());
    container.remove();
  });

  async function show(profiles: Profile[]) {
    act(() => {
      root.render(<ProtectionLeftovers profiles={profiles} />);
    });
    await flush();
  }

  it("renders nothing for a profile that isn't protected — never even asks the backend", async () => {
    await show(UNPROTECTED_PROFILE);

    expect(protection.listProtectionLeftovers).not.toHaveBeenCalled();
    expect(container.textContent).toBe("");
  });

  it("renders nothing once the backend reports no leftovers", async () => {
    protection.listProtectionLeftovers.mockResolvedValue([]);

    await show(PROTECTED_PROFILE);

    expect(container.textContent).toBe("");
  });

  it("lists each leftover's kind and path, hiding a mirrored one until the mirror checkbox is on", async () => {
    protection.listProtectionLeftovers.mockResolvedValue([
      { path: "C:\\data\\vaultspend.db", kind: "original_database", size_bytes: 1024 },
      { path: "C:\\data\\backups\\vaultspend-20260101.db", kind: "plaintext_backup", size_bytes: 512 },
      { path: "D:\\mirror\\vaultspend-20260101.db", kind: "mirrored_plaintext_backup", size_bytes: 512 },
    ]);

    await show(PROTECTED_PROFILE);

    expect(container.textContent).toContain("C:\\data\\vaultspend.db");
    expect(container.textContent).toContain("C:\\data\\backups\\vaultspend-20260101.db");
    expect(container.textContent).not.toContain("D:\\mirror\\vaultspend-20260101.db");

    act(() => {
      container.querySelector<HTMLInputElement>("input[type='checkbox']")!.click();
    });

    expect(container.textContent).toContain("D:\\mirror\\vaultspend-20260101.db");
  });

  it("Delete plaintext copies now deletes every visible entry and reports any that failed", async () => {
    protection.listProtectionLeftovers
      .mockResolvedValueOnce([
        { path: "C:\\data\\vaultspend.db", kind: "original_database", size_bytes: 1024 },
        { path: "C:\\data\\backups\\old.db", kind: "plaintext_backup", size_bytes: 512 },
      ])
      .mockResolvedValueOnce([]);
    protection.deleteProtectionLeftovers.mockResolvedValue(["C:\\data\\backups\\old.db"]);
    await show(PROTECTED_PROFILE);

    await act(async () => {
      [...container.querySelectorAll<HTMLButtonElement>("button")].find((b) => b.textContent === "Delete plaintext copies now")!.click();
      await flush();
    });

    expect(protection.deleteProtectionLeftovers).toHaveBeenCalledWith(["C:\\data\\vaultspend.db", "C:\\data\\backups\\old.db"]);
    expect(container.querySelector('[role="alert"]')?.textContent).toContain("C:\\data\\backups\\old.db");
  });

  it("Keep for now dismisses the banner without deleting anything", async () => {
    protection.listProtectionLeftovers.mockResolvedValue([{ path: "C:\\data\\vaultspend.db", kind: "original_database", size_bytes: 1024 }]);
    await show(PROTECTED_PROFILE);

    act(() => {
      [...container.querySelectorAll<HTMLButtonElement>("button")].find((b) => b.textContent === "Keep for now")!.click();
    });

    expect(protection.deleteProtectionLeftovers).not.toHaveBeenCalled();
    expect(container.textContent).toBe("");
  });
});
