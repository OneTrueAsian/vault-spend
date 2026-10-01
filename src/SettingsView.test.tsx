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

import { AppearanceSection, BackupsBlock, ProfilesSection } from "./SettingsView";

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

describe("Settings AppearanceSection", () => {
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

  function show(onSetThemeStyle = vi.fn(), themeStyle: Parameters<typeof AppearanceSection>[0]["themeStyle"] = "classic") {
    act(() => {
      root.render(<AppearanceSection themeStyle={themeStyle} onSetThemeStyle={onSetThemeStyle} />);
    });
    return onSetThemeStyle;
  }

  function optionLabels() {
    return Array.from(container.querySelectorAll(".feature-toggle-label")).map((el) => el.textContent);
  }

  it("offers Retro as a fourth style after the three existing ones", () => {
    show();
    expect(optionLabels()).toEqual(["Slate", "Futuristic", "Transparent", "Retro"]);
  });

  it("describes Retro as a classic light look with a modern dark adaptation", () => {
    show();
    const row = Array.from(container.querySelectorAll(".feature-toggle-row")).find((r) => r.textContent?.includes("Retro"))!;
    expect(row.textContent).toMatch(/gray/i);
    expect(row.textContent).toMatch(/dark/i);
  });

  it("selects the retro style id when the option is chosen", () => {
    const onSet = show();
    const row = Array.from(container.querySelectorAll(".feature-toggle-row")).find((r) => r.textContent?.includes("Retro"))!;
    act(() => {
      (row.querySelector("input") as HTMLInputElement).click();
    });
    expect(onSet).toHaveBeenCalledWith("retro");
  });

  it("checks the Retro option when it is the saved style", () => {
    show(vi.fn(), "retro");
    const checked = Array.from(container.querySelectorAll<HTMLInputElement>("input[type=radio]")).filter((i) => i.checked);
    expect(checked).toHaveLength(1);
    expect(checked[0].closest(".feature-toggle-row")?.textContent).toContain("Retro");
  });
});
