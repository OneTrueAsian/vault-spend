import fs from "node:fs";
import { createRequire } from "node:module";

const require = createRequire(import.meta.url);
const SOURCE = fs.readFileSync(require.resolve("axe-core/axe.min.js"), "utf8");
const VERSION = JSON.parse(fs.readFileSync(require.resolve("axe-core/package.json"), "utf8")).version;

/** Opt-in wall time for real operations, including awaited IPC. "returned" is not an assertion-pass verdict. */
export async function measurePhase(phase, action, { enabled = process.env.VAULTSPEND_E2E_PHASES === "1", now = () => performance.now(), write = text => console.error(`[efficiency-stage] ${text}`) } = {}) {
  if (!enabled) return action();
  const start = now(); let outcome = "returned";
  try { return await action(); }
  catch (error) { outcome = "threw"; throw error; }
  finally {
    try { write(JSON.stringify({ phase, durationMs: now() - start, outcome })); }
    catch (error) { if (outcome === "returned") throw error; console.error(`Stage reporting also failed: ${error.message}`); }
  }
}

/** Reuse only our own unchanged Axe instance in this document. Callers still run every inspection and its original rules. */
export async function ensureAxe(browser, { source = SOURCE, version = VERSION, reuse = process.env.VAULTSPEND_AXE_REUSE !== "0" } = {}) {
  // Explicit measurement baseline: identical to the prior matrix's injection on every inspection. No accessibility run is skipped.
  if (!reuse) { await browser.execute(source); return; }
  const ready = await browser.execute(expected => {
    const own = window.__vaultspendE2EAxeDocument;
    return Boolean(own && own.document === document && own.axe === window.axe && own.run === window.axe?.run
      && window.axe.version === expected && typeof window.axe.run === "function");
  }, version);
  if (ready) return;
  await browser.execute(source);
  const installed = await browser.execute(expected => {
    if (!window.axe || window.axe.version !== expected || typeof window.axe.run !== "function") return false;
    Object.defineProperty(window, "__vaultspendE2EAxeDocument", {
      configurable: true, value: { document, axe: window.axe, run: window.axe.run },
    });
    return true;
  }, version);
  if (!installed) throw new Error(`Axe ${version} did not load correctly in the current document`);
}
/** Same maximum settle allowance as the old matrix sleep. Observe the real animation timeline and stable layout.
 * Intentional infinite progress spinners are not transitions to a stable state; the old snapshot also inspected them in motion. */
export async function waitForVisualStability(browser) {
  const result = await browser.executeAsync(done => {
    const dialog = document.querySelector('[role="dialog"]');
    if (!dialog?.isConnected) return done({ error: "The inspected dialog is detached or missing" });
    if (typeof dialog.getAnimations !== "function") return done({ error: "Animation observation is unsupported" });
    let ended = false, last = null, stable = 0;
    const finish = value => { if (ended) return; ended = true; clearTimeout(deadline); done(value); };
    const deadline = setTimeout(() => finish({ error: "Dialog transitions/layout did not settle within 450 ms" }), 450);
    const frame = () => {
      if (ended) return;
      if (!dialog.isConnected || document.querySelector('[role="dialog"]') !== dialog) return finish({ error: "The inspected dialog was detached or replaced" });
      try {
        const animations = [...dialog.getAnimations({ subtree: true })];
        // Theme colour/background transitions on ancestors can affect inherited contrast inside the dialog.
        for (let ancestor = dialog.parentElement; ancestor; ancestor = ancestor.parentElement) animations.push(...ancestor.getAnimations());
        const moving = animations.some(a =>
          (a.pending || a.playState === "running") && a.effect?.getComputedTiming?.().iterations !== Infinity);
        const r = dialog.getBoundingClientRect();
        const signature = JSON.stringify([r.x, r.y, r.width, r.height]);
        stable = !moving && signature === last ? stable + 1 : 0;
        last = moving ? null : signature;
        if (stable >= 2) return finish({ ready: true });
        requestAnimationFrame(frame);
      } catch (error) { finish({ error: `Visual readiness failed: ${error.message}` }); }
    };
    requestAnimationFrame(frame);
  });
  if (!result?.ready) throw new Error(result?.error ?? "Visual readiness returned no result");
}
