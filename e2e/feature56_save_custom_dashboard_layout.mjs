// E2E test for saving a named custom Dashboard layout: removing a widget
// during Customize mode makes the Layout dropdown fall into the disabled
// "Custom (unsaved)" state, "+ Save as…" persists it under a chosen name
// (localStorage, mirroring the Ledger's saved-filter pattern), and it then
// behaves like any built-in preset — selectable from the dropdown, and
// deletable once selected.
//
// Run with: node e2e/feature56_save_custom_dashboard_layout.mjs

import { chooseMenuOption, launchApp, menuOptionLabels } from "./harness.mjs";

const app = await launchApp();
try {
  const customizeBtn = await app.browser.$("button=Customize");
  await customizeBtn.waitForExist({ timeout: 10000 });
  await customizeBtn.click();

  const removeBtn = await app.browser.$('button[aria-label="Remove widget"]');
  await removeBtn.waitForExist({ timeout: 5000 });
  await removeBtn.click();

  // The layout picker is a popover menu, not a native <select>: its trigger carries the current value,
  // and the options only exist while the menu is open.
  const select = await app.browser.$(".layout-select-toggle");
  const selectedValue = () => select.getAttribute("data-value");
  // The shared helpers reopen the menu if another spec's window takes focus and closes it mid-read.
  const optionLabels = () => menuOptionLabels(select);
  const chooseLayout = (value) => chooseMenuOption(select, { value });
  await app.browser.waitUntil(async () => (await selectedValue()) === "custom", {
    timeout: 5000,
    timeoutMsg: "expected removing a widget to fall into the 'custom' (unsaved) layout state",
  });

  const saveAsBtn = await app.browser.$("button=+ Save as…");
  await saveAsBtn.waitForExist({ timeout: 5000 });
  await saveAsBtn.click();

  const nameInput = await app.browser.$(".saved-filter-form input");
  await nameInput.waitForExist({ timeout: 5000 });
  await nameInput.setValue("Weekly check-in");
  const form = await app.browser.$(".saved-filter-form");
  const saveBtn = await form.$("button=Save");
  await saveBtn.click();

  await app.browser.waitUntil(async () => (await selectedValue()) === "custom:Weekly check-in", {
    timeout: 5000,
    timeoutMsg: "expected the saved layout to become the dropdown's selected value",
  });

  const optionTexts = await optionLabels();
  if (!optionTexts.includes("Weekly check-in")) {
    throw new Error(`expected "Weekly check-in" in the Layout dropdown, got: ${optionTexts.join(", ")}`);
  }

  // Switching away and back proves it round-trips as a real named preset,
  // not just a one-off in-memory flag.
  await chooseLayout("default");
  if ((await selectedValue()) !== "default") {
    throw new Error("expected switching to Default to select the built-in default preset");
  }
  await chooseLayout("custom:Weekly check-in");
  if ((await selectedValue()) !== "custom:Weekly check-in") {
    throw new Error("expected switching back to the saved preset to re-select it");
  }

  const deleteBtn = await app.browser.$("button=Delete");
  if (!(await deleteBtn.isExisting())) {
    throw new Error('expected a "Delete" button while a saved custom layout is active');
  }
  await deleteBtn.click();

  await app.browser.waitUntil(
    async () => {
      return !(await optionLabels()).includes("Weekly check-in");
    },
    { timeout: 5000, timeoutMsg: 'expected "Weekly check-in" to be removed from the Layout dropdown after Delete' },
  );

  console.log("FEATURE 56 E2E TEST PASSED");
} finally {
  await app.close();
}
