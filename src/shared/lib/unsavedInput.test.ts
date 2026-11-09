// @vitest-environment jsdom
import { afterEach, describe, expect, it } from "vitest";
import { hasObservableUnsavedInput } from "./unsavedInput";

describe("hasObservableUnsavedInput", () => {
  afterEach(() => {
    document.body.innerHTML = "";
  });

  it("is false with nothing open or focused", () => {
    expect(hasObservableUnsavedInput()).toBe(false);
  });

  it("is true when a dialog is open", () => {
    document.body.innerHTML = '<div role="dialog"></div>';
    expect(hasObservableUnsavedInput()).toBe(true);
  });

  it("is true when a focused text input's value differs from its default", () => {
    document.body.innerHTML = '<input id="f" />';
    const input = document.getElementById("f") as HTMLInputElement;
    input.defaultValue = "";
    input.value = "typed";
    input.focus();
    expect(hasObservableUnsavedInput()).toBe(true);
  });

  it("is false when the focused input still holds its default value", () => {
    document.body.innerHTML = '<input id="f" />';
    const input = document.getElementById("f") as HTMLInputElement;
    input.defaultValue = "same";
    input.value = "same";
    input.focus();
    expect(hasObservableUnsavedInput()).toBe(false);
  });
});
