// @vitest-environment jsdom
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { act } from "react";
import { createRoot, type Root } from "react-dom/client";

const protection = vi.hoisted(() => ({
  verifyRecoveryCode: vi.fn(),
  beginRecovery: vi.fn(),
  commitRecovery: vi.fn(),
  cancelProtectionSetup: vi.fn(),
}));
vi.mock("./protection", () => protection);

import { RecoverProfileDialog } from "./RecoverProfileDialog";

(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

function typeInto(input: HTMLInputElement, value: string) {
  const setValue = Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, "value")!.set!;
  act(() => {
    setValue.call(input, value);
    input.dispatchEvent(new Event("input", { bubbles: true }));
  });
}

describe("RecoverProfileDialog", () => {
  let container: HTMLDivElement;
  let root: Root;
  const onDone = vi.fn();
  const onCancel = vi.fn();

  beforeEach(() => {
    protection.verifyRecoveryCode.mockReset().mockResolvedValue(undefined);
    protection.beginRecovery.mockReset().mockResolvedValue({
      token: "tok",
      recovery_display: "AAAA-BBBB-CCCC-DDDD-EEEE-FFFF-GGGG",
      challenge_group_indices: [0, 6],
    });
    protection.commitRecovery.mockReset().mockResolvedValue("AAAA-BBBB-CCCC-DDDD-EEEE-FFFF-GGGG");
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
    act(() => root.render(<RecoverProfileDialog profileId="a" expectedGeneration={4} onDone={onDone} onCancel={onCancel} />));
  }

  function field(id: string) {
    return document.body.querySelector<HTMLInputElement>(`#${id}`)!;
  }

  function button(name: string) {
    return [...document.body.querySelectorAll<HTMLButtonElement>("button")].find((item) => item.textContent === name)!;
  }

  it("a wrong recovery code shows an error and does not advance", async () => {
    protection.verifyRecoveryCode.mockRejectedValue("That recovery key didn't work.");
    show();
    typeInto(field("recover-profile-code"), "wrong-code");

    await act(async () => button("Continue").click());

    expect(document.body.textContent).toContain("That recovery key didn't work.");
    expect(document.body.querySelector("#recover-profile-new")).toBeNull();
  });

  it("commits the exact backend-verified recovery challenge after all four steps", async () => {
    show();
    typeInto(field("recover-profile-code"), "AAAA-BBBB-CCCC-DDDD-EEEE-FFFF-GGGG");
    await act(async () => button("Continue").click());
    typeInto(field("recover-profile-new"), "new password!!");
    typeInto(field("recover-profile-confirm"), "new password!!");
    await act(async () => button("Continue").click());
    act(() => button("I've saved it").click());
    typeInto(field("recover-profile-answer-0"), "AAAA");
    typeInto(field("recover-profile-answer-1"), "GGGG");
    await act(async () => button("Finish").click());

    expect(protection.verifyRecoveryCode).toHaveBeenCalledWith("a", "AAAA-BBBB-CCCC-DDDD-EEEE-FFFF-GGGG");
    expect(protection.beginRecovery).toHaveBeenCalledWith("a", "AAAA-BBBB-CCCC-DDDD-EEEE-FFFF-GGGG", "new password!!", 4);
    expect(protection.commitRecovery).toHaveBeenCalledWith("a", "AAAA-BBBB-CCCC-DDDD-EEEE-FFFF-GGGG", "tok", ["AAAA", "GGGG"]);
    expect(onDone).toHaveBeenCalledTimes(1);
  });
});
