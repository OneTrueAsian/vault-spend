// @vitest-environment jsdom
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { act } from "react";
import { createRoot, type Root } from "react-dom/client";

const getCurrentGeneration = vi.hoisted(() => vi.fn());
vi.mock("./profileUiState", () => ({ getCurrentGeneration }));
vi.mock("./ProtectionSetupDialog", () => ({
  ProtectionSetupDialog: ({ newProfileName }: { newProfileName: string | null }) => (
    <div data-protection-setup-dialog>{newProfileName}</div>
  ),
}));

import { BackupsBlock, ProfilesSection } from "./SettingsView";

(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

function typeInto(input: HTMLInputElement, value: string) {
  const setValue = Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, "value")!.set!;
  act(() => {
    setValue.call(input, value);
    input.dispatchEvent(new Event("input", { bubbles: true }));
  });
}

describe("Settings ProfilesSection", () => {
  let container: HTMLDivElement;
  let root: Root;
  const onCreateProfile = vi.fn();

  beforeEach(() => {
    getCurrentGeneration.mockReset().mockResolvedValue(11);
    onCreateProfile.mockReset();
    container = document.createElement("div");
    document.body.append(container);
    root = createRoot(container);
  });

  afterEach(() => {
    act(() => root.unmount());
    container.remove();
  });

  function show(profiles: Parameters<typeof ProfilesSection>[0]["profiles"] = []) {
    act(() => {
      root.render(
        <ProfilesSection
          profiles={profiles}
          onCreateProfile={onCreateProfile}
          onUseExistingDataFile={vi.fn()}
          onSwitchProfile={vi.fn()}
          onRenameProfile={vi.fn()}
          onSetProfileIcon={vi.fn()}
          onDeleteProfile={vi.fn()}
          onProtected={vi.fn()}
        />,
      );
    });
  }

  it("opens protected-profile setup instead of creating a plain profile when protection is checked", async () => {
    show();
    typeInto(container.querySelector<HTMLInputElement>('input[placeholder^="New profile"]')!, "Jamie");
    act(() => container.querySelector<HTMLInputElement>("[data-protect-new-profile]")!.click());

    await act(async () => {
      container.querySelector<HTMLFormElement>("form")!.dispatchEvent(new Event("submit", { bubbles: true, cancelable: true }));
    });

    expect(document.body.querySelector("[data-protection-setup-dialog]")?.textContent).toBe("Jamie");
    expect(onCreateProfile).not.toHaveBeenCalled();
  });

  it("shows a lock indicator only beside password-protected profiles", () => {
    show([
      { id: "a", name: "Alex", is_active: true, icon_key: null, is_password_protected: false },
      { id: "b", name: "Blair", is_active: false, icon_key: null, is_password_protected: true },
    ]);

    const rows = [...container.querySelectorAll("tbody tr")];
    expect(rows[0].querySelector('[aria-label="Password protected"]')).toBeNull();
    expect(rows[1].querySelector('[aria-label="Password protected"]')).not.toBeNull();
  });
});

describe("Settings protected backup restore", () => {
  let container: HTMLDivElement;
  let root: Root;

  beforeEach(() => {
    container = document.createElement("div");
    document.body.append(container);
    root = createRoot(container);
  });

  afterEach(() => {
    act(() => root.unmount());
    container.remove();
  });

  it("asks for the selected encrypted backup's password before restoring", async () => {
    const onRestore = vi.fn();
    act(() => {
      root.render(
        <BackupsBlock
          backups={[{ filename: "old.db", created_at: "2026-09-21 10:00", size_bytes: 1024 }]}
          onCreateBackupNow={vi.fn()}
          onRestoreBackup={onRestore}
          isProtected
          copyDir={null}
          onSetCopyDir={vi.fn()}
          onBrowseCopyDir={vi.fn()}
        />,
      );
    });

    act(() => [...container.querySelectorAll("button")].find((button) => button.textContent === "Restore")!.click());
    act(() => [...container.querySelectorAll("button")].find((button) => button.textContent === "Restore")!.click());

    const password = document.body.querySelector<HTMLInputElement>('input[type="password"]');
    expect(password).not.toBeNull();
    typeInto(password!, "old password");
    await act(async () => {
      document.body.querySelector<HTMLButtonElement>("button.password-form-submit")!.click();
    });
    expect(onRestore).toHaveBeenCalledWith("old.db", "old password");
  });
});
