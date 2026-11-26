/** Repeats `act` until `done()` is true. A repeat is any act after the first; every repeat is printed, so a dropped click or key press
 * is visible in the run record even when the step finally passes (VS-8). With `actFirst` the first act happens before `done` is ever checked.
 * Returns { acts, repeats }. */
export async function actUntil(browser, { label, done, act, actFirst = false, timeout, interval = 1500, timeoutMsg, wait = (condition, opts) => browser.waitUntil(condition, opts) }) {
  let acts = 0;
  try {
    if (actFirst) { await act(); acts++; }
    await wait(async () => {
      if (await done()) return true;
      await act();
      acts++;
      return false;
    }, { timeout, interval, timeoutMsg });
  } finally {
    const repeats = Math.max(0, acts - 1);
    if (repeats > 0) console.log(`[harness] action repeated ${repeats}x: ${label}`);
  }
  return { acts, repeats: Math.max(0, acts - 1) };
}
