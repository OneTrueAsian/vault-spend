// The compiled-app contrast measurement for the date and month calendars (feature373_*, one spec per group so
// each fits the 60-second spec ceiling). The procedure and its limits are in lib/calendarContrast.mjs.
//
// For one style, in light and dark: open the date calendar in Add transaction (with a chosen day that is not
// today, so "today" and "selected" are different looks) and the month calendar on an investment account's page,
// then measure the resting calendar (weekday and heading text, ordinary, today, selected, adjacent-month and
// unavailable days, buttons, actions) and each pointer and focus state in its own screenshot. Futuristic repeats
// the accent-sensitive states for each accent colour. Every measurement that has a threshold must reach it.
// Background screenshots (ink hidden) go to VS_SCREENS_DIR and the numbers to contrast-<group>.json there.

import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import { launchApp, waitForDataLoaded, waitUntilOrDiagnose } from "../harness.mjs";
import { seedFixture } from "./seed.mjs";
import { SUMMARY_FIXTURE_PY } from "./accumulation-fixture.mjs";
import { nav, openDetails, waitForAccumulation } from "./accumulation.mjs";
import { openCalendar, typeDate } from "./dateFieldInput.mjs";
import { isoDaysFromNow, monthFromNow } from "./dates.mjs";
import { ACCENT_SENSITIVE, REST_CATEGORIES, enterState, measureState, stateSteps } from "./calendarContrast.mjs";
import { makeTempDir } from "./tempDir.mjs";

/** `accents`: null for a style with one look, else the data-accent values to measure. `full`: accents that get the whole state list (the rest get the accent-sensitive ones). */
export async function runCalendarContrast(style, { group = style, accents = null, full = accents ? [accents[0]] : [null] } = {}) {
  const dbDir = await seedFixture(SUMMARY_FIXTURE_PY);
  const outDir = process.env.VS_SCREENS_DIR ?? makeTempDir(`vaultspend-contrast-${group}-`);
  fs.mkdirSync(outDir, { recursive: true });
  const app = await launchApp({ dbDir, windowSize: { width: 1280, height: 800 } });
  const b = app.browser;
  const rows = [];
  const absences = [];
  const unreached = [];

  async function measureOpenCalendar(kind, theme, accent) {
    const base = `${group}-${theme}-${accent ?? "default"}-${kind}`;
    const take = async (label, categories, reached) => {
      const result = await measureState(b, categories);
      fs.writeFileSync(path.join(outDir, `contrast-${base}-${label.replace(/\W+/g, "-")}-background.png`), result.background);
      for (const m of result.measured) rows.push({ style, theme, accent, kind, state: label, stateReached: reached, ...m });
      for (const a of result.absent) absences.push(`${base} / ${label}: ${a}`);
    };
    if (full.includes(accent)) await take("rest", REST_CATEGORIES[kind], true);
    for (const step of stateSteps(kind)) {
      if (!full.includes(accent) && !ACCENT_SENSITIVE.has(step.name)) continue;
      const reached = await enterState(b, step);
      if (!reached) unreached.push(`${base} / ${step.name}`);
      await take(step.name, step.measure, reached);
    }
  }

  try {
    for (const theme of ["light", "dark"]) {
      await b.execute(
        (s, t) => {
          localStorage.setItem("meadow-theme-style", s);
          localStorage.setItem("meadow-theme", t);
          localStorage.setItem("meadow-reduce-motion", "on");
          location.reload();
        },
        style,
        theme,
      );
      await waitUntilOrDiagnose(b, () => b.execute((s, t) => document.documentElement.dataset.palette === s && document.documentElement.dataset.theme === t && Boolean(document.querySelector(".nav-item")), style, theme), {
        timeout: 20000,
        timeoutMsg: `expected the ${style} style in ${theme} mode after reloading`,
      });
      await waitForDataLoaded(b);

      // The date calendar, on a day that is not today but is in today's month.
      await nav(b, "Transactions");
      await (await b.$("button*=Add transaction")).click();
      const box = '.modal-panel input[aria-label="Date"]';
      await b.$(box).waitForExist({ timeout: 8000 });
      const dayOfMonth = new Date().getDate();
      await typeDate(b, box, isoDaysFromNow(dayOfMonth <= 15 ? 5 : -5));
      await openCalendar(b, box);
      for (const accent of accents ?? [null]) {
        if (accent) await b.execute((a) => document.documentElement.setAttribute("data-accent", a), accent);
        await measureOpenCalendar("date", theme, accent);
      }
      await b.keys("Escape");
      await b.keys("Escape");
      await waitUntilOrDiagnose(b, async () => !(await b.$(".modal-panel").isExisting()), { timeoutMsg: "the dialog should close" });

      // The month calendar, on an investment account's page, on next month (this month when it is December).
      const id = await openDetails(b, "Joey Roth IRA");
      await waitForAccumulation(b, id);
      const month = 'input[aria-label="Withdraw month"]';
      await (await b.$(month)).scrollIntoView({ block: "center" });
      const thisMonth = monthFromNow(0);
      await typeDate(b, month, new Date().getMonth() === 11 ? thisMonth : monthFromNow(1));
      await openCalendar(b, month);
      for (const accent of accents ?? [null]) {
        if (accent) await b.execute((a) => document.documentElement.setAttribute("data-accent", a), accent);
        await measureOpenCalendar("month", theme, accent);
      }
      await b.keys("Escape");
      await (await b.$("[data-account-back]")).click();
    }
  } finally {
    await app.close();
  }

  const failing = rows.filter((r) => r.passes === false);
  const lowest = rows.filter((r) => r.threshold !== null).reduce((a, r) => (a === null || r.ratio < a.ratio ? r : a), null);
  const report = { group, style, measured: rows.length, thresholded: rows.filter((r) => r.threshold !== null).length, lowest: lowest && { state: `${lowest.theme}/${lowest.accent ?? "default"}/${lowest.kind}/${lowest.state}/${lowest.name}`, ratio: lowest.ratio }, failing, unreachedStates: unreached, absentCategories: absences, rows };
  fs.writeFileSync(path.join(outDir, `contrast-${group}.json`), JSON.stringify(report, null, 2));
  console.log(`CONTRAST_SUMMARY ${JSON.stringify({ group, measured: report.measured, thresholded: report.thresholded, lowest: report.lowest, failing: failing.length, unreachedStates: unreached.length })}`);
  assert.deepEqual(unreached, [], "every pointer and focus state should have been reached before it was measured");
  assert.ok(report.thresholded >= 20, `a meaningful number of text samples should have been measured (${report.thresholded})`);
  assert.deepEqual(failing.map((r) => `${r.theme}/${r.accent ?? "default"}/${r.kind}/${r.state}/${r.name} ${r.ratio.toFixed(2)}:1 < ${r.threshold}:1 (${r.text})`), [], "text and button graphics must reach their contrast thresholds");
  console.log(`PASS calendar contrast ${group} (${report.thresholded} measured samples, lowest ${report.lowest?.ratio.toFixed(2)}:1; evidence in ${outDir})`);
}
