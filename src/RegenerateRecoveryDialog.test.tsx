// @vitest-environment jsdom
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { act } from "react";
import { createRoot, type Root } from "react-dom/client";

const protection = vi.hoisted(() => ({
  beginRegenerateRecovery: vi.fn(),
  commitRegenerateRecovery: vi.fn(),
  cancelProtectionSetup: vi.fn(),
}));
vi.mock("./protection", () => protection);

import { RegenerateRecoveryDialog } from "./RegenerateRecoveryDialog";

(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

function typeInto(input: HTMLInputElement, value: string) {
  const setValue = Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, "value")!.set!;
  act(() => {
    setValue.call(input, value);
    input.dispatchEvent(new Event("input", { bubbles: true }));
  });
}

describe("RegenerateRecoveryDialog", () => {
  let container: HTMLDivElement;
  let root: Root;
  const onDone = vi.fn();
  const onCancel = vi.fn();

  beforeEach(() => {
    protection.beginRegenerateRecovery.mockReset().mockResolvedValue({
      token: "tok",
      recovery_display: "AAAA-BBBB-CCCC-DDDD-EEEE-FFFF-GGGG",
      challenge_group_indices: [1, 5],
    });
    protection.commitRegenerateRecovery.mockReset().mockResolvedValue("AAAA-BBBB-CCCC-DDDD-EEEE-FFFF-GGGG");
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
    act(() => root.render(<RegenerateRecoveryDialog expectedGeneration={7} onDone={onDone} onCancel={onCancel} />));
  }

  function field(id: string) {
    return document.body.querySelector<HTMLInputElement>(`#${id}`)!;
  }

  function button(name: string) {
    return [...document.body.querySelectorAll<HTMLButtonElement>("button")].find((item) => item.textContent === name)!;
  }

  it("shows a wrong-password error without revealing a recovery key", async () => {
    protection.beginRegenerateRecovery.mockRejectedValue("That password didn't work.");
    show();
    typeInto(field("regenerate-recovery-current"), "wrong");

    await act(async () => button("Continue").click());

    expect(document.body.textContent).toContain("That password didn't work.");
    expect(document.body.querySelector(".protection-setup-key")).toBeNull();
  });

  it("commits the exact recovery key after the save-confirmation challenge", async () => {
    show();
    typeInto(field("regenerate-recovery-current"), "old password");
    await act(async () => button("Continue").click());
    expect(document.body.textContent).toContain("AAAA-BBBB-CCCC-DDDD-EEEE-FFFF-GGGG");
    expect(document.activeElement).toBe(button("I've saved it"));
    act(() => button("I've saved it").click());
    typeInto(field("regenerate-recovery-answer-0"), "BBBB");
    typeInto(field("regenerate-recovery-answer-1"), "FFFF");
    await act(async () => button("Finish").click());

    expect(protection.beginRegenerateRecovery).toHaveBeenCalledWith("old password", 7);
    expect(protection.commitRegenerateRecovery).toHaveBeenCalledWith("tok", ["BBBB", "FFFF"]);
    expect(onDone).toHaveBeenCalledTimes(1);
  });
});
