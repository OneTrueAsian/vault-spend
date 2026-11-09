// @vitest-environment jsdom
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { PasswordForm } from "./PasswordForm";

(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

function typeInto(input: HTMLInputElement, value: string) {
  const setValue = Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, "value")!.set!;
  act(() => {
    setValue.call(input, value);
    input.dispatchEvent(new Event("input", { bubbles: true }));
  });
}

describe("PasswordForm", () => {
  let container: HTMLDivElement;
  let root: Root;
  const onSubmit = vi.fn();
  const onCancel = vi.fn();

  beforeEach(() => {
    onSubmit.mockReset();
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
    act(() => {
      root.render(<PasswordForm submitLabel="Unlock" onSubmit={onSubmit} onCancel={onCancel} />);
    });
  }

  function passwordField() {
    return container.querySelector<HTMLInputElement>("#password-form-field")!;
  }

  it("is labelled with autocomplete and starts with the submit button disabled", () => {
    show();

    expect(passwordField().getAttribute("autocomplete")).toBe("current-password");
    expect(container.querySelector<HTMLButtonElement>("button[type='submit']")!.disabled).toBe(true);
  });

  it("submitting calls onSubmit with the typed password", async () => {
    onSubmit.mockResolvedValue(undefined);
    show();
    typeInto(passwordField(), "correct horse battery staple");

    await act(async () => {
      container.querySelector<HTMLButtonElement>("button[type='submit']")!.click();
    });

    expect(onSubmit).toHaveBeenCalledWith("correct horse battery staple");
  });

  it("a rejected onSubmit shows the error tied to the field, clears it, and moves focus back once the field is enabled again", async () => {
    onSubmit.mockRejectedValue("That password didn't work.");
    show();
    typeInto(passwordField(), "wrong");

    await act(async () => {
      container.querySelector<HTMLButtonElement>("button[type='submit']")!.click();
    });

    const error = container.querySelector('[role="alert"]')!;
    expect(error.textContent).toBe("That password didn't work.");
    expect(passwordField().getAttribute("aria-describedby")).toBe(error.id);
    expect(passwordField().getAttribute("aria-invalid")).toBe("true");
    expect(passwordField().value).toBe("");
    expect(document.activeElement).toBe(passwordField());
  });

  it("a lockout error counts down live and clears once the wait is actually over", async () => {
    onSubmit.mockRejectedValue("Try again in 2 seconds.");
    show();
    typeInto(passwordField(), "wrong");

    await act(async () => {
      container.querySelector<HTMLButtonElement>("button[type='submit']")!.click();
    });

    const error = container.querySelector('[role="alert"]')!;
    expect(error.textContent).toBe("Try again in 2 seconds.");

    await act(async () => {
      await new Promise((resolve) => setTimeout(resolve, 1100));
    });
    expect(error.textContent).toBe("Try again in 1 seconds.");

    await act(async () => {
      await new Promise((resolve) => setTimeout(resolve, 1100));
    });
    expect(error.textContent).toBe("");
    expect(passwordField().getAttribute("aria-invalid")).toBe("false");
  }, 10000);

  it("Cancel calls onCancel without ever calling onSubmit", () => {
    show();

    act(() => {
      container.querySelector<HTMLButtonElement>("[data-password-form-cancel]")!.click();
    });

    expect(onCancel).toHaveBeenCalledTimes(1);
    expect(onSubmit).not.toHaveBeenCalled();
  });

  it("omitting onCancel renders no Cancel button", () => {
    act(() => {
      root.render(<PasswordForm submitLabel="Unlock" onSubmit={onSubmit} />);
    });

    expect(container.querySelector("[data-password-form-cancel]")).toBeNull();
  });
});
