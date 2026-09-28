// @vitest-environment jsdom
//
// PasswordForm's own test file covers the shared field/error/focus behavior; this file only tests
// what's unique to this screen — the heading, wiring the form to unlockProfile, and Switch profile.
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { act } from "react";
import { createRoot, type Root } from "react-dom/client";

const protection = vi.hoisted(() => ({ unlockProfile: vi.fn(), showProfileSelector: vi.fn() }));
vi.mock("./protection", () => protection);
const profileUiState = vi.hoisted(() => ({ getCurrentGeneration: vi.fn() }));
vi.mock("./profileUiState", () => profileUiState);
const invokeMock = vi.hoisted(() => vi.fn());
vi.mock("@tauri-apps/api/core", () => ({ invoke: invokeMock }));
vi.mock("./RecoverProfileDialog", () => ({
  RecoverProfileDialog: ({ profileId, expectedGeneration }: { profileId: string; expectedGeneration: number }) => (
    <div data-recover-profile-dialog>
      {profileId}:{expectedGeneration}
    </div>
  ),
}));

import { ProfileLockScreen } from "./ProfileLockScreen";

(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

function typeInto(input: HTMLInputElement, value: string) {
  const setValue = Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, "value")!.set!;
  act(() => {
    setValue.call(input, value);
    input.dispatchEvent(new Event("input", { bubbles: true }));
  });
}

describe("ProfileLockScreen", () => {
  let container: HTMLDivElement;
  let root: Root;
  const onResolved = vi.fn();

  beforeEach(() => {
    protection.unlockProfile.mockReset();
    protection.showProfileSelector.mockReset();
    profileUiState.getCurrentGeneration.mockReset().mockResolvedValue(4);
    invokeMock.mockReset().mockResolvedValue(undefined);
    onResolved.mockReset();
    container = document.createElement("div");
    document.body.append(container);
    root = createRoot(container);
  });

  afterEach(() => {
    act(() => root.unmount());
    container.remove();
  });

  function show() {
    act(() => {
      root.render(<ProfileLockScreen profileId="a" profileName="Alex" onResolved={onResolved} />);
    });
  }

  it("focuses the heading on mount, naming the locked profile", () => {
    show();

    const heading = container.querySelector("h1")!;
    expect(heading.textContent).toContain("Alex");
    expect(document.activeElement).toBe(heading);
  });

  it("submitting the form calls unlockProfile with this profile's id and reports the result", async () => {
    protection.unlockProfile.mockResolvedValue({ status: "open" });
    show();
    typeInto(container.querySelector<HTMLInputElement>("#password-form-field")!, "correct horse battery staple");

    await act(async () => {
      container.querySelector<HTMLButtonElement>("button[type='submit']")!.click();
    });

    expect(protection.unlockProfile).toHaveBeenCalledWith("a", "correct horse battery staple");
    expect(onResolved).toHaveBeenCalledWith({ status: "open" });
  });

  it("Switch profile calls showProfileSelector without ever calling unlockProfile", async () => {
    protection.showProfileSelector.mockResolvedValue({ status: "selector", profiles: [], last_used_id: null });
    show();

    await act(async () => {
      container.querySelector<HTMLButtonElement>("[data-switch-profile]")!.click();
    });

    expect(onResolved).toHaveBeenCalledWith({ status: "selector", profiles: [], last_used_id: null });
    expect(protection.unlockProfile).not.toHaveBeenCalled();
  });

  it("Forgot your password? fetches the current generation and opens RecoverProfileDialog for this profile", async () => {
    show();

    await act(async () => {
      container.querySelector<HTMLButtonElement>("[data-forgot-password]")!.click();
    });

    expect(profileUiState.getCurrentGeneration).toHaveBeenCalledTimes(1);
    expect(document.body.querySelector("[data-recover-profile-dialog]")!.textContent).toBe("a:4");
  });

  it("the remove-from-list escape needs a second click, names the profile, then deletes it and shows the selector", async () => {
    protection.showProfileSelector.mockResolvedValue({ status: "selector", profiles: [], last_used_id: null });
    show();

    act(() => {
      container.querySelector<HTMLButtonElement>("[data-forgot-remove-profile]")!.click();
    });

    expect(document.body.textContent).toContain("Alex");
    expect(invokeMock).not.toHaveBeenCalled();

    await act(async () => {
      container.querySelector<HTMLButtonElement>("[data-confirm-remove-profile]")!.click();
    });

    expect(invokeMock).toHaveBeenCalledWith("delete_profile", { id: "a" });
    expect(protection.showProfileSelector).toHaveBeenCalledTimes(1);
    expect(onResolved).toHaveBeenCalledWith({ status: "selector", profiles: [], last_used_id: null });
  });

  it("cancelling the remove-from-list confirmation deletes nothing", async () => {
    show();
    act(() => {
      container.querySelector<HTMLButtonElement>("[data-forgot-remove-profile]")!.click();
    });

    act(() => {
      container.querySelector<HTMLButtonElement>("[data-cancel-remove-profile]")!.click();
    });

    expect(invokeMock).not.toHaveBeenCalled();
    expect(container.querySelector("[data-confirm-remove-profile]")).toBeNull();
  });
});
