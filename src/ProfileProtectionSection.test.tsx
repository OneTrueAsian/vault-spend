// @vitest-environment jsdom
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import type { Profile } from "./types";

const protection = vi.hoisted(() => ({
  beginProtectionSetup: vi.fn(),
  commitProtectionSetup: vi.fn(),
  cancelProtectionSetup: vi.fn(),
  verifyCurrentPassword: vi.fn(),
  changePassword: vi.fn(),
  beginRegenerateRecovery: vi.fn(),
  commitRegenerateRecovery: vi.fn(),
  removeProtection: vi.fn(),
}));
vi.mock("./protection", () => protection);

const profileUiState = vi.hoisted(() => ({ getCurrentGeneration: vi.fn() }));
vi.mock("./profileUiState", () => profileUiState);

const autoLock = vi.hoisted(() => ({
  getAutoLockSettings: vi.fn(),
  setAutoLockSettings: vi.fn(),
}));
vi.mock("./autoLock", () => autoLock);

import { ProfileProtectionSection } from "./ProfileProtectionSection";
import { QuickSettingsContext } from "./SettingStar";
import { menuOptions, menuValue, pickMenuOption } from "./menuSelectTestUtils";

(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

function typeInto(input: HTMLInputElement, value: string) {
  const setValue = Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, "value")!.set!;
  act(() => {
    setValue.call(input, value);
    input.dispatchEvent(new Event("input", { bubbles: true }));
  });
}

const UNPROTECTED: Profile[] = [
  { id: "a", name: "Alex", is_active: true, icon_key: null, is_password_protected: false },
  { id: "b", name: "Blair", is_active: false, icon_key: null, is_password_protected: true },
];

const PROTECTED: Profile[] = [
  { id: "a", name: "Alex", is_active: true, icon_key: null, is_password_protected: true },
];

