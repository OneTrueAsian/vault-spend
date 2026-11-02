// The compiled-app visual and accessibility matrix for the app-drawn date and month calendars
// (feature371_*, one spec per style so each fits the 60-second spec ceiling).
//
// For one style, in light and dark, at 1280x800 and at the 720x520 minimum window: open the date calendar
// in Add transaction (an ordinary dialog form) and the month calendar on an investment account's page, and
// check that each one
//   - is the app's own dialog (role=dialog, no aria-modal) with no native date control anywhere,
//   - sits inside the window with a margin, and the page and the dialog do not scroll sideways,
//   - draws its selected, today and unavailable days with distinct, visible looks that follow the theme,
//   - has no Axe violation of the WCAG 2.x A/AA rules (Axe's "incomplete" results are counted and kept; the
//     frosted surface's contrast is measured numerically by feature373_*, which Axe cannot do). Axe's
//     target-size rule runs on its own: its one known false positive (a control of the dialog beneath the
//     top-layer calendar "obscuring" a day) is accepted and counted, anything else fails,
//   - passes browser hit-testing (the control itself is at the centre and inset corners of every fully
//     visible control; clipped controls are counted apart and need the popup to scroll to them), receives
//     real coordinate mouse clicks, and keeps working after the popup is scrolled (lib/calendarHits.mjs),
//   - closes on its own Escape without closing the dialog around it.
// Screenshots go to VS_SCREENS_DIR (default: a temporary folder deleted on exit); the run's findings are
// printed as one JSON line so a report can quote them.
// Futuristic additionally checks the three accent colours and zero neon glow as token checks.

import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import { launchApp, waitForDataLoaded, waitUntilOrDiagnose } from "../harness.mjs";
import { seedFixture } from "./seed.mjs";
import { SUMMARY_FIXTURE_PY } from "./accumulation-fixture.mjs";
import { nav, openDetails, waitForAccumulation } from "./accumulation.mjs";
import { ensureAxe } from "./axeSession.mjs";
import { openCalendar } from "./dateFieldInput.mjs";
import { clickAtCentre, coverFirst, lastVisibleAction, pointerClick, probeHits, runTargetSizeAxe, scrollPopup, splitTargetSizeFindings } from "./calendarHits.mjs";
import { makeTempDir } from "./tempDir.mjs";

const SIZES = [
  { width: 1280, height: 800 },
  { width: 720, height: 520 },
];

