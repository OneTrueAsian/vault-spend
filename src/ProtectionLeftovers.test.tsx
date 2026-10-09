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
const generation = vi.hoisted(() => ({ getCurrentGeneration: vi.fn() }));
vi.mock("./profileUiState", () => generation);

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
    generation.getCurrentGeneration.mockReset().mockResolvedValue(19);
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

    expect(protection.deleteProtectionLeftovers).toHaveBeenCalledWith(["C:\\data\\vaultspend.db", "C:\\data\\backups\\old.db"], "a", 19);
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

  const mirror = { path: "D:\\mirror\\old.db", kind: "mirrored_plaintext_backup", size_bytes: 512 };
  const local = { path: "C:\\data\\old.db", kind: "plaintext_backup", size_bytes: 512 };
  const button = (label: string) => [...container.querySelectorAll<HTMLButtonElement>("button")].find(b => b.textContent === label)!;

  it("discloses mirror-only files with a reachable checkbox and disables only the empty deletion selection", async () => {
    protection.listProtectionLeftovers.mockResolvedValue([mirror]);
    protection.deleteProtectionLeftovers.mockResolvedValue([]);
    await show(PROTECTED_PROFILE);
    expect(container.querySelector('[aria-label="Leftover plaintext files"]')).not.toBeNull();
    expect(container.textContent).toContain("Local plaintext copies: 0");
    expect(container.textContent).toContain("Second-folder copies: 1");
    expect(button("Delete plaintext copies now").disabled).toBe(true);
    act(() => container.querySelector<HTMLInputElement>('input[type="checkbox"]')!.click());
    expect(button("Delete plaintext copies now").disabled).toBe(false);
    await act(async () => { button("Delete plaintext copies now").click(); await flush(); });
    expect(protection.deleteProtectionLeftovers).toHaveBeenCalledWith([mirror.path], "a", 19);
  });

  it("keeps the warning after deleting local files while the mirror is retained", async () => {
    protection.listProtectionLeftovers.mockResolvedValueOnce([local, mirror]).mockResolvedValueOnce([mirror]);
    protection.deleteProtectionLeftovers.mockResolvedValue([]);
    await show(PROTECTED_PROFILE);
    await act(async () => { button("Delete plaintext copies now").click(); await flush(); });
    expect(container.textContent).toContain("Second-folder copies: 1");
    expect(container.querySelector('input[type="checkbox"]')).not.toBeNull();
    expect(protection.deleteProtectionLeftovers).toHaveBeenCalledWith([local.path], "a", 19);
  });

  it("reports failed discovery and retries without claiming an empty inventory", async () => {
    protection.listProtectionLeftovers.mockRejectedValueOnce(new Error("mirror unavailable")).mockResolvedValueOnce([mirror]);
    await show(PROTECTED_PROFILE);
    expect(container.querySelector('[role="alert"]')?.textContent).toContain("Cleanup status could not be checked");
    expect(button("Delete plaintext copies now").disabled).toBe(true);
    await act(async () => { button("Retry cleanup check").click(); await flush(); });
    expect(container.querySelector('[role="alert"]')).toBeNull();
    expect(container.textContent).toContain("Second-folder copies: 1");
  });

  it("rejects a stale profile's late discovery result", async () => {
    let complete!: (value: unknown[]) => void;
    protection.listProtectionLeftovers.mockImplementationOnce(() => new Promise(resolve => { complete = resolve; })).mockResolvedValueOnce([mirror]);
    await show(PROTECTED_PROFILE);
    await show([{ ...PROTECTED_PROFILE[0], id: "b" }]);
    await act(async () => { complete([local]); await flush(); });
    expect(container.textContent).toContain("Second-folder copies: 1");
    expect(container.textContent).not.toContain(local.path);
  });

  it("reports deletion command failures without losing the known inventory", async () => {
    protection.listProtectionLeftovers.mockResolvedValue([local]);
    protection.deleteProtectionLeftovers.mockRejectedValue(new Error("active profile changed"));
    await show(PROTECTED_PROFILE);
    await act(async () => { button("Delete plaintext copies now").click(); await flush(); });
    expect(container.querySelector('[role="alert"]')?.textContent).toContain("active profile changed");
    expect(container.textContent).toContain(local.path);
  });

  it("retains partial-delete errors when rediscovery also fails", async () => {
    protection.listProtectionLeftovers.mockResolvedValueOnce([local]).mockRejectedValueOnce(new Error("mirror unavailable"));
    protection.deleteProtectionLeftovers.mockResolvedValue([local.path]);
    await show(PROTECTED_PROFILE);
    await act(async () => { button("Delete plaintext copies now").click(); await flush(); });
    expect(container.textContent).toContain("Couldn't delete:");
    expect(container.textContent).toContain("Cleanup status could not be checked");
    expect(button("Delete plaintext copies now").disabled).toBe(true);
  });

  it("reserves a deletion immediately so double submission cannot start two operations", async () => {
    protection.listProtectionLeftovers.mockResolvedValue([local]);
    let complete!: (value: string[]) => void;
    protection.deleteProtectionLeftovers.mockImplementation(() => new Promise(resolve => { complete = resolve; }));
    await show(PROTECTED_PROFILE);
    act(() => { button("Delete plaintext copies now").click(); button("Delete plaintext copies now").click(); });
    expect(protection.deleteProtectionLeftovers).toHaveBeenCalledTimes(1);
    await act(async () => { complete([]); await flush(); });
  });

  it("does not apply an old profile's completed deletion or error to the replacement profile", async () => {
    protection.listProtectionLeftovers.mockResolvedValueOnce([local]).mockResolvedValueOnce([mirror]);
    let complete!: (value: string[]) => void;
    protection.deleteProtectionLeftovers.mockImplementationOnce(() => new Promise(resolve => { complete = resolve; }));
    await show(PROTECTED_PROFILE);
    act(() => button("Delete plaintext copies now").click());
    await show([{ ...PROTECTED_PROFILE[0], id: "b" }]);
    await act(async () => { complete([local.path]); await flush(); });
    expect(container.textContent).toContain("Second-folder copies: 1");
    expect(container.textContent).not.toContain("Couldn't delete:");
    expect(protection.listProtectionLeftovers).toHaveBeenCalledTimes(2);
  });

  it("reports generation discovery failures before issuing any inventory command", async () => {
    generation.getCurrentGeneration.mockRejectedValueOnce(new Error("profile unavailable"));
    await show(PROTECTED_PROFILE);
    expect(protection.listProtectionLeftovers).not.toHaveBeenCalled();
    expect(container.textContent).toContain("Cleanup status could not be checked");
  });

  it("refuses a completed inventory when generation changes within the same displayed profile", async () => {
    generation.getCurrentGeneration.mockResolvedValueOnce(19).mockResolvedValue(20);
    protection.listProtectionLeftovers.mockResolvedValue([local]);
    await show(PROTECTED_PROFILE);
    expect(container.textContent).not.toContain(local.path);
    expect(container.textContent).toContain("active profile changed during the cleanup check");
    expect(button("Delete plaintext copies now").disabled).toBe(true);
  });
});