describe("ProfileProtectionSection", () => {
  let container: HTMLDivElement;
  let root: Root;
  const onProtected = vi.fn();

  beforeEach(() => {
    protection.beginProtectionSetup.mockReset();
    protection.commitProtectionSetup.mockReset();
    protection.cancelProtectionSetup.mockReset().mockResolvedValue(undefined);
    protection.verifyCurrentPassword.mockReset().mockResolvedValue(undefined);
    protection.changePassword.mockReset();
    protection.beginRegenerateRecovery.mockReset();
    protection.commitRegenerateRecovery.mockReset();
    protection.removeProtection.mockReset();
    profileUiState.getCurrentGeneration.mockReset().mockResolvedValue(1);
    autoLock.getAutoLockSettings.mockReset().mockResolvedValue({
      inactivity_minutes: 15,
      lock_when_hidden: true,
      lock_on_focus_loss: false,
      lock_on_system_event: true,
      system_event_supported: true,
    });
    autoLock.setAutoLockSettings.mockReset().mockResolvedValue(undefined);
    onProtected.mockReset();
    container = document.createElement("div");
    document.body.append(container);
    root = createRoot(container);
  });

  afterEach(() => {
    act(() => root.unmount());
    container.remove();
  });

  function show(profiles: Profile[]) {
    act(() => {
      root.render(<ProfileProtectionSection profiles={profiles} onProtected={onProtected} />);
    });
  }

  function button(name: string) {
    return [...document.body.querySelectorAll<HTMLButtonElement>("button")].find((b) => b.textContent === name)!;
  }

  it("keeps the protection actions directly under the status they act on, ahead of the automatic locking settings", () => {
    for (const [profiles, firstAction] of [[UNPROTECTED, "Turn on password protection"], [PROTECTED, "Change password"]] as const) {
      show(profiles);
      const card = container.querySelector<HTMLElement>('[data-setting-card="password-protection"]')!;
      const status = [...card.querySelectorAll("p")].find((p) => p.textContent?.startsWith("Password protection:"))!;
      const actions = button(firstAction).closest(".settings-actions")!;
      const locking = [...card.querySelectorAll("h2")].find((h) => h.textContent === "Automatic locking")!;
      const after = (a: Node, b: Node) => !!(a.compareDocumentPosition(b) & Node.DOCUMENT_POSITION_FOLLOWING);
      expect(after(status, actions)).toBe(true);
      expect(after(actions, locking)).toBe(true);
      // nothing but the status (and its explanation) sits between the status and its actions
      expect([...card.children].indexOf(actions) - [...card.children].indexOf(status)).toBeLessThanOrEqual(2);
      act(() => root.render(<div />));
    }
  });

  it('shows "Off" and a button to turn it on for an unprotected active profile', () => {
    show(UNPROTECTED);

    expect(container.textContent).toContain("Off");
    expect(button("Turn on password protection")).not.toBeUndefined();
  });

  it.each([
    ["an unprotected", UNPROTECTED],
    ["a protected", PROTECTED],
  ])("marks password protection as new with a plain, non-interactive label for %s profile", (_label, profile) => {
    show(profile);

    const badge = container.querySelector<HTMLElement>(".card-head .protection-new-badge");
    expect(badge).not.toBeNull();
    expect(badge!.textContent).toBe("New");
    expect(badge!.closest("button, a, [role='button']")).toBeNull();
    expect(badge!.getAttribute("tabindex")).toBeNull();
    expect(badge!.parentElement!.textContent).toBe("Password protection New");
  });

  it('shows "On" and offers password changes for a protected active profile', () => {
    show(PROTECTED);

    expect(container.textContent).toContain("On");
    expect([...container.querySelectorAll("button")].find((b) => b.textContent === "Turn on password protection")).toBeUndefined();
    expect(button("Change password")).not.toBeUndefined();
    expect(button("Regenerate recovery key")).not.toBeUndefined();
    expect(button("Remove protection")).not.toBeUndefined();
  });

  it("loads all automatic-lock choices and the documented defaults for a protected profile", async () => {
    show(PROTECTED);

    await act(async () => undefined);

    const select = container.querySelector<HTMLButtonElement>("[data-auto-lock-minutes]")!;
    expect(menuOptions(select).map((option) => option.value)).toEqual(["0", "1", "5", "15", "30", "60"]);
    expect(menuValue(select)).toBe("15");
    expect(container.querySelector<HTMLInputElement>("[data-lock-when-hidden]")!.checked).toBe(true);
    expect(container.querySelector<HTMLInputElement>("[data-lock-on-focus-loss]")!.checked).toBe(false);
    expect(container.querySelector<HTMLInputElement>("[data-lock-on-system-event]")!.checked).toBe(true);
  });

  it("saves a changed auto-lock setting with the current profile generation", async () => {
    show(PROTECTED);
    await act(async () => undefined);
    const select = container.querySelector<HTMLButtonElement>("[data-auto-lock-minutes]")!;

    pickMenuOption(select, "30");
    await act(async () => undefined);

    expect(autoLock.setAutoLockSettings).toHaveBeenCalledWith(
      expect.objectContaining({ inactivity_minutes: 30 }),
      1,
    );
  });

  it("explains that automatic locking requires protection and disables its controls", () => {
    show(UNPROTECTED);

    expect(container.textContent).toContain("Turn on password protection to use automatic locking");
    expect(container.querySelector<HTMLButtonElement>("[data-auto-lock-minutes]")!.disabled).toBe(true);
    expect(autoLock.getAutoLockSettings).not.toHaveBeenCalled();
  });

  it("opens the regenerate-recovery dialog with the current generation", async () => {
    show(PROTECTED);

    await act(async () => button("Regenerate recovery key").click());

    expect(document.body.textContent).toContain("Regenerate recovery key");
    expect(document.body.querySelector("#regenerate-recovery-current")).not.toBeNull();
    expect(profileUiState.getCurrentGeneration).toHaveBeenCalledTimes(1);
  });

  it("opens the change-password dialog with the current generation", async () => {
    show(PROTECTED);

    await act(async () => button("Change password").click());

    expect(document.body.textContent).toContain("Change password");
    expect(document.body.querySelector("#change-password-current")).not.toBeNull();
    expect(profileUiState.getCurrentGeneration).toHaveBeenCalledTimes(1);
  });

  it("says the original file and older backups stay unencrypted until they are deleted, before and after turning protection on", async () => {
    show(PROTECTED);
    expect(container.textContent).toContain("the original file and older backups made before protection are still unencrypted until you delete them below");
    act(() => root.unmount());
    root = createRoot(container);
    show(UNPROTECTED);
    await act(async () => {
      button("Turn on password protection").click();
    });
    expect(document.body.textContent).toContain("The original unencrypted file and older backups stay on this computer, readable by anyone who can open it, until you delete them from Settings");
  });

  it("clicking the button opens the setup dialog for the active profile", async () => {
    show(UNPROTECTED);

    await act(async () => {
      button("Turn on password protection").click();
    });

    expect(document.body.textContent).toContain("Protect this profile with a password");
  });

  it("completing setup calls onProtected and closes the dialog", async () => {
    protection.beginProtectionSetup.mockResolvedValue({
      token: "tok",
      recovery_display: "AAAA-BBBB-CCCC-DDDD-EEEE-FFFF-GGGG",
      challenge_group_indices: [0, 1],
    });
    protection.commitProtectionSetup.mockResolvedValue({ status: "open" });
    show(UNPROTECTED);
    await act(async () => {
      button("Turn on password protection").click();
    });
    typeInto(document.body.querySelector<HTMLInputElement>("#protection-setup-password")!, "eight ok chars");
    typeInto(document.body.querySelector<HTMLInputElement>("#protection-setup-confirm")!, "eight ok chars");
    await act(async () => {
      button("Continue").click();
    });
    act(() => {
      button("I've saved it").click();
    });
    typeInto(document.body.querySelector<HTMLInputElement>("#protection-setup-answer-0")!, "AAAA");
    typeInto(document.body.querySelector<HTMLInputElement>("#protection-setup-answer-1")!, "BBBB");

    await act(async () => {
      button("Finish").click();
    });

    expect(protection.commitProtectionSetup).toHaveBeenCalledWith("tok", ["AAAA", "BBBB"], "a", null);
    expect(onProtected).toHaveBeenCalledTimes(1);
    expect(document.body.textContent).not.toContain("Protect this profile with a password");
  });
});