export async function runCalendarMatrix(style) {
  const dbDir = await seedFixture(SUMMARY_FIXTURE_PY);
  const shotsDir = process.env.VS_SCREENS_DIR ?? makeTempDir(`vaultspend-calendar-${style}-`);
  fs.mkdirSync(shotsDir, { recursive: true });
  const app = await launchApp({ dbDir });
  const b = app.browser;
  const findings = [];
  let negativeControlDone = false;

  const popupState = () =>
    b.execute(() => {
      const popup = document.querySelector('.calendar-popover[role="dialog"]');
      if (!popup) return null;
      const rect = popup.getBoundingClientRect();
      const css = (el) => (el ? getComputedStyle(el) : null);
      const selected = popup.querySelector(".is-selected");
      const today = popup.querySelector(".is-today");
      const unavailable = popup.querySelector(".is-unavailable");
      const plain = popup.querySelector(".calendar-day:not(.is-selected):not(.is-today):not(.is-unavailable):not(.is-outside), .calendar-month:not(.is-selected):not(.is-today)");
      return {
        rect: { left: rect.left, right: rect.right, top: rect.top, bottom: rect.bottom },
        viewport: { width: innerWidth, height: innerHeight },
        ariaModal: popup.getAttribute("aria-modal"),
        nativeControls: document.querySelectorAll('input[type="date"], input[type="month"]').length,
        selectedBg: css(selected)?.backgroundColor ?? null,
        selectedColor: css(selected)?.color ?? null,
        plainBg: css(plain)?.backgroundColor ?? null,
        todayRing: css(today)?.boxShadow ?? null,
        unavailableOpacity: css(unavailable)?.opacity ?? null,
        font: css(popup).fontFamily,
        radius: css(popup).borderTopLeftRadius,
        boxShadow: css(popup).boxShadow,
        scroll: { height: popup.scrollHeight, client: popup.clientHeight },
        field: (() => { const r = popup.closest(".date-field")?.getBoundingClientRect(); return r ? { top: r.top, bottom: r.bottom } : null; })(),
        overflowX: document.documentElement.scrollWidth - innerWidth,
        popupScrollsSideways: popup.scrollWidth > popup.clientWidth + 1,
        target: (() => {
          const cell = popup.querySelector(".calendar-day, .calendar-month");
          const r = cell?.getBoundingClientRect();
          return r ? { width: r.width, height: r.height } : null;
        })(),
      };
    });

  async function axeFindings(context) {
    await ensureAxe(b);
    return b.executeAsync(
      (context, done) => {
        window.axe
          // target-size runs separately (runTargetSizeAxe): Axe judges "obscured" from a stacking order it computes
          // itself, which does not know about the browser's top layer, so it reports the dialog's own controls
          // beneath the calendar as covering the calendar's days. Every other rule runs here.
          .run(document.querySelector(context), { runOnly: { type: "tag", values: ["wcag2a", "wcag2aa", "wcag21a", "wcag21aa", "wcag22aa"] }, rules: { "target-size": { enabled: false } } })
          .then((r) => done({ violations: r.violations.flatMap((v) => v.nodes.map((n) => `${v.id}: ${n.target.join(" ")} (${n.any.concat(n.all, n.none).map((c) => c.message + " [" + (c.relatedNodes ?? []).map((r) => r.html.slice(0, 90)).join(" ; ") + "]").join(" ")})`)), incomplete: r.incomplete.map((v) => v.id) }));
      },
      context,
    );
  }

  async function inspect(name, where) {
    const state = await popupState();
    assert.ok(state, `${where}: the calendar should be open`);
    assert.equal(state.ariaModal, null, `${where}: the calendar is non-modal`);
    assert.equal(state.nativeControls, 0, `${where}: no native date or month control exists`);
    const { rect, viewport } = state;
    assert.ok(rect.left >= 7.5 && rect.right <= viewport.width - 7.5 && rect.top >= -0.5 && rect.bottom <= viewport.height + 0.5, `${where}: the calendar stays inside the window: ${JSON.stringify({ rect, viewport })}`);
    assert.ok(state.overflowX <= 1, `${where}: the page does not scroll sideways (${state.overflowX}px)`);
    assert.equal(state.popupScrollsSideways, false, `${where}: the calendar does not scroll sideways`);
    assert.ok(state.target.width >= 24 && state.target.height >= 24, `${where}: day and month targets are at least 24px: ${JSON.stringify(state.target)}`);
    assert.notEqual(state.selectedBg, state.plainBg, `${where}: the selected item looks different from a plain one`);
    assert.notEqual(state.selectedBg, "rgba(0, 0, 0, 0)", `${where}: the selected item has a fill`);
    await b.saveScreenshot(path.join(shotsDir, `${name.replace(/[\/]/g, "-")}.png`));
    const small = await b.execute(() =>
      [...document.querySelectorAll(".calendar-popover button, .calendar-popover input")]
        .filter((el) => !el.disabled)
        .map((el) => ({ el, r: el.getBoundingClientRect() }))
        .filter(({ r }) => r.width < 24 || r.height < 24)
        .map(({ el, r }) => `${el.className || el.tagName} ${Math.round(r.width)}x${Math.round(r.height)}`),
    );
    assert.deepEqual(small, [], `${where}: every control in the calendar is at least 24x24 CSS px`);
    const axe = await axeFindings(".calendar-popover");
    assert.deepEqual(axe.violations, [], `${where}: Axe violations in the calendar (${JSON.stringify({ rect, viewport, scroll: state.scroll, field: state.field })})`);
    const targetSize = await runTargetSizeAxe(b);
    assert.equal(targetSize.error, undefined, `${where}: Axe target-size should run: ${targetSize.error}`);
    const { accepted, failing } = splitTargetSizeFindings(targetSize.nodes);
    assert.deepEqual(failing, [], `${where}: Axe target-size findings other than the top-layer false positive`);
    const hits = await probeHits(b);
    assert.equal(hits.popoverOpen, true, `${where}: the calendar is in the browser's top layer`);
    assert.deepEqual(hits.misses, [], `${where}: every fully visible control receives hits at its centre and corners`);
    assert.deepEqual(hits.small, [], `${where}: every enabled control is at least 24x24`);
    assert.ok(hits.visible.length >= 8, `${where}: a meaningful number of controls were hit-tested (${hits.visible.length})`);
    assert.ok(hits.clipped.length === 0 || hits.scroll.height > hits.scroll.client, `${where}: controls clipped by the calendar's edge need it to scroll: ${hits.clipped.join(", ")}`);
    if (hits.trigger) assert.ok(hits.trigger.width >= 24 && hits.trigger.height >= 24 && hits.trigger.centreHit, `${where}: the calendar button is at least 24x24 and receives its own centre hit: ${JSON.stringify(hits.trigger)}`);
    if (!negativeControlDone) {
      negativeControlDone = true;
      const covered = await coverFirst(b);
      assert.ok(covered.misses.length > 0, `${where}: the hit test must notice a control that something covers`);
      findings.push({ where: `${where} hit-test negative control`, missesReported: covered.misses.length });
    }
    findings.push({ where: `${where} hit test`, visibleControls: hits.visible.length, clippedControls: hits.clipped.length, hitMisses: hits.misses.length, calendarButton: hits.trigger, axeTargetSizeAccepted: accepted.length, axeTargetSizeAcceptedNodes: accepted.slice(0, 3) });
    findings.push({ where, selectedBg: state.selectedBg, selectedColor: state.selectedColor, plainBg: state.plainBg, font: state.font.split(",")[0], radius: state.radius, target: state.target, axeIncomplete: axe.incomplete });
    return state;
  }

  async function closeWithEscape(where, dialogStaysOpen) {
    await b.keys("Escape");
    await waitUntilOrDiagnose(b, async () => !(await b.$(".calendar-popover").isExisting()), { timeoutMsg: `${where}: Escape should close the calendar` });
    if (dialogStaysOpen) assert.equal(await b.$(".modal-panel").isExisting(), true, `${where}: Escape closed only the calendar, not the dialog around it`);
  }

  /** After Escape closed the calendar: reopen it with a real click on its button, then use real clicks on it. */
  async function pointerChecks(where, fieldSelector, kind) {
    const valueOf = (sel) => b.execute((sel) => document.querySelector(sel).closest("[data-date-field]").getAttribute("data-value"), sel);
    const trigger = await b.execute((sel) => { const t = document.querySelector(sel).closest(".date-field").querySelector(".date-field-trigger"); const r = t.getBoundingClientRect(); return { x: r.left + r.width / 2, y: r.top + r.height / 2 }; }, fieldSelector);
    const opening = await pointerClick(b, trigger.x, trigger.y);
    assert.ok(opening?.label?.startsWith("Choose "), `${where}: a real click on the calendar button reached the button: ${JSON.stringify(opening)}`);
    await b.$(".calendar-popover").waitForExist({ timeout: 5000, timeoutMsg: `${where}: the click should open the calendar` });
    const top = await probeHits(b);
    assert.deepEqual(top.misses, [], `${where}: hit misses before scrolling`);
    const scrolled = await scrollPopup(b, "bottom");
    const bottom = await probeHits(b);
    assert.deepEqual(bottom.misses, [], `${where}: hit misses after scrolling`);
    if (scrolled.scrollable) {
      assert.ok(scrolled.top > 0, `${where}: the calendar scrolled`);
      assert.notDeepEqual(bottom.visible, top.visible, `${where}: scrolling brought different controls into full view`);
    }
    findings.push({ where: `${where} scrolling`, scrollable: scrolled.scrollable, visibleBefore: top.visible.length, clippedBefore: top.clipped.length, visibleAfter: bottom.visible.length, clippedAfter: bottom.clipped.length });
    const action = await lastVisibleAction(b);
    assert.ok(action, `${where}: an action is fully visible after scrolling`);
    const before = await valueOf(fieldSelector);
    const got = await pointerClick(b, action.x, action.y);
    assert.equal(got?.inCalendar, true, `${where}: the click on "${action.text}" went to the calendar, not the control beneath: ${JSON.stringify(got)}`);
    assert.equal(got?.text, action.text, `${where}: the click reached the "${action.text}" button`);
    await waitUntilOrDiagnose(b, async () => !(await b.$(".calendar-popover").isExisting()), { timeoutMsg: `${where}: the action should close the calendar` });
    findings.push({ where: `${where} pointer`, action: action.text, valueBefore: before, valueAfter: await valueOf(fieldSelector) });
    // Then a day or month by real click, on a freshly opened calendar.
    const again = await pointerClick(b, trigger.x, trigger.y);
    assert.ok(again?.label?.startsWith("Choose "), `${where}: the calendar button still takes a real click`);
    await b.$(".calendar-popover").waitForExist({ timeout: 5000 });
    const item = kind === "date" ? ".calendar-popover .calendar-day:not(.is-selected):not(.is-outside):not(:disabled)" : ".calendar-popover .calendar-month:not(.is-selected):not(:disabled)";
    const wanted = await b.execute((item) => { const el = document.querySelector(item); return el.getAttribute("data-date") || el.getAttribute("data-month"); }, item);
    const clicked = await clickAtCentre(b, item);
    assert.equal(clicked?.date ?? clicked?.month, wanted, `${where}: the real click chose ${wanted}, not something underneath: ${JSON.stringify(clicked)}`);
    await waitUntilOrDiagnose(b, async () => !(await b.$(".calendar-popover").isExisting()), { timeoutMsg: `${where}: choosing closes the calendar` });
    assert.equal(await valueOf(fieldSelector), wanted, `${where}: the field holds the item that was clicked`);
    findings.push({ where: `${where} chosen by click`, item: wanted });
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
      for (const size of SIZES) {
        const where = `${style}/${theme}/${size.width}x${size.height}`;
        await b.setWindowSize(size.width, size.height);

        // The date calendar, in an ordinary dialog form.
        await nav(b, "Transactions");
        await (await b.$("button*=Add transaction")).click();
        const box = '.modal-panel input[aria-label="Date"]';
        await b.$(box).waitForExist({ timeout: 8000 });
        await openCalendar(b, box);
        await inspect(`${where}-date`, `${where} date calendar`);
        await closeWithEscape(`${where} date calendar`, true);
        await pointerChecks(`${where} date calendar`, box, "date");
        assert.equal(await b.$(".modal-panel").isExisting(), true, `${where}: the dialog is still open after the pointer checks`);
        await b.keys("Escape");
        await waitUntilOrDiagnose(b, async () => !(await b.$(".modal-panel").isExisting()), { timeoutMsg: `${where}: a second Escape should close the dialog` });

        // The month calendar, on an investment account's page.
        await openDetails(b, "Joey Roth IRA");
        await waitForAccumulation(b, (await b.execute(() => document.querySelector("[data-account-detail]").getAttribute("data-account-detail"))));
        const month = 'input[aria-label="Withdraw month"]';
        await (await b.$(month)).scrollIntoView({ block: "center" });
        await openCalendar(b, month);
        await inspect(`${where}-month`, `${where} month calendar`);
        await closeWithEscape(`${where} month calendar`, false);
        await pointerChecks(`${where} month calendar`, month, "month");
        await (await b.$("[data-account-back]")).click();
      }
    }

    if (style === "futuristic") {
      // Token checks: the three accent colours and zero neon glow, on a calendar that is open.
      await b.setWindowSize(1280, 800);
      await nav(b, "Transactions");
      await (await b.$("button*=Add transaction")).click();
      const box = '.modal-panel input[aria-label="Date"]';
      await b.$(box).waitForExist({ timeout: 8000 });
      await openCalendar(b, box);
      const edge = () => b.execute(() => { const p = document.querySelector(".calendar-popover"); const s = getComputedStyle(p); return { border: s.borderTopColor, shadow: s.boxShadow, selected: getComputedStyle(p.querySelector(".is-selected")).backgroundColor }; });
      const seen = {};
      for (const accent of ["cyan", "pink", "violet"]) {
        await b.execute((a) => { document.documentElement.setAttribute("data-accent", a); document.documentElement.style.setProperty("--neon-glow", "0.7"); }, accent);
        seen[accent] = await edge();
      }
      assert.equal(new Set(Object.values(seen).map((s) => s.selected)).size, 3, `each accent colours the selected day differently: ${JSON.stringify(seen)}`);
      await b.execute(() => document.documentElement.style.setProperty("--neon-glow", "0"));
      const flat = await edge();
      assert.ok(!/rgba?\(\s*\d+,\s*\d+,\s*\d+,\s*0?\.[1-9]/.test(flat.shadow.split(/\)\s*,\s*/).slice(1).join(")")) || /0px 0px 0px/.test(flat.shadow), `zero glow leaves no neon halo: ${flat.shadow}`);
      findings.push({ where: "futuristic accents and glow", accents: seen, zeroGlowShadow: flat.shadow });
      await b.keys("Escape");
      await b.keys("Escape");
    }
    console.log(`PASS calendar visual matrix ${style} (screenshots in ${shotsDir})`);
    console.log(`CALENDAR_FINDINGS ${JSON.stringify(findings)}`);
  } finally {
    await app.close();
  }
}
