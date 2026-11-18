// A closing dialog gives focus back to the element that had it, one timer tick after the dialog is gone (Modal.tsx). The profile menu closes
// when focus lands outside it, so opening the menu in that gap loses it about a millisecond later (spec 286). This waits for the state the
// next step depends on, the element holding focus again, and does not click or retry anything.
export async function waitForFocusOn(b, selector, what) {
  await b.waitUntil(() => b.execute(sel => document.activeElement === document.querySelector(sel), selector),
    { timeout: 5000, timeoutMsg: `${what} should hold focus again before the next step` });
}
