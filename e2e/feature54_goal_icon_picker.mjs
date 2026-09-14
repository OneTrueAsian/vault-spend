// E2E test for the Goals icon picker: picking an explicit icon swatch when
// creating a goal overrides the name-guessed default (bucketIcons.tsx) and
// round-trips through the database — list_buckets must hand icon_key back,
// not just accept it on write. Mirrors feature37_bucket_colors.mjs's
// pattern exactly, for the icon picker added alongside the color picker.
//
// Run with: node e2e/feature54_goal_icon_picker.mjs

import { launchApp } from "./harness.mjs";

const app = await launchApp();
try {
  const goalsNav = await app.browser.$("button*=Goals");
  await goalsNav.click();

  const addTile = await app.browser.$(".add-tile");
  await addTile.waitForExist({ timeout: 10000 });
  await addTile.click();

  const nameInput = await app.browser.$(".bucket-new-form input");
  await nameInput.waitForExist({ timeout: 5000 });
  // A name that matches none of bucketIcons.tsx's keyword rules (no
  // travel/home/gift/laptop) — its auto-guessed icon would be the generic
  // Flag fallback, so an explicit "gift" pick is unambiguously provable.
  await nameInput.setValue("Widget Fund");

  const swatches = await app.browser.$$(".icon-picker-swatch");
  const swatchTitles = [];
  for (const s of swatches) swatchTitles.push(await s.getAttribute("title"));
  const giftIndex = swatchTitles.indexOf("gift");
  if (giftIndex === -1) throw new Error(`expected a "gift" icon swatch, got titles: ${swatchTitles.join(", ")}`);
  await swatches[giftIndex].click();

  const activeSwatch = await app.browser.$(".icon-picker-swatch-active");
  const activeTitle = await activeSwatch.getAttribute("title");
  if (activeTitle !== "gift") throw new Error(`expected the gift swatch to be marked active, got "${activeTitle}"`);

  const newBucketForm = await app.browser.$(".bucket-new-form");
  const createButton = await newBucketForm.$("button=Create");
  await createButton.click();

  const card = await app.browser.$(
    "//div[contains(@class,'bucket-card')][.//h3[contains(., 'Widget Fund')]]",
  );
  await card.waitForExist({ timeout: 10000 });

  // A regex-guessed icon for "Widget Fund" would be the Flag <svg>; an
  // explicit "gift" pick renders a bundled <img> instead. Not checking the
  // <img src> for a filename substring — the bundled gift icon is small
  // enough that Vite inlines it as a base64 data URI rather than emitting
  // a named file (see feature59's own note on this) — so instead reopen
  // the bucket's edit form and confirm "gift" round-tripped through
  // create_bucket + list_buckets as the active swatch, same pattern
  // feature59 uses for accounts/categories.
  const icoImg = await card.$(".bucket-ico img");
  if (!(await icoImg.isExisting())) {
    throw new Error('expected "Widget Fund" to render an <img> icon (explicit pick), found none — did the picker fall through to the Flag guess?');
  }

  const editBtn = await card.$("button=Edit");
  await editBtn.click();
  const activeEditSwatch = await card.$(".icon-picker-swatch-active");
  await activeEditSwatch.waitForExist({ timeout: 5000 });
  const persistedTitle = await activeEditSwatch.getAttribute("title");
  if (persistedTitle !== "gift") throw new Error(`expected "gift" to be the active swatch after creation, got "${persistedTitle}"`);

  console.log("goal's active icon after creation:", persistedTitle);
  console.log("FEATURE 54 E2E TEST PASSED");
} finally {
  await app.close();
}
