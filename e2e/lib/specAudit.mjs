// Which desktop specs touch something every window on the desktop shares (R2a): OS foreground and focus, menus that close on blur,
// the pointer, the keyboard, window state changes that take foreground, native clipboard. A spec (or a helper it imports) that does is
// exclusive. Resizing a spec's own window is not shared. This is a static scan: it can only add reasons to be exclusive, never prove
// a spec safe, so a spec listed as parallel-safe also needs the repeated parallel runs recorded in the measurement report.
import fs from "node:fs";
import path from "node:path";

const MARKERS = [
  [/reclaimWindowFocus|withFocusRetry|hasFocus\s*\(|activeElement/, "depends on which window has OS focus"],
  [/chooseMenuOption|pickFromMenu|menuOptionLabels|chooseRowAction|chooseStyle/, "drives menus that close when the window loses focus"],
  [/\.moveTo\(|moveToElement|hover|mouseover/i, "uses the shared pointer (hover)"],
  [/\.keys\(|sendKeys|performActions|\bactions\(|KeyboardEvent|dispatchKey/, "uses the shared keyboard"],
  [/maximizeWindow|minimizeWindow|fullscreenWindow|setWindowRect|switchToWindow|newWindow\(/, "changes window state, which can take OS foreground"],
  [/notepad|openFocusWindow|SetForegroundWindow|focusWindow/, "takes OS foreground with another window"],
  [/clipboard/, "uses the shared clipboard"],
  [/["']blur["']|\.blur\(|onblur/, "reacts to blur (the window losing focus)"],
];

export function sharedResourceReasons(source) {
  return MARKERS.filter(([pattern]) => pattern.test(source)).map(([, reason]) => reason);
}

const RELATIVE_IMPORT = /(?:import|export)[^"'`;]*?from\s*["'](\.{1,2}\/[^"']+)["']|import\s*["'](\.{1,2}\/[^"']+)["']|import\(\s*["'](\.{1,2}\/[^"']+)["']\s*\)/g;

/** Reasons a spec cannot run beside others, found in its own source and in every relative helper it imports (the shared harness only defines the helpers). */
export function auditSpec(file, seen = new Set()) {
  const resolved = path.resolve(file);
  if (seen.has(resolved)) return [];
  seen.add(resolved);
  let source;
  try { source = fs.readFileSync(resolved, "utf8"); } catch { return [`could not read ${path.basename(resolved)}, so it is not proven safe`]; }
  const label = seen.size === 1 ? "" : `${path.relative(path.dirname([...seen][0]), resolved)}: `;
  const reasons = sharedResourceReasons(source).map(reason => label + reason);
  for (const match of source.matchAll(RELATIVE_IMPORT)) {
    const target = path.resolve(path.dirname(resolved), match[1] ?? match[2] ?? match[3]);
    if (path.basename(target) === "harness.mjs") continue;
    reasons.push(...auditSpec(target, seen));
  }
  return reasons;
}

/** Every file a spec reaches through relative imports (not including the spec itself, and not following into the shared harness). */
export function transitiveImports(file, seen = new Set()) {
  const resolved = path.resolve(file);
  if (seen.has(resolved)) return seen;
  seen.add(resolved);
  let source = "";
  try { source = fs.readFileSync(resolved, "utf8"); } catch { return seen; }
  for (const match of source.matchAll(RELATIVE_IMPORT)) {
    const target = path.resolve(path.dirname(resolved), match[1] ?? match[2] ?? match[3]);
    transitiveImports(target, seen);
  }
  return seen;
}

export function discoverSpecs(e2eDir) {
  return ["smoke.mjs", ...fs.readdirSync(e2eDir).filter(name => /^feature\d+.*\.mjs$/.test(name)).sort((a, b) => Number(a.match(/\d+/)[0]) - Number(b.match(/\d+/)[0]) || (a < b ? -1 : 1))];
}