describe("ProfileProtectionSection anchors", () => {
  let container: HTMLDivElement;
  let root: Root;
  beforeEach(() => {
    profileUiState.getCurrentGeneration.mockReset().mockResolvedValue(1);
    autoLock.getAutoLockSettings.mockReset().mockResolvedValue({ inactivity_minutes: 15, lock_when_hidden: true, lock_on_focus_loss: false, lock_on_system_event: true, system_event_supported: true });
    container = document.createElement("div");
    document.body.append(container);
    root = createRoot(container);
  });
  afterEach(() => {
    act(() => root.unmount());
    container.remove();
  });

  it("titles the card with an h2, anchors it as password-protection and offers a star", async () => {
    await act(async () => root.render(<QuickSettingsContext.Provider value={{ has: () => false, toggle: () => undefined }}><ProfileProtectionSection profiles={PROTECTED} onProtected={() => undefined} /></QuickSettingsContext.Provider>));
    const title = container.querySelector("h2.reports-section-title")!;
    expect((title.textContent ?? "").trim().startsWith("Password protection")).toBe(true);
    const star = container.querySelector<HTMLButtonElement>('[aria-label="Add Password protection to Quick settings"]');
    expect(star).not.toBeNull();
    expect(container.querySelector('[data-setting="password-protection"], [data-setting-card="password-protection"]')!.contains(star)).toBe(true);
  });

  it("anchors Automatic locking inside it with its own star", async () => {
    await act(async () => root.render(<QuickSettingsContext.Provider value={{ has: () => false, toggle: () => undefined }}><ProfileProtectionSection profiles={PROTECTED} onProtected={() => undefined} /></QuickSettingsContext.Provider>));
    const block = container.querySelector<HTMLElement>('[data-setting="automatic-locking"]')!;
    expect(block.hasAttribute("data-auto-lock-settings")).toBe(true);
    expect((block.textContent ?? "").trim().startsWith("Automatic locking")).toBe(true);
    expect(block.querySelector('[aria-label="Add Automatic locking to Quick settings"]')).not.toBeNull();
  });
});
