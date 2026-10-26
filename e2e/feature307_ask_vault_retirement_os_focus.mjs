import assert from "node:assert/strict";
import fs from "node:fs";
import { launchApp, reclaimWindowFocus } from "./harness.mjs";
import { openFocusWindow } from "./lib/focusWindow.mjs";
import { askHelpers, seedRetirementProfile } from "./lib/askRetirement.mjs";

// M5 real OS focus acceptance: another window takes OS foreground (the page sees a real blur) and the app gets it back (a real focus); the open result then retires.
// Evidence class: REAL OS FOCUS, proven by the page's own blur and focus events. This spec deliberately takes OS foreground, so (like the focus/blur flows in
// e2e/README.md) it is only reliable on its own: run it with --concurrency=1, or alone with `npm run e2e -- --spec=feature307`.
const SHOTS = process.env.VS_M5_SHOTS;
const dbDir = await seedRetirementProfile();
const app = await launchApp({ dbDir });
const b = app.browser;
const h = askHelpers(b);
const evidence = {};
const shoot = async name => { if (SHOTS) { fs.mkdirSync(SHOTS, { recursive: true }); await b.saveScreenshot(`${SHOTS}/feature307-${name}.png`); } };

try {
  await h.openDashboard();
  await b.execute(() => { window.__m5Blur = 0; window.__m5Focus = 0; window.addEventListener("blur", () => window.__m5Blur++); window.addEventListener("focus", () => window.__m5Focus++); });

  await h.toResult();
  await h.bridgeWrite("set_investment_plan", await h.planArgs("M5 IRA", "9")); // unseen by the app's own code
  assert.ok((await h.text()).includes("Illustrative balance"), "nothing has revealed the change yet");
  const blurBefore = await b.execute(() => window.__m5Blur), focusBefore = await b.execute(() => window.__m5Focus);
  // A second visible window takes OS foreground, exactly how another application would. Under the parallel runner other specs' windows contend for foreground too, so
  // the app window first takes it back (otherwise there would be no blur to observe), and Windows may refuse a background process's request: up to three tries, then the
  // step is reported as BLOCKED, never as a pass.
  await reclaimWindowFocus(b);
  let tookForeground = false;
  for (let attempt = 1; attempt <= 3 && !tookForeground; attempt++) {
    const other = openFocusWindow(); // a window this spec owns; closed by its exact process id, never someone else's
    try {
      tookForeground = await b.waitUntil(async () => !(await b.execute(() => document.hasFocus())), { timeout: 8000, interval: 200 }).then(() => true, () => false);
    } finally { other.close(); }
    if (!tookForeground) await reclaimWindowFocus(b);
  }
  assert.ok(tookForeground, "REAL OS FOCUS BLOCKED: a second window never took OS foreground in three tries, so no blur occurred");
  await reclaimWindowFocus(b);
  await b.waitUntil(() => b.execute(() => document.hasFocus()), { timeout: 10000, timeoutMsg: "the app window did not regain OS focus" });
  const blurAfter = await b.execute(() => window.__m5Blur), focusAfter = await b.execute(() => window.__m5Focus);
  assert.ok(blurAfter > blurBefore && focusAfter > focusBefore, `the page saw a real blur and focus (blur ${blurBefore}->${blurAfter}, focus ${focusBefore}->${focusAfter})`);
  await h.waitText("Your details changed", "retired by a real focus change");
  await shoot("real-os-focus-stale");
  evidence.osFocus = `REAL: blur ${blurBefore}->${blurAfter}, focus ${focusBefore}->${focusAfter}; the open result retired on the real focus event`;
  await h.closeDialog();

  fs.writeFileSync(process.env.VS_M5_EVIDENCE_307 ?? `${process.env.TEMP ?? "."}/feature307-evidence.json`, JSON.stringify(evidence, null, 2));
  console.log("FEATURE 307 M5 REAL OS FOCUS PASSED");
  console.log(JSON.stringify(evidence));
} finally { await app.close(); }
