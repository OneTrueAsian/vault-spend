// Choosing a profile from the header's profile menu. A single script click on the toggle can be missed (a dialog still closing, a render a
// moment late), which left specs 306 and 310 waiting on a list that never opened. This clicks the toggle only while the list is not showing,
// so it re-opens a menu that did not open but never closes one that did.
export async function chooseProfileFromMenu(b, name) {
  const toggle = await b.$(".profile-switcher-toggle");
  await toggle.waitForExist({ timeout: 10000, timeoutMsg: "the profile menu button should be on the page" });
  await b.waitUntil(async () => {
    if (await b.$(".profile-switcher-option").isExisting()) return true;
    await b.execute(el => el.click(), toggle);
    return false;
  }, { timeout: 15000, interval: 1500, timeoutMsg: "the profile list should open before an option is chosen" });
  await b.execute(profile => [...document.querySelectorAll(".profile-switcher-option")].find(o => o.textContent.includes(profile)).click(), name);
}
