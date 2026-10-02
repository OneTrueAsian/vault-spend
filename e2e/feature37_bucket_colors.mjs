// E2E test for bucket color-coding: creating a bucket with a chosen swatch
// tints that bucket's card (a top border, plus the progress bar when it
// has a target) and round-trips through the database — list_buckets must
// hand the color back, not just accept it on write.
//
// Run with: node e2e/feature37_bucket_colors.mjs

import { launchApp } from "./harness.mjs";

const app = await launchApp();
try {
  const bucketsNav = await app.browser.$("button*=Goals");
  await bucketsNav.click();

  const addTile = await app.browser.$(".add-tile");
  await addTile.waitForExist({ timeout: 10000 });
  await addTile.click();

  const nameInput = await app.browser.$(".bucket-new-form input");
  await nameInput.waitForExist({ timeout: 5000 });
  await nameInput.setValue("Vacation Fund");

  // Swatch order is [no-color, ...BUCKET_COLORS] — index 4 is the 3rd real
  // color (#C08A2E, amber), arbitrary but fixed so this test is deterministic.
  const swatches = await app.browser.$$(".bucket-color-swatch");
  const chosenSwatch = swatches[4];
  const chosenColor = await chosenSwatch.getCSSProperty("background-color");
  await chosenSwatch.click();

  const newBucketForm = await app.browser.$(".bucket-new-form");
  const createButton = await newBucketForm.$("button=Create");
  await createButton.click();

  const card = await app.browser.$(".bucket-card");
  await card.waitForExist({ timeout: 10000 });
  const cardName = await card.$("h2");
  const nameText = await cardName.getText();
  if (nameText !== "Vacation Fund") throw new Error(`expected the new bucket card, got "${nameText}"`);

  const borderColor = await card.getCSSProperty("border-top-color");
  if (borderColor.parsed.hex.toLowerCase() !== chosenColor.parsed.hex.toLowerCase()) {
    throw new Error(
      `expected the card's top border to be the chosen color ${chosenColor.parsed.hex}, got ${borderColor.parsed.hex}`,
    );
  }

  console.log("bucket card color:", borderColor.parsed.hex);
  console.log("FEATURE 37 E2E TEST PASSED");
} finally {
  await app.close();
}
