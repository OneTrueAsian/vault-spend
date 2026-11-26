// VS-35: real import tabs, remembered choices, keyboard navigation and contained dialog scrolling.
import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import { launchApp, chooseStyle, chooseMenuOption, stubFilePicker, waitUntilOrDiagnose, withFocusRetry, dismissStatusMessages } from "./harness.mjs";
import { seedFixture } from "./lib/seed.mjs";
import { makeTempDir } from "./lib/tempDir.mjs";
import { dateInMonth } from "./lib/dates.mjs";
import { startImportInto } from "./lib/importAccount.mjs";

const dbDir = await seedFixture(`
cur.execute("INSERT INTO accounts(name,account_type,starting_balance) VALUES ('Checking','checking','1000.00')")
cur.execute("INSERT INTO accounts(name,account_type,starting_balance) VALUES ('Savings','savings','500.00')")
cur.execute("INSERT INTO import_category_mappings(file_category,category) VALUES ('merchandise','Shopping')")
`);
const dir=makeTempDir("vaultspend-vs35-tabs-");
const csv=path.join(dir,"import-tabs.csv");
fs.writeFileSync(csv,["Date,Description,Amount,Category,Account",
  `${dateInMonth(-1,2)},QQXZ REMEMBERED,-12.50,MERCHANDISE,Unknown CSV account`,
  ...Array.from({length:12},(_,i)=>`${dateInMonth(-1,3)},QQXZ NEW BANK ${i+1},-7.25,HOME SUPPLIES,Checking`),
  ...Array.from({length:12},(_,i)=>`${dateInMonth(-1,4)},QQXZ NEEDS CHOICE ${i+1},-3.40,,Checking`),""].join("\n"));
