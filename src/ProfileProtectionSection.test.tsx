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

  it('shows "Off" and a button to turn it on for an unprotected active profile', () => {
    show(UNPROTECTED);

    expect(container.textContent).toContain("Off");
    expect(button("Turn on password protection…")).not.toBeUndefined();
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
    expect([...container.querySelectorAll("button")].find((b) => b.textContent === "Turn on password protection…")).toBeUndefined();
    expect(button("Change password…")).not.toBeUndefined();
    expect(button("Regenerate recovery key…")).not.toBeUndefined();
    expect(button("Remove protection…")).not.toBeUndefined();
  });

  it("loads all automatic-lock choices and the documented defaults for a protected profile", async () => {
    show(PROTECTED);

    await act(async () => undefined);

    const select = container.querySelector<HTMLSelectElement>("[data-auto-lock-minutes]")!;
    expect([...select.options].map((option) => option.value)).toEqual(["0", "1", "5", "15", "30", "60"]);
    expect(select.value).toBe("15");
    expect(container.querySelector<HTMLInputElement>("[data-lock-when-hidden]")!.checked).toBe(true);
    expect(container.querySelector<HTMLInputElement>("[data-lock-on-focus-loss]")!.checked).toBe(false);
    expect(container.querySelector<HTMLInputElement>("[data-lock-on-system-event]")!.checked).toBe(true);
  });

  it("saves a changed auto-lock setting with the current profile generation", async () => {
    show(PROTECTED);
    await act(async () => undefined);
    const select = container.querySelector<HTMLSelectElement>("[data-auto-lock-minutes]")!;

    await act(async () => {
      select.value = "30";
      select.dispatchEvent(new Event("change", { bubbles: true }));
    });

    expect(autoLock.setAutoLockSettings).toHaveBeenCalledWith(
      expect.objectContaining({ inactivity_minutes: 30 }),
      1,
    );
  });

  it("explains that automatic locking requires protection and disables its controls", () => {
    show(UNPROTECTED);

    expect(container.textContent).toContain("Turn on password protection to use automatic locking");
    expect(container.querySelector<HTMLSelectElement>("[data-auto-lock-minutes]")!.disabled).toBe(true);
    expect(autoLock.getAutoLockSettings).not.toHaveBeenCalled();
  });

  it("opens the regenerate-recovery dialog with the current generation", async () => {
    show(PROTECTED);

    await act(async () => button("Regenerate recovery key…").click());

    expect(document.body.textContent).toContain("Regenerate recovery key");
    expect(document.body.querySelector("#regenerate-recovery-current")).not.toBeNull();
    expect(profileUiState.getCurrentGeneration).toHaveBeenCalledTimes(1);
  });

  it("opens the change-password dialog with the current generation", async () => {
    show(PROTECTED);

    await act(async () => button("Change password…").click());

    expect(document.body.textContent).toContain("Change password");
    expect(document.body.querySelector("#change-password-current")).not.toBeNull();
    expect(profileUiState.getCurrentGeneration).toHaveBeenCalledTimes(1);
  });

  it("clicking the button opens the setup dialog for the active profile", async () => {
    show(UNPROTECTED);

    await act(async () => {
      button("Turn on password protection…").click();
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
      button("Turn on password protection…").click();
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
