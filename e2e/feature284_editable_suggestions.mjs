import assert from "node:assert/strict";
import { launchApp, chooseRowAction, withFocusRetry } from "./harness.mjs";
import { seedFixture } from "./lib/seed.mjs";
import { setField } from "./lib/accumulation.mjs";

const dbDir = await seedFixture(`
import datetime
cur.execute("INSERT INTO accounts (name, account_type, starting_balance) VALUES ('Checking', 'checking', '1000.00')")
account = cur.lastrowid
for n in range(2):
    cur.execute("INSERT INTO transactions (account_id, date, description, amount, category, fingerprint) VALUES (?, ?, ?, ?, ?, ?)", (account, datetime.date.today().isoformat(), f'Suggestion purchase {n}', '-5.00', 'Groceries', f'suggestion-{n}'))
    if n == 0:
        for tag in ['Work', 'Very long suggestion label ' * 8]:
            cur.execute("INSERT INTO transaction_tags (transaction_id, tag) VALUES (?, ?)", (1, tag))
`);
const app = await launchApp({ dbDir });
const b = app.browser;
try {
  await (await b.$("button*=Transactions")).click();
  await withFocusRetry(b, async () => {
    await chooseRowAction(b, 'tr[data-payment-row="2"] [data-row-menu]', "Add tag…");
    const input = await b.$('.tag-input[role="combobox"]');
    await input.waitForExist({ timeout: 5000 });
    await input.setValue("Wor");
    await b.$('.editable-combobox-panel [role="option"]').click();
    assert.equal(await input.getValue(), "Work", "pointer choice must fill without blurring the row editor");
    await b.keys("Enter");
    await b.waitUntil(async () => (await b.$('tr[data-payment-row="2"]').getText()).includes("Work"), { timeout: 10000 });
  });
  await b.$('tr[data-payment-row="2"] input[type="checkbox"]').click();
  const bulk = await b.$('.bulk-tag-input input[role="combobox"]');
  await bulk.waitForExist({ timeout: 5000 });
  await bulk.setValue("bulk free text");
  await b.$('.bulk-tag-input button').click();
  await b.waitUntil(async () => (await b.$('tr[data-payment-row="2"]').getText()).includes("bulk free text"), { timeout: 10000 });
  await b.$("button*=Settings").click();
  await (await b.$('#categorization-rules')).$('button=Add rule…').click();
  await b.$('input[placeholder*="Ferrywood"]').setValue("Suggestion purchase");
  const selector = 'input[role="combobox"][aria-label="Give it this category"]';
  for (const palette of ["transparent", "futuristic", "retro"]) for (const theme of ["light", "dark"]) {
    await b.execute((p, t) => { document.documentElement.dataset.palette = p; document.documentElement.dataset.theme = t; }, palette, theme);
    await withFocusRetry(b, async () => {
      await setField(b, selector, "Groc"); await b.$(selector).click();
      await b.$('.editable-combobox-panel').waitForDisplayed({ timeout: 5000 });
      const result = await b.execute((sel) => {
        const input = document.querySelector(sel), panel = document.querySelector('.editable-combobox-panel');
        const rect = panel.getBoundingClientRect(), style = getComputedStyle(panel);
        const probe = document.createElement('span'); probe.style.color = 'var(--text)'; panel.append(probe);
        const text = getComputedStyle(probe).color; probe.remove();
        return { native: Boolean(document.querySelector('datalist, input[list]')), topLayer: panel.matches(':popover-open'),
          contained: rect.left >= 0 && rect.right <= innerWidth + 1 && rect.top >= 0 && rect.bottom <= innerHeight + 1,
          color: style.color, text, font: style.fontFamily, inputFont: getComputedStyle(input).fontFamily,
          focus: document.activeElement === input };
      }, selector);
      assert.equal(result.native, false); assert.equal(result.topLayer, true); assert.equal(result.contained, true, `${palette}/${theme}: viewport containment`);
      assert.equal(result.color, result.text); assert.equal(result.font, result.inputFont); assert.equal(result.focus, true);
      await b.keys(["ArrowDown", "Enter"]);
      assert.equal(await b.$(selector).getValue(), "Groceries");
      assert.equal(await b.$('[role="dialog"]').isExisting(), true, "choosing a suggestion must not submit the rule");
    });
  }
  await b.$('button=Save rule').click();
  await b.$('[role="dialog"]').waitForExist({ reverse: true, timeout: 10000 });
  console.log("FEATURE 284 E2E TEST PASSED");
} finally { await app.close(); }
