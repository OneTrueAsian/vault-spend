// @vitest-environment jsdom
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import type { Profile } from "./types";

const protection = vi.hoisted(() => ({
  beginProtectionSetup: vi.fn(),
  commitProtectionSetup: vi.fn(),
  cancelProtectionSetup: vi.fn(),
}));
vi.mock("./protection", () => protection);

const profileUiState = vi.hoisted(() => ({ getCurrentGeneration: vi.fn() }));
vi.mock("./profileUiState", () => profileUiState);

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
    profileUiState.getCurrentGeneration.mockReset().mockResolvedValue(1);
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

  it('shows "On" and no button for a protected active profile', () => {
    show(PROTECTED);

    expect(container.textContent).toContain("On");
    expect([...container.querySelectorAll("button")].find((b) => b.textContent === "Turn on password protection…")).toBeUndefined();
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
