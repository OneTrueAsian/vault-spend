// @vitest-environment jsdom
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { ChooseExistingDataSourceDialog } from "./ChooseExistingDataSourceDialog";
import { UseExistingDataFileDialog } from "./UseExistingDataFileDialog";

(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

describe("protected package import dialogs", () => {
  let container: HTMLDivElement;
  let root: Root;

  beforeEach(() => {
    container = document.createElement("div");
    document.body.append(container);
    root = createRoot(container);
  });

  afterEach(() => {
    act(() => root.unmount());
    container.remove();
  });

  it("lets the user choose a raw database or a protected package", () => {
    const onDatabase = vi.fn();
    const onPackage = vi.fn();
    act(() => root.render(<ChooseExistingDataSourceDialog onCancel={vi.fn()} onDatabase={onDatabase} onPackage={onPackage} />));
    expect(document.body.textContent).toContain("password-protected .vaultspend package");
    act(() => [...document.querySelectorAll("button")].find((button) => button.textContent?.startsWith("Protected package"))!.click());
    expect(onPackage).toHaveBeenCalledTimes(1);
    expect(onDatabase).not.toHaveBeenCalled();
  });

  it("requires a password when naming an imported protected package", () => {
    const onSubmit = vi.fn();
    act(() =>
      root.render(
        <UseExistingDataFileDialog path="C:\\Sam.vaultspend" isProtectedPackage onCancel={vi.fn()} onSubmit={onSubmit} />,
      ),
    );
    const inputs = document.body.querySelectorAll<HTMLInputElement>("input");
    expect(inputs).toHaveLength(2);
    expect(inputs[1].type).toBe("password");
    expect(document.body.textContent).toContain("copied into Vault Spend");
  });

  it("asks for a password for a bare encrypted database without claiming it will be copied", () => {
    const onSubmit = vi.fn();
    act(() =>
      root.render(
        <UseExistingDataFileDialog path="C:\\old.db" requiresPassword onCancel={vi.fn()} onSubmit={onSubmit} />,
      ),
    );
    const inputs = document.body.querySelectorAll<HTMLInputElement>("input");
    expect(inputs).toHaveLength(2);
    expect(inputs[1].type).toBe("password");
    expect(document.body.textContent).toContain("nothing is copied or moved");
    const submit = [...document.querySelectorAll("button")].find((b) => b.type === "submit")!;
    expect(submit.disabled).toBe(true);
    const setValue = Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, "value")!.set!;
    act(() => {
      setValue.call(inputs[0], "Old Laptop");
      inputs[0].dispatchEvent(new Event("input", { bubbles: true }));
      setValue.call(inputs[1], "secret");
      inputs[1].dispatchEvent(new Event("input", { bubbles: true }));
    });
    expect(submit.disabled).toBe(false);
    act(() => [...document.querySelectorAll("form")][0].dispatchEvent(new Event("submit", { bubbles: true, cancelable: true })));
    expect(onSubmit).toHaveBeenCalledWith("Old Laptop", "secret");
  });

  it("does not require a password for a plain, unprotected database", () => {
    const onSubmit = vi.fn();
    act(() =>
      root.render(<UseExistingDataFileDialog path="C:\\plain.db" onCancel={vi.fn()} onSubmit={onSubmit} />),
    );
    const inputs = document.body.querySelectorAll<HTMLInputElement>("input");
    expect(inputs).toHaveLength(1);
  });
});
