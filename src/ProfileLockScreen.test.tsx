// @vitest-environment jsdom
//
// PasswordForm's own test file covers the shared field/error/focus behavior; this file only tests
// what's unique to this screen — the heading, wiring the form to unlockProfile, and Switch profile.
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { act } from "react";
import { createRoot, type Root } from "react-dom/client";

const protection = vi.hoisted(() => ({ unlockProfile: vi.fn(), showProfileSelector: vi.fn() }));
vi.mock("./protection", () => protection);

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
});
