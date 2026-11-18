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
import { NewAccountDialog } from "./NewAccountDialog";

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

// Adding an account with a name already in use overwrote that account (2026-10-02 QA, H1). The
// dialog now says so as the person types and won't submit; the backend refuses it as well.
describe("NewAccountDialog with a name already in use", () => {
  let container: HTMLDivElement;
  let root: Root;
  const onSubmit = vi.fn();

  beforeEach(() => {
    onSubmit.mockReset();
    container = document.createElement("div");
    document.body.appendChild(container);
    root = createRoot(container);
    act(() => {
      root.render(<NewAccountDialog familyMembers={[]} existingAccountNames={["Car Loan", "Everyday Checking"]} onCancel={() => {}} onSubmit={onSubmit} />);
    });
  });

  afterEach(() => {
    act(() => root.unmount());
    container.remove();
  });

  // the dialog renders into a portal on document.body
  const nameInput = () => document.querySelector<HTMLInputElement>('input[placeholder*="Everyday Checking"]')!;
  const type = (value: string) =>
    act(() => {
      Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, "value")!.set!.call(nameInput(), value);
      nameInput().dispatchEvent(new Event("input", { bubbles: true }));
    });
  const submit = () => act(() => nameInput().form!.dispatchEvent(new Event("submit", { bubbles: true, cancelable: true })));

  it("says the name is taken, ignoring case and spaces, and does not submit", () => {
    type("  car LOAN ");
    expect(nameInput().getAttribute("aria-invalid")).toBe("true");
    expect(document.body.textContent).toContain('You already have an account called "Car Loan"');
    submit();
    expect(onSubmit).not.toHaveBeenCalled();
  });

  it("submits a new name", () => {
    type("Car Loan 2");
    expect(nameInput().getAttribute("aria-invalid")).toBe("false");
    submit();
    expect(onSubmit).toHaveBeenCalledWith("Car Loan 2", "checking", null, null, null, null, null);
  });
});