const shots=process.env.VS35_SHOTS || makeTempDir("vaultspend-vs35-shots-");
fs.mkdirSync(shots,{recursive:true});
const app=await launchApp({dbDir});
const b=app.browser;
const tab=id=>b.$(`[data-import-review-tab="${id}"]`);
const active=()=>b.execute(()=>document.querySelector('[data-import-review-tab][aria-selected="true"]')?.getAttribute("data-import-review-tab"));
const confirm=()=>b.$("[data-import-confirm]");
async function invoke(command,args={}) {
  const result=await b.executeAsync((command,args,done)=>window.__TAURI_INTERNALS__.invoke(command,args).then(ok=>done({ok}),e=>done({error:String(e)})),command,args);
  if (result.error) throw new Error(`${command}: ${result.error}`);
  return result.ok;
}
async function openReview() {
  await b.execute(file=>window.__pickedFiles.unshift(file),csv);
  await startImportInto(b,"Checking");
  await waitUntilOrDiagnose(b,async()=>{
    const keep=await b.$("button=Keep as-is");
    if (await keep.isDisplayed().catch(()=>false)) await keep.click();
    return b.execute(()=>!!document.querySelector('[aria-label="Import sections"]'));
  },{timeoutMsg:"VS-35 tabbed review opens"});
  await dismissStatusMessages(b);
  await b.executeAsync(done=>document.fonts.ready.then(()=>done()));
}
async function cancel() {
  await b.$("//div[contains(@class,'dup-review-actions')]//button[normalize-space()='Cancel']").click();
  await (await confirm()).waitForExist({reverse:true,timeout:5000});
}
async function checkLayout(where) {
  const result=await b.execute(()=>{
    const dialog=document.querySelector('[role="dialog"]');
    const panel=dialog.querySelector('[role="tabpanel"]:not([hidden])');
    const scrollBoxes=[...panel.querySelectorAll('*')].filter(el=>el.getClientRects().length && /^(auto|scroll)$/.test(getComputedStyle(el).overflowY) && el.scrollHeight>el.clientHeight+1).map(el=>el.className);
    const brokenWords=[];
    for (const tab of dialog.querySelectorAll('[role="tab"]')) {
      const text=tab.firstChild;
      for (const word of text.textContent.matchAll(/\S+/g)) {
        const range=document.createRange(); range.setStart(text,word.index); range.setEnd(text,word.index+word[0].length);
        if (new Set([...range.getClientRects()].map(r=>Math.round(r.top))).size>1) brokenWords.push(word[0]);
      }
    }
    const main=document.querySelector('.main');
    return {scrollBoxes,brokenWords,pageOverflow:Math.max(document.documentElement.scrollWidth-document.documentElement.clientWidth,main.scrollWidth-main.clientWidth),dialogOverflow:dialog.scrollWidth-dialog.clientWidth};
  });
  console.log(`VS-35 geometry ${where}: ${JSON.stringify(result)}`);
  assert.deepEqual(result.scrollBoxes,[],`${where}: only the modal body scrolls vertically`);
  assert.deepEqual(result.brokenWords,[],`${where}: tab labels keep whole words`);
  assert.ok(result.pageOverflow<=1 && result.dialogOverflow<=1,`${where}: no sideways page/dialog overflow`);
}
async function capture(theme,width,id) {
  await (await tab(id)).click();
  await b.execute(()=>document.querySelector('[role="dialog"] .modal-body').scrollTop=0);
  await checkLayout(`${theme}/${width}/${id}`);
  await b.saveScreenshot(path.join(shots,`import-${theme}-${width}-${id}.png`));
}
try {
  await chooseStyle(b,"Default","transparent");
  await b.$('.nav-item[aria-label="Transactions"]').click();
  await stubFilePicker(b,[]);
  const checkingId=(await invoke("list_accounts")).find(a=>a.name==="Checking").id;
  const initialPreview=await invoke("preview_import",{path:csv,invertAmounts:false,accountId:checkingId});
  const fileCategoryOrder=initialPreview.unmatched_categories.map(category=>category.name);
  for (const theme of ["light","dark"]) {
    await b.execute(theme=>[...document.querySelectorAll('.theme-toggle[aria-label="Theme"] button')].find(el=>el.textContent.trim().toLowerCase()===theme).click(),theme);
    for (const width of [1440,720]) {
      await b.setWindowSize(width,1000);
      await openReview();
      assert.equal(await active(),"bank","first asked category opens Bank categories");
      assert.deepEqual(await b.execute(()=>[...document.querySelectorAll('[role="tab"]')].map(t=>t.textContent)),["Bank categories (1)","Needs a category (24)","Transactions (25)"]);
      await waitUntilOrDiagnose(b,()=>b.$('.import-review-remembered').isDisplayed(),{timeoutMsg:"remembered note is displayed once the dialog fade-in ends"}); assert.match(await b.$('.import-review-remembered').getText(),/Using your choices from last time for 1 bank category/);
      assert.equal(await b.$('[data-import-category-name="MERCHANDISE"]').isExisting(),false,"remembered name is not listed");
      await withFocusRetry(b,async()=>{
        await (await tab("bank")).click(); await b.keys("ArrowRight"); assert.equal(await active(),"needs");
        await b.keys("End"); assert.equal(await active(),"rows");
        await b.keys("Home"); assert.equal(await active(),"bank");
        await b.keys("ArrowLeft"); assert.equal(await active(),"rows");
        await b.keys("ArrowRight"); assert.equal(await active(),"bank");
      });
      // An expanded 12-row bank list must grow with the dialog rather than scroll inside it.
      await b.$('.import-category-rows-toggle').click();
      await capture(theme,width,"bank");
      await capture(theme,width,"needs");
      await capture(theme,width,"rows");
      assert.ok((await b.$('.import-review-dialog').getText()).includes("CSV: Unknown CSV account"));
      await b.$('[aria-label="Change your choices from last time"]').click();
      assert.equal(await active(),"bank");
      assert.deepEqual(await b.execute(()=>[...document.querySelectorAll('[data-import-category-name]')].map(el=>el.getAttribute('data-import-category-name'))),fileCategoryOrder,"Change retains the preview input order");
      assert.match(await b.$('#import-review-panel-bank').getText(),/Your choice from last time/);
      await checkLayout(`${theme}/${width}/remembered`);
      await b.saveScreenshot(path.join(shots,`import-${theme}-${width}-remembered.png`));
      const leaked=await b.execute(()=>[...document.querySelectorAll('[role="dialog"] *')].flatMap(el=>[...el.attributes].map(a=>a.value)).filter(value=>/\$[\d,]+\.\d{2}|12\.50|7\.25|3\.40/.test(value)));
      assert.deepEqual(leaked,[],"no amounts in attributes, including row checkbox names");
      await cancel();
    }
  }
  // A separate review commits while the remembered name has NEVER been revealed in this review.
  await b.setWindowSize(1440,1000);
  await openReview();
  await b.$("button=Let the app guess for all").click();
  assert.equal(await b.$('[data-import-category-name="MERCHANDISE"]').isExisting(),false);
  await chooseMenuOption(await b.$('[data-import-category-name="HOME SUPPLIES"]'),{value:"map:Groceries"});
  await (await tab("needs")).click();
  await b.$("button=Leave the rest uncategorized").click();
  await waitUntilOrDiagnose(b,async()=>!(await (await confirm()).getAttribute("disabled")),{timeoutMsg:"all rows settled enables Import"});
  assert.equal(await active(),"needs");
  assert.equal(await (await tab("needs")).getText(),"Needs a category (0)");
  assert.match(await b.$('#import-review-panel-needs').getText(),/Every row has a category now/);
  await b.saveScreenshot(path.join(shots,"import-complete.png"));
  await (await confirm()).click();
  await (await confirm()).waitForExist({reverse:true,timeout:10000});
  const transactions=await invoke("list_transactions");
  assert.equal(transactions.length,25);
  assert.equal(transactions.find(row=>row.description==="QQXZ REMEMBERED").category,"Shopping");
  assert.equal(transactions.find(row=>row.description==="QQXZ NEW BANK 1").category,"Groceries");
  const accountId=(await invoke("list_accounts")).find(a=>a.name==="Checking").id;
  const second=await invoke("preview_import",{path:csv,invertAmounts:false,accountId});
  assert.equal(second.unmatched_categories.find(c=>c.name==="MERCHANDISE").remembered_category,"Shopping","bulk guess did not forget a hidden remembered mapping");
  assert.equal(second.unmatched_categories.find(c=>c.name==="HOME SUPPLIES").remembered_category,"Groceries");
  console.log("FEATURE 413 PASSED: tabs, keyboard, native layout, remembered reveal and hidden remembered mapping retained after import.");
} finally { await app.close(); }