// @vitest-environment jsdom
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { act } from "react";
import { createRoot, type Root } from "react-dom/client";

const invokeMock = vi.hoisted(() => vi.fn());
vi.mock("@tauri-apps/api/core", () => ({ invoke: invokeMock }));

import { EmptyRegistryScreen } from "./EmptyRegistryScreen";

(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

function typeInto(input: HTMLInputElement, value: string) {
  const setValue = Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, "value")!.set!;
  act(() => {
    setValue.call(input, value);
    input.dispatchEvent(new Event("input", { bubbles: true }));
  });
}

describe("EmptyRegistryScreen", () => {
  let container: HTMLDivElement;
  let root: Root;
  const onResolved = vi.fn();

  beforeEach(() => {
    invokeMock.mockReset();
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
      root.render(<EmptyRegistryScreen onResolved={onResolved} />);
    });
  }

  it("explains the state and offers a name field with Create disabled until one is typed", () => {
    show();

    expect(container.querySelector("h1")?.textContent).toMatch(/no profiles/i);
    const create = container.querySelector<HTMLButtonElement>("[data-create-profile]")!;
    expect(create.disabled).toBe(true);
  });

  it("creating calls the existing plain create_profile command and reports Open on success", async () => {
    invokeMock.mockResolvedValue("Default");
    show();
    typeInto(container.querySelector("input")!, "Default");

    await act(async () => {
      container.querySelector<HTMLButtonElement>("[data-create-profile]")!.click();
    });

    expect(invokeMock).toHaveBeenCalledWith("create_profile", { name: "Default" });
    expect(onResolved).toHaveBeenCalledWith({ status: "open" });
  });

  it("shows a duplicate-name or other backend error inline without leaving the screen", async () => {
    invokeMock.mockRejectedValue("A profile named 'Default' already exists.");
    show();
    typeInto(container.querySelector("input")!, "Default");

    await act(async () => {
      container.querySelector<HTMLButtonElement>("[data-create-profile]")!.click();
    });

    expect(container.querySelector('[role="alert"]')?.textContent).toContain("already exists");
    expect(onResolved).not.toHaveBeenCalled();
  });
});
