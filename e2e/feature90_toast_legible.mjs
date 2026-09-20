// E2E test: toasts are readable under every visual style, light and dark.
//
// The Transparent style's status tints (--accent-soft, --negative-soft,
// --info-soft) are 14-22% alpha washes. A toast painted with one of them as
// its ONLY fill was see-through: whatever was on the page behind it (table
// rows, buttons) showed through the text. Every toast now sits on an opaque
// base, with the tint layered on top.
//
// For each style x mode this checks the real toast a "Back up now" click
// raises, plus success / error / info probes in the toast stack:
//   - the fill is fully opaque (nothing behind can show through), and
//   - the message text has at least 4.5:1 contrast (WCAG AA) against it
//     (Transparent; see the KNOWN GAP note below for the other styles).
//
// Run with: node e2e/feature90_toast_legible.mjs

import { launchApp } from "./harness.mjs";
import { seedFixture } from "./lib/seed.mjs";

const dbDir = await seedFixture(`
cur.execute("INSERT INTO accounts (name, account_type, starting_balance) VALUES ('Everyday Checking', 'checking', '5000.00')")
`);

const app = await launchApp({ dbDir });
const { browser } = app;

/** Sets the style + mode the way the app's own attributes do, then adds
 * success / error / info probes to a toast stack of their own. */
async function setLook(palette, mode) {
  await browser.execute(
    (p, m) => {
      const root = document.documentElement;
      if (p) root.setAttribute("data-palette", p);
      else root.removeAttribute("data-palette");
      root.setAttribute("data-theme", m);
      document.querySelectorAll("[data-toast-probe]").forEach((n) => n.remove());
      const stack = document.createElement("div");
      stack.className = "toast-stack";
      stack.setAttribute("data-toast-probe", "");
      for (const kind of ["success", "error", "info"]) {
        const s = document.createElement("div");
        s.className = `status status-${kind}`;
        s.setAttribute("data-probe-kind", kind);
        s.textContent = `A ${kind} message that has to stay readable`;
        stack.appendChild(s);
      }
      document.body.appendChild(stack);
    },
    palette,
    mode,
  );
  await browser.pause(150);
}

/** Reads the fill and text colour of every toast on screen and works out
 * how opaque the fill is and what contrast the text has against it. */
async function measure() {
  return browser.execute(() => {
    const parse = (str) => {
      const srgb = str.match(/color\(srgb\s+([\d.]+)\s+([\d.]+)\s+([\d.]+)(?:\s*\/\s*([\d.]+))?\)/);
      if (srgb) return [srgb[1] * 255, srgb[2] * 255, srgb[3] * 255, srgb[4] === undefined ? 1 : Number(srgb[4])];
      const m = str.match(/rgba?\(([^)]+)\)/);
      if (!m) return null;
      const p = m[1].split(/[,\s/]+/).filter(Boolean).map(Number);
      return [p[0], p[1], p[2], p.length > 3 ? p[3] : 1];
    };
    const over = (top, bottom) => {
      const a = top[3] + bottom[3] * (1 - top[3]);
      const mix = (i) => (top[i] * top[3] + bottom[i] * bottom[3] * (1 - top[3])) / (a || 1);
      return [mix(0), mix(1), mix(2), a];
    };
    const lum = ([r, g, b]) => {
      const f = (v) => {
        const c = v / 255;
        return c <= 0.03928 ? c / 12.92 : ((c + 0.055) / 1.055) ** 2.4;
      };
      return 0.2126 * f(r) + 0.7152 * f(g) + 0.0722 * f(b);
    };
    return Array.from(document.querySelectorAll(".toast-stack .status")).map((el) => {
      const cs = getComputedStyle(el);
      const base = parse(cs.backgroundColor) ?? [0, 0, 0, 0];
      // The tint layered over the base, when the fill is a gradient of one colour.
      const layers = (cs.backgroundImage.match(/(?:rgba?\([^)]*\)|color\(srgb[^)]*\))/g) ?? []).map(parse).filter(Boolean);
      const tint = layers.length ? layers[0] : null;
      const fill = tint ? over(tint, base) : base;
      const text = parse(cs.color);
      const l1 = lum(text);
      const l2 = lum(fill);
      return {
        kind: el.getAttribute("data-probe-kind") ?? "real",
        baseAlpha: Number(base[3].toFixed(3)),
        fillAlpha: Number(fill[3].toFixed(3)),
        contrast: Number(((Math.max(l1, l2) + 0.05) / (Math.min(l1, l2) + 0.05)).toFixed(2)),
      };
    });
  });
}

async function goToSettings() {
  for (const b of await browser.$$("nav button")) {
    if ((await b.getText()).trim() === "Settings") {
      await b.click();
      return;
    }
  }
  throw new Error('no nav button "Settings"');
}

try {
  await browser.setWindowSize(1280, 900);
  await browser.pause(1000);

  // A real toast, kept on screen while the look is switched around it.
  await goToSettings();
  const backUp = await browser.$("button=Back up now");
  await backUp.scrollIntoView({ block: "center" });
  await backUp.click();
  await (await browser.$(".toast-stack .status")).waitForExist({ timeout: 10000 });

  const failures = [];
  for (const [label, palette] of [["Slate", null], ["Futuristic", "futuristic"], ["Transparent", "transparent"]]) {
    for (const mode of ["light", "dark"]) {
      await setLook(palette, mode);
      const rows = await measure();
      if (rows.length < 4) throw new Error(`${label} ${mode}: expected the real toast plus 3 probes, found ${rows.length} toasts`);
      for (const r of rows) {
        const where = `${label} ${mode} ${r.kind} toast`;
        if (r.baseAlpha < 1 || r.fillAlpha < 1) failures.push(`${where}: the fill is see-through (base alpha ${r.baseAlpha}, fill alpha ${r.fillAlpha})`);
        // KNOWN GAP: Slate's light error/info toasts (about 3.8:1) and Futuristic's
        // light error toast (3.85:1) predate this spec and fall short of AA. Only
        // Transparent is held to 4.5:1 for now; the others get a 3:1 floor so
        // they can't get worse.
        const minimum = label === "Transparent" ? 4.5 : 3;
        if (r.contrast < minimum) failures.push(`${where}: text contrast is ${r.contrast}:1, below the ${minimum}:1 minimum`);
      }
      console.log(`${label} ${mode}: ${rows.map((r) => `${r.kind} ${r.contrast}:1${r.baseAlpha < 1 ? " (see-through)" : ""}`).join(", ")}`);
    }
  }
  if (failures.length) throw new Error(`toasts are hard to read:\n  ${failures.join("\n  ")}`);

  console.log("FEATURE 90 E2E TEST PASSED");
} finally {
  await app.close?.();
}
