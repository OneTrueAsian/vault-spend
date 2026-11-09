// Whether a mouse button, pen or finger is currently pressed anywhere in the window. A field that explains a
// mistake when it is left must not add that line while a press is under way: the press that left the field
// often lands on a Save button below it, and a button that moves between press and release loses the click.
let pressed = false;
let waiting: Array<() => void> = [];

function release() {
  pressed = false;
  const run = waiting;
  waiting = [];
  // After the click that follows the release has been delivered.
  if (run.length) setTimeout(() => run.forEach((f) => f()), 0);
}

if (typeof document !== "undefined") {
  document.addEventListener("pointerdown", () => { pressed = true; }, true);
  document.addEventListener("pointerup", release, true);
  document.addEventListener("pointercancel", release, true);
  document.addEventListener("dragend", release, true);
  window.addEventListener("blur", release);
}

/** Runs `action` now, or right after the current press ends. Returns a function that cancels it. */
export function afterPress(action: () => void): () => void {
  if (!pressed) {
    action();
    return () => {};
  }
  let live = true;
  const wrapped = () => { if (live) action(); };
  waiting.push(wrapped);
  return () => { live = false; };
}
