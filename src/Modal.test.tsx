// @vitest-environment jsdom
//
// Regression test for a bug that every other check in this repo is blind
// to: `<StrictMode>` (main.tsx) makes React deliberately double-invoke
// every effect in *development* only — mount, cleanup, mount again — to
// surface exactly this kind of non-idempotent effect. `cargo test`, the
// Vitest logic suites, and the e2e suite (which drives the *production*
// build via `tauri build`, where StrictMode never double-invokes) all
// pass regardless of this bug, which is why it shipped once already and
// only showed up for a real user running `tauri dev`. This test renders
// through an actual `<StrictMode>` root — the one thing that reproduces
// it — with a real focused trigger element beforehand, matching how a
// dialog actually opens in the app (a click on a button, e.g. "Add
// account", is what has focus the instant the dialog starts mounting).
// Without that pre-focused trigger, the bug doesn't reproduce here either:
// `previouslyFocusedRef` would capture `document.body`, and re-focusing
// an unfocusable `<body>` is a harmless no-op that masks the exact
// failure mode a real button reproduces.
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import React, { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { ChooseExistingDataSourceDialog, ConfirmInvertDialog, CsvExportWarningDialog, NewAccountDialog, UseExistingDataFileDialog } from "./Modal";

(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

describe("NewAccountDialog's autoFocus survives StrictMode's dev-only double-invoke", () => {
  let container: HTMLDivElement | null = null;
  let trigger: HTMLButtonElement | null = null;
  let root: Root | null = null;

  afterEach(() => {
    act(() => {
      root?.unmount();
    });
    container?.remove();
    trigger?.remove();
    container = null;
    trigger = null;
    root = null;
  });

  it("leaves the account-name field focused, not the panel, after the effect settles", async () => {
    trigger = document.createElement("button");
    trigger.textContent = "Add account";
    document.body.appendChild(trigger);
    trigger.focus();

    container = document.createElement("div");
    document.body.appendChild(container);
    root = createRoot(container);

    act(() => {
      root!.render(
        <React.StrictMode>
          <NewAccountDialog familyMembers={[]} onCancel={() => {}} onSubmit={() => {}} />
        </React.StrictMode>,
      );
    });

    // The bug this guards against involves a `setTimeout(0)`-deferred
    // restore-focus call — give it a chance to fire (or, on the fixed
    // version, to have already been cancelled) before asserting.
    await act(async () => {
      await new Promise((resolve) => setTimeout(resolve, 20));
    });

    const input = document.querySelector('input[placeholder*="Everyday Checking"]');
    expect(input).not.toBeNull();
    expect(document.activeElement).toBe(input);
  });
});

// Phase C, Task 4 (plan v2 §4.11): a password-protected profile's CSV export
// asks first, since CSV carries no encryption of its own. This checks the
// dialog's exact required wording and that Cancel/Export anyway each call
// back exactly once — App.tsx's own gating (only showing this dialog when
// the active profile is protected) is a one-line condition with no App.tsx
// test harness in this codebase to exercise it against, so that part is
// covered by driving the real app instead.
describe("CsvExportWarningDialog", () => {
  let container: HTMLDivElement;
  let root: Root;
  const onCancel = vi.fn();
  const onConfirm = vi.fn();

  beforeEach(() => {
    onCancel.mockReset();
    onConfirm.mockReset();
    container = document.createElement("div");
    document.body.append(container);
    root = createRoot(container);
    act(() => {
      root.render(<CsvExportWarningDialog onCancel={onCancel} onConfirm={onConfirm} />);
    });
  });

  afterEach(() => {
    act(() => root.unmount());
    container.remove();
  });

  it("states plainly that CSV is not protected", () => {
    expect(document.body.textContent).toContain(
      "CSV files are not password protected. Anyone who can open the exported file can read this data.",
    );
  });

  it("cancels without exporting", () => {
    const cancelButton = [...document.querySelectorAll("button")].find((b) => b.textContent === "Cancel");
    act(() => cancelButton!.click());
    expect(onCancel).toHaveBeenCalledTimes(1);
    expect(onConfirm).not.toHaveBeenCalled();
  });

  it("proceeds with the export on explicit confirmation", () => {
    const confirmButton = [...document.querySelectorAll("button")].find((b) => b.textContent === "Export anyway");
    act(() => confirmButton!.click());
    expect(onConfirm).toHaveBeenCalledTimes(1);
    expect(onCancel).not.toHaveBeenCalled();
  });
});

describe("ConfirmInvertDialog", () => {
  let container: HTMLDivElement;
  let root: Root;
  const onCancel = vi.fn();
  const onConfirm = vi.fn();
  const button = (label: string) => [...document.querySelectorAll("button")].find((b) => b.textContent?.trim() === label)!;
  const hint = () => document.querySelector("[data-import-sign-hint]")?.textContent ?? null;

  function show(props: Partial<React.ComponentProps<typeof ConfirmInvertDialog>> = {}) {
    act(() => {
      root.render(<ConfirmInvertDialog onCancel={onCancel} onConfirm={onConfirm} {...props} />);
    });
  }

  beforeEach(() => {
    onCancel.mockReset();
    onConfirm.mockReset();
    container = document.createElement("div");
    document.body.append(container);
    root = createRoot(container);
  });

  afterEach(() => {
    act(() => root.unmount());
    container.remove();
  });

  it("asks as before when there is nothing to suggest", () => {
    show({ accountName: "Checking", suggestion: { flip: null, reason: null } });
    expect(hint()).toBeNull();
    expect(button("Flip the signs").classList.contains("modal-secondary")).toBe(false);
    expect(button("Keep as-is").classList.contains("modal-secondary")).toBe(true);
  });

  it("preselects flipping when the last import into the account flipped, and says so", () => {
    show({ accountName: "Amex Blue", suggestion: { flip: true, reason: "remembered" } });
    expect(hint()).toBe("Last import into Amex Blue: flipped the signs.");
    expect(document.activeElement).toBe(button("Flip the signs"));
  });

  it("preselects keeping the signs when the last import kept them", () => {
    show({ accountName: "Capitol One", suggestion: { flip: false, reason: "remembered" } });
    expect(hint()).toBe("Last import into Capitol One: kept as-is.");
    expect(document.activeElement).toBe(button("Keep as-is"));
    expect(button("Keep as-is").classList.contains("modal-secondary")).toBe(false);
    expect(button("Flip the signs").classList.contains("modal-secondary")).toBe(true);
  });

  it("explains a suggestion to flip a credit card file that is mostly positive", () => {
    show({ accountName: "Amex Blue", suggestion: { flip: true, reason: "credit-positive" } });
    expect(hint()).toBe("Most amounts in this file are positive. For a credit card that usually means charges are shown as positive.");
    expect(document.activeElement).toBe(button("Flip the signs"));
  });

  it("still lets either answer be chosen, whatever is preselected", () => {
    show({ accountName: "Amex Blue", suggestion: { flip: true, reason: "remembered" } });
    act(() => button("Keep as-is").click());
    expect(onCancel).toHaveBeenCalledTimes(1);
    act(() => button("Flip the signs").click());
    expect(onConfirm).toHaveBeenCalledTimes(1);
  });
});

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
