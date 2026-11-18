// Clicks `clickSelector` until `shownSelector` is on the page. A single click can be missed on a hosted runner (a page still settling, a render a moment
// late), which left specs waiting on a result that was never going to appear. This clicks again only while the result is not showing, and only when the
// click target is present, so it never repeats a click that worked.
export async function clickUntilShown(browser, clickSelector, shownSelector, { timeout = 20000, timeoutMsg } = {}) {
  await browser.waitUntil(async () => {
    if (await browser.$(shownSelector).isExisting()) return true;
    const target = await browser.$(clickSelector);
    if (await target.isExisting()) await target.click();
    return false;
  }, { timeout, interval: 1500, timeoutMsg });
}
