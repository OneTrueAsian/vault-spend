// Reports (VS-31 step 2): its report sections are in tabs, and a tab's sections are only on the page once it has been opened.
// Open the tab that holds a section before reading it:
//   income = Income → spending, categories = category-by-month table, daily = heatmap, people = by member / by tag / net worth by member,
//   savings = savings rate trend, years = year by year, comparisons = Comparisons.
export async function openReportsTab(browser, id) {
  const tab = await browser.$(`[data-reports-tab='${id}']`);
  await tab.waitForExist({ timeout: 15000 });
  await tab.click();
  await browser.waitUntil(async () => (await tab.getAttribute("aria-selected")) === "true" && (await (await browser.$(`#reports-panel-${id}`)).isDisplayed()), { timeout: 5000, timeoutMsg: `the ${id} tab did not open` });
}
