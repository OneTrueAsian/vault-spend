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
import { DEFAULT_APPEARANCE_PREFS, type AppearancePrefs } from "./themeBootstrap";

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

  function show(
    onSetThemeStyle = vi.fn(),
    themeStyle: Parameters<typeof AppearanceSection>[0]["themeStyle"] = "transparent",
    appearance: AppearancePrefs = DEFAULT_APPEARANCE_PREFS,
    onSetAppearance = vi.fn(),
  ) {
    act(() => {
      root.render(
        <AppearanceSection
          themeStyle={themeStyle}
          onSetThemeStyle={onSetThemeStyle}
          appearance={appearance}
          onSetAppearance={onSetAppearance}
        />,
      );
    });
    return onSetThemeStyle;
  }

  function futuristicOptions() {
    return container.querySelector<HTMLElement>("[data-futuristic-options]");
  }

  describe("Futuristic options", () => {
    const prefs: AppearancePrefs = { accent: "cyan", intensity: 70, reduceMotion: false };

    it("appear only while Futuristic is the chosen style", () => {
      show(vi.fn(), "transparent");
      expect(futuristicOptions()).toBeNull();
      show(vi.fn(), "retro");
      expect(futuristicOptions()).toBeNull();
      show(vi.fn(), "futuristic");
      expect(futuristicOptions()).not.toBeNull();
    });

    it("offer three named accent colors, with the saved one checked and marked", () => {
      show(vi.fn(), "futuristic", { ...prefs, accent: "violet" });
      const group = futuristicOptions()!.querySelector('[role="radiogroup"][aria-label="Accent color"]')!;
      const options = Array.from(group.querySelectorAll<HTMLInputElement>("input[type=radio]"));
      expect(options.map((o) => o.closest("label")!.textContent!.trim())).toEqual(["Ion Cyan", "Rebel Pink", "Ultraviolet"]);
      const checked = options.filter((o) => o.checked);
      expect(checked).toHaveLength(1);
      expect(checked[0].closest("label")!.textContent).toContain("Ultraviolet");
      expect(checked[0].closest("label")!.querySelector("[data-accent-check]")).not.toBeNull();
      expect(options[0].closest("label")!.querySelector("[data-accent-check]")).toBeNull();
    });

    it("change only the accent when another one is picked", () => {
      const onSetAppearance = vi.fn();
      show(vi.fn(), "futuristic", { accent: "cyan", intensity: 40, reduceMotion: true }, onSetAppearance);
      const pink = Array.from(futuristicOptions()!.querySelectorAll("label")).find((l) => l.textContent?.includes("Rebel Pink"))!;
      act(() => {
        pink.querySelector("input")!.click();
      });
      expect(onSetAppearance).toHaveBeenCalledWith({ accent: "pink", intensity: 40, reduceMotion: true });
    });

    it("show the glow strength as a 0-100 slider and change only that", () => {
      const onSetAppearance = vi.fn();
      show(vi.fn(), "futuristic", prefs, onSetAppearance);
      const slider = futuristicOptions()!.querySelector<HTMLInputElement>('input[type=range][aria-label="Neon intensity"]')!;
      expect(slider.min).toBe("0");
      expect(slider.max).toBe("100");
      expect(slider.value).toBe("70");
      expect(futuristicOptions()!.textContent).toContain("70%");
      typeInto(slider, "30");
      expect(onSetAppearance).toHaveBeenLastCalledWith({ ...prefs, intensity: 30 });
    });

    it("reset puts back Ion Cyan, glow 70 and normal motion", () => {
      const onSetAppearance = vi.fn();
      show(vi.fn(), "futuristic", { accent: "pink", intensity: 5, reduceMotion: true }, onSetAppearance);
      const reset = Array.from(futuristicOptions()!.querySelectorAll("button")).find((b) => /reset/i.test(b.textContent ?? ""))!;
      act(() => {
        reset.click();
      });
      expect(onSetAppearance).toHaveBeenCalledWith(DEFAULT_APPEARANCE_PREFS);
    });
  });

  it("offers Reduce motion with every style", () => {
    for (const style of ["transparent", "futuristic", "retro"] as const) {
      const onSetAppearance = vi.fn();
      show(vi.fn(), style, DEFAULT_APPEARANCE_PREFS, onSetAppearance);
      const box = container.querySelector<HTMLInputElement>("input[type=checkbox][data-reduce-motion]");
      expect(box, style).not.toBeNull();
      expect(box!.checked).toBe(false);
      act(() => {
        box!.click();
      });
      expect(onSetAppearance, style).toHaveBeenCalledWith({ ...DEFAULT_APPEARANCE_PREFS, reduceMotion: true });
    }
  });

  function optionLabels() {
    return Array.from(container.querySelectorAll('[role="radiogroup"][aria-label="Theme"] .feature-toggle-label')).map((el) => el.textContent);
  }

  it("offers Default, Futuristic and Retro, and no longer Slate", () => {
    show();
    expect(optionLabels()).toEqual(["Default", "Futuristic", "Retro"]);
  });

  it("calls the frosted-glass look Default and stores it under its existing id", () => {
    const onSet = show(vi.fn(), "retro");
    const row = Array.from(container.querySelectorAll(".feature-toggle-row")).find((r) => r.textContent?.startsWith("Default"))!;
    act(() => {
      (row.querySelector("input") as HTMLInputElement).click();
    });
    expect(onSet).toHaveBeenCalledWith("transparent");
  });

  it("checks Default when the saved style is the frosted-glass one", () => {
    show(vi.fn(), "transparent");
    const checked = Array.from(container.querySelectorAll<HTMLInputElement>("input[type=radio]")).filter((i) => i.checked);
    expect(checked[0].closest(".feature-toggle-row")?.textContent).toContain("Default");
  });

  it("describes Futuristic by its look and its options, not by font names", () => {
    show();
    const row = Array.from(container.querySelectorAll(".feature-toggle-row")).find((r) => r.textContent?.startsWith("Futuristic"))!;
    expect(row.textContent).not.toMatch(/orbitron|rajdhani|share tech/i);
    expect(row.textContent).toMatch(/accent/i);
  });

  it("describes Retro without naming Microsoft or Windows", () => {
    show();
    const row = Array.from(container.querySelectorAll(".feature-toggle-row")).find((r) => r.textContent?.includes("Retro"))!;
    expect(row.textContent).not.toMatch(/microsoft|windows/i);
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
