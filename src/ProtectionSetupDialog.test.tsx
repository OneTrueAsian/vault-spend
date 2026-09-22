// @vitest-environment jsdom
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { act } from "react";
import { createRoot, type Root } from "react-dom/client";

const protection = vi.hoisted(() => ({
  beginProtectionSetup: vi.fn(),
  commitProtectionSetup: vi.fn(),
  cancelProtectionSetup: vi.fn(),
}));
vi.mock("./protection", () => protection);

import { ProtectionSetupDialog } from "./ProtectionSetupDialog";

(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

function typeInto(input: HTMLInputElement, value: string) {
  const setValue = Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, "value")!.set!;
  act(() => {
    setValue.call(input, value);
    input.dispatchEvent(new Event("input", { bubbles: true }));
  });
}

describe("ProtectionSetupDialog", () => {
  let container: HTMLDivElement;
  let root: Root;
  const onDone = vi.fn();
  const onCancel = vi.fn();

  beforeEach(() => {
    protection.beginProtectionSetup.mockReset();
    protection.commitProtectionSetup.mockReset();
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

  function show(targetProfileId: string | null = "a", newProfileName: string | null = null) {
    act(() => {
      root.render(
        <ProtectionSetupDialog
          targetProfileId={targetProfileId}
          newProfileName={newProfileName}
          expectedGeneration={1}
          onDone={onDone}
          onCancel={onCancel}
        />,
      );
    });
  }

  // ModalShell renders through a portal into document.body, not into `container`.
  function field(id: string) {
    return document.body.querySelector<HTMLInputElement>(`#${id}`)!;
  }

  function button(name: string) {
    return [...document.body.querySelectorAll<HTMLButtonElement>("button")].find((b) => b.textContent === name)!;
  }

  it("Continue is disabled under 8 characters or when the confirmation does not match", () => {
    show();

    typeInto(field("protection-setup-password"), "short");
    expect(button("Continue").disabled).toBe(true);

    typeInto(field("protection-setup-password"), "eight ok!");
    typeInto(field("protection-setup-confirm"), "different");
    expect(button("Continue").disabled).toBe(true);
  });

  it("shows the recovery code once the password step completes, then asks for exactly the two challenged groups", async () => {
    protection.beginProtectionSetup.mockResolvedValue({
      token: "tok",
      recovery_display: "AAAA-BBBB-CCCC-DDDD-EEEE-FFFF-GGGG",
      challenge_group_indices: [1, 4],
    });
    show();
    typeInto(field("protection-setup-password"), "eight ok chars");
    typeInto(field("protection-setup-confirm"), "eight ok chars");

    await act(async () => {
      button("Continue").click();
    });

    expect(document.body.textContent).toContain("AAAA-BBBB-CCCC-DDDD-EEEE-FFFF-GGGG");
    act(() => {
      button("I've saved it").click();
    });
    expect(field("protection-setup-answer-0")).not.toBeNull();
    expect(document.body.querySelector("label[for='protection-setup-answer-0']")!.textContent).toBe("Group 2");
    expect(document.body.querySelector("label[for='protection-setup-answer-1']")!.textContent).toBe("Group 5");
  });

  it("submitting the two answers calls commitProtectionSetup and reports the result", async () => {
    protection.beginProtectionSetup.mockResolvedValue({
      token: "tok",
      recovery_display: "AAAA-BBBB-CCCC-DDDD-EEEE-FFFF-GGGG",
      challenge_group_indices: [0, 6],
    });
    protection.commitProtectionSetup.mockResolvedValue({ status: "open" });
    show("a", null);
    typeInto(field("protection-setup-password"), "eight ok chars");
    typeInto(field("protection-setup-confirm"), "eight ok chars");
    await act(async () => {
      button("Continue").click();
    });
    act(() => {
      button("I've saved it").click();
    });
    typeInto(field("protection-setup-answer-0"), "AAAA");
    typeInto(field("protection-setup-answer-1"), "GGGG");

    await act(async () => {
      button("Finish").click();
    });

    expect(onDone).toHaveBeenCalledWith({ status: "open" });
    expect(protection.commitProtectionSetup).toHaveBeenCalledWith("tok", ["AAAA", "GGGG"], "a", null);
  });

  it("Cancel from the recovery step tells the backend to drop the pending setup", async () => {
    protection.beginProtectionSetup.mockResolvedValue({
      token: "tok",
      recovery_display: "AAAA-BBBB-CCCC-DDDD-EEEE-FFFF-GGGG",
      challenge_group_indices: [0, 1],
    });
    show();
    typeInto(field("protection-setup-password"), "eight ok chars");
    typeInto(field("protection-setup-confirm"), "eight ok chars");
    await act(async () => {
      button("Continue").click();
    });

    await act(async () => {
      button("Cancel").click();
    });

    expect(protection.cancelProtectionSetup).toHaveBeenCalledWith("tok");
    expect(onCancel).toHaveBeenCalled();
  });
});
