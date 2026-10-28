import { chooseMenuOption } from "../harness.mjs";

// "Import transactions" always asks which account the file is from before it opens the file picker
// (src/Modal.tsx ChooseImportAccountDialog); it never starts on the account the page is showing.
// Specs that start an import through the button answer that question with this.

/** Clicks "Import transactions" and picks `accountName` in the account question. Stops at the file
 * picker (stubbed by `stubFilePicker`), so the caller carries on with whatever the import asks next. */
export async function startImportInto(browser, accountName) {
  await (await browser.$("button=Import transactions")).click();
  const trigger = await browser.$("button[data-import-account]");
  await trigger.waitForDisplayed({ timeout: 10000, timeoutMsg: "the import should ask which account first" });
  if ((await trigger.getAttribute("data-value")) !== "" || (await (await browser.$("button=Continue")).isEnabled())) {
    throw new Error("the account question should start with nothing chosen");
  }
  await chooseMenuOption(trigger, { label: accountName });
  await (await browser.$("button=Continue")).click();
}
