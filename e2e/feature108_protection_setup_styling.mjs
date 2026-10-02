// Verify real field geometry and theme inheritance throughout the protection wizard.
import assert from "node:assert/strict";
import path from "node:path";
import os from "node:os";
import { launchApp, reclaimWindowFocus } from "./harness.mjs";

const app = await launchApp();
try {
  const { browser } = app;
  await (await browser.$("button*=Settings")).click();
  await (await browser.$("button=Turn on password protection…")).click();
  await browser.$("#protection-setup-password").waitForExist({ timeout: 5000 });

  async function checkFields() {
    const fields = await browser.execute(() => [...document.querySelectorAll(".protection-setup input")].map((input) => {
      const label = document.querySelector(`label[for="${input.id}"]`);
      const box = input.getBoundingClientRect();
      const parent = input.parentElement.getBoundingClientRect();
      const cs = getComputedStyle(input);
      const reference = document.createElement("input");
      reference.className = "text-input";
      input.parentElement.append(reference);
      const expected = getComputedStyle(reference);
      const result = {
        width: box.width, parentWidth: parent.width, height: box.height,
        belowLabel: box.top >= label.getBoundingClientRect().bottom,
        radius: cs.borderRadius, color: cs.color, background: cs.backgroundColor,
        expectedColor: expected.color, expectedBackground: expected.backgroundColor,
      };
      reference.remove();
      return result;
    }));
    assert.equal(fields.length, 2);
    for (const field of fields) {
      assert.ok(field.belowLabel, "each label should sit above its input");
      assert.ok(Math.abs(field.width - field.parentWidth) < 2, "fields should fill their container");
      assert.ok(field.height >= 36, "fields need normal app-sized padding");
      assert.notEqual(field.radius, "0px");
      assert.equal(field.color, field.expectedColor);
      assert.equal(field.background, field.expectedBackground);
    }
  }

  for (const palette of ["transparent", "futuristic"]) {
    for (const theme of ["light", "dark"]) {
      await browser.execute((palette, theme) => {
        document.documentElement.dataset.palette = palette;
        document.documentElement.dataset.theme = theme;
      }, palette, theme);
      await checkFields();
      // Reclaim focus first, and re-sample if another window took it again between the reclaim and
      // the read (see reclaimWindowFocus) — but only ever retry on a lost WINDOW focus: a field that
      // is focused in a focused window and still not :focus-visible fails the assertion below.
      let focus;
      for (let attempt = 0; attempt < 3; attempt++) {
        await reclaimWindowFocus(browser);
        focus = await sampleFocus();
        if (focus.hasFocus) break;
      }
      assert.ok(focus.visible, `the initial password field should have visible keyboard focus (${palette}/${theme}: ${JSON.stringify(focus)})`);
      assert.equal(focus.outline, focus.accent, "focus should use the active theme accent");
      await browser.saveScreenshot(path.join(os.tmpdir(), `vault-protection-${palette}-${theme}.png`));
    }
  }
  async function sampleFocus() {
    return browser.execute(() => {
      const field = document.querySelector(".protection-setup input");
      const reference = document.createElement("span");
      reference.style.color = "var(--accent)";
      field.parentElement.append(reference);
      const cs = getComputedStyle(field);
      // hasFocus/active tell a lost WINDOW focus (another spec's window took OS foreground) apart from
      // a genuine field-focus defect, and are printed in the assertion message when it fails.
      const result = { visible: field.matches(":focus-visible"), outline: cs.outlineColor, accent: getComputedStyle(reference).color, hasFocus: document.hasFocus(), active: document.activeElement?.id || document.activeElement?.tagName };
      reference.remove();
      return result;
    });
  }
  await (await browser.$("#protection-setup-password")).setValue("correct horse battery staple");
  await (await browser.$("#protection-setup-confirm")).setValue("correct horse battery staple");
  await (await browser.$("button=Continue")).click();
  await browser.$(".protection-setup-key").waitForExist({ timeout: 10000 });
  let recoveryFocus;
  for (let attempt = 0; attempt < 3; attempt++) {
    await reclaimWindowFocus(browser);
    recoveryFocus = await browser.execute(() => ({
      hasFocus: document.hasFocus(),
      activeText: document.activeElement?.textContent?.trim() ?? "",
    }));
    if (recoveryFocus.hasFocus) break;
  }
  assert.equal(
    recoveryFocus.activeText,
    "I've saved it",
    `the recovery-key step should move focus to its primary action (${JSON.stringify(recoveryFocus)})`,
  );
  const fits = await browser.execute(() => {
    const panel = document.querySelector(".modal-panel");
    return panel.scrollWidth <= panel.clientWidth;
  });
  assert.ok(fits, "the recovery key must not overflow the dialog");
  await browser.saveScreenshot(path.join(os.tmpdir(), "vault-protection-recovery.png"));
  await (await browser.$("button=I've saved it")).click();
  await browser.$("#protection-setup-answer-0").waitForExist({ timeout: 5000 });
  await checkFields();
  await browser.saveScreenshot(path.join(os.tmpdir(), "vault-protection-confirm.png"));
  await (await browser.$("button=Cancel")).click();
  await browser.$(".protection-setup").waitForExist({ reverse: true, timeout: 5000 });
} finally {
  await app.close();
}
console.log("FEATURE 108 E2E TEST PASSED");
