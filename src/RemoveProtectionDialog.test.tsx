// @vitest-environment jsdom
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { act } from "react";
import { createRoot, type Root } from "react-dom/client";

const protection = vi.hoisted(() => ({ verifyCurrentPassword: vi.fn(), removeProtection: vi.fn() }));
vi.mock("./protection", () => protection);
import { RemoveProtectionDialog } from "./RemoveProtectionDialog";

(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

function typeInto(input: HTMLInputElement, value: string) {
  const setValue = Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, "value")!.set!;
  act(() => { setValue.call(input, value); input.dispatchEvent(new Event("input", { bubbles: true })); });
}

describe("RemoveProtectionDialog", () => {
  let container: HTMLDivElement;
  let root: Root;
  const onDone = vi.fn();
  const onCancel = vi.fn();
  beforeEach(() => {
    protection.verifyCurrentPassword.mockReset().mockResolvedValue(undefined);
    protection.removeProtection.mockReset().mockResolvedValue(undefined);
    onDone.mockReset(); onCancel.mockReset();
    container = document.createElement("div"); document.body.append(container); root = createRoot(container);
  });
  afterEach(() => { act(() => root.unmount()); container.remove(); });
  const button = (name: string) => [...document.body.querySelectorAll<HTMLButtonElement>("button")].find((item) => item.textContent === name)!;

  it("verifies the password before showing the plaintext warning", async () => {
    act(() => root.render(<RemoveProtectionDialog expectedGeneration={9} onDone={onDone} onCancel={onCancel} />));
    typeInto(document.body.querySelector<HTMLInputElement>("#remove-protection-current")!, "current password");
    await act(async () => button("Continue").click());
    expect(protection.verifyCurrentPassword).toHaveBeenCalledWith("current password", 9);
    expect(document.body.textContent).toContain("future backups become readable");
  });

  it("removes protection only after explicit confirmation", async () => {
    act(() => root.render(<RemoveProtectionDialog expectedGeneration={9} onDone={onDone} onCancel={onCancel} />));
    typeInto(document.body.querySelector<HTMLInputElement>("#remove-protection-current")!, "current password");
    await act(async () => button("Continue").click());
    await act(async () => button("Remove protection").click());
    expect(protection.removeProtection).toHaveBeenCalledWith("current password", 9);
    expect(onDone).toHaveBeenCalledTimes(1);
  });
});
