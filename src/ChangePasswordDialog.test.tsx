// @vitest-environment jsdom
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { act } from "react";
import { createRoot, type Root } from "react-dom/client";

const protection = vi.hoisted(() => ({
  verifyCurrentPassword: vi.fn(),
  beginProtectionSetup: vi.fn(),
  changePassword: vi.fn(),
  cancelProtectionSetup: vi.fn(),
}));
vi.mock("./protection", () => protection);

import { ChangePasswordDialog } from "./ChangePasswordDialog";

(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

function typeInto(input: HTMLInputElement, value: string) {
  const setValue = Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, "value")!.set!;
  act(() => {
    setValue.call(input, value);
    input.dispatchEvent(new Event("input", { bubbles: true }));
  });
}

describe("ChangePasswordDialog", () => {
  let container: HTMLDivElement;
  let root: Root;
  const onDone = vi.fn();
  const onCancel = vi.fn();

  beforeEach(() => {
    protection.verifyCurrentPassword.mockReset().mockResolvedValue(undefined);
    protection.beginProtectionSetup.mockReset().mockResolvedValue({
      token: "tok",
      recovery_display: "AAAA-BBBB-CCCC-DDDD-EEEE-FFFF-GGGG",
      challenge_group_indices: [0, 6],
    });
    protection.changePassword.mockReset().mockResolvedValue("AAAA-BBBB-CCCC-DDDD-EEEE-FFFF-GGGG");
    protection.cancelProtectionSetup.mockReset().mockResolvedValue(undefined);
    onDone.mockReset();
    onCancel.mockReset();
    container = document.createElement("div");
    document.body.append(container);
    root = createRoot(container);
  });

  afterEach(() => {
    act(() => root.unmount());
    container.remove();
  });

  function show() {
    act(() => root.render(<ChangePasswordDialog expectedGeneration={4} onDone={onDone} onCancel={onCancel} />));
  }

  function field(id: string) {
    return document.body.querySelector<HTMLInputElement>(`#${id}`)!;
  }

  function button(name: string) {
    return [...document.body.querySelectorAll<HTMLButtonElement>("button")].find((item) => item.textContent === name)!;
  }

  it("a wrong current password shows an error and does not advance", async () => {
    protection.verifyCurrentPassword.mockRejectedValue("That password didn't work.");
    show();
    typeInto(field("change-password-current"), "wrong");

    await act(async () => button("Continue").click());

    expect(document.body.textContent).toContain("That password didn't work.");
    expect(document.body.querySelector("#change-password-new")).toBeNull();
  });

  it("commits the exact backend-verified recovery challenge after all four steps", async () => {
    show();
    typeInto(field("change-password-current"), "old password");
    await act(async () => button("Continue").click());
    typeInto(field("change-password-new"), "new password!!");
    typeInto(field("change-password-confirm"), "new password!!");
    await act(async () => button("Continue").click());
    expect(document.activeElement).toBe(button("I've saved it"));
    act(() => button("I've saved it").click());
    typeInto(field("change-password-answer-0"), "AAAA");
    typeInto(field("change-password-answer-1"), "GGGG");
    await act(async () => button("Finish").click());

    expect(protection.verifyCurrentPassword).toHaveBeenCalledWith("old password", 4);
    expect(protection.beginProtectionSetup).toHaveBeenCalledWith("new password!!", 4);
    expect(protection.changePassword).toHaveBeenCalledWith("old password", "tok", ["AAAA", "GGGG"]);
    expect(onDone).toHaveBeenCalledTimes(1);
  });
});
