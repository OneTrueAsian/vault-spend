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
import { afterEach, describe, expect, it } from "vitest";
import React, { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { NewAccountDialog } from "./Modal";

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
