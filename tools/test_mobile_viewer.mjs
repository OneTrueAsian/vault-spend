// Ordinary Edge browser validation of the compiled synthetic preview, not native Tauri E2E.
import assert from "node:assert/strict";
import { spawn } from "node:child_process";
import { readFile, mkdir } from "node:fs/promises";
import { createServer } from "node:http";
import path from "node:path";
import os from "node:os";
import { remote } from "webdriverio";

const previewRoot=path.resolve("dist-mobile-preview"),productionRoot=path.resolve("dist-mobile");
const output=process.env.VAULTSPEND_MOBILE_TEST_OUTPUT??path.join(os.tmpdir(),"vault-spend-mobile-browser-check");
await mkdir(output,{recursive:true});
const mime={".html":"text/html",".js":"text/javascript",".css":"text/css",".woff":"font/woff",".woff2":"font/woff2"};
const server=createServer(async(req,res)=>{
  try {
    const url=new URL(req.url,"http://localhost");
    const production=url.pathname.startsWith("/production/");
    const root=production?productionRoot:previewRoot;
    const file=path.resolve(root,"."+(production?url.pathname.slice("/production".length):url.pathname));
    if(!file.startsWith(root+path.sep))throw new Error("Outside build");
    const body=await readFile(file);res.writeHead(200,{"Content-Type":mime[path.extname(file)]??"application/octet-stream"});res.end(body);
  }catch{res.writeHead(404);res.end("Not found");}
});
await new Promise(r=>server.listen(0,"127.0.0.1",r));
const url=`http://127.0.0.1:${server.address().port}`;
const driver=spawn(process.env.MSEDGEDRIVER??path.join(os.homedir(),".cargo","bin","msedgedriver.exe"),["--port=0"],{windowsHide:true,stdio:["ignore","pipe","pipe"]});
let port;
await new Promise((resolve,reject)=>{
  const timer=setTimeout(()=>reject(new Error("Edge driver startup timed out")),15000);
  driver.once("error",reject);
  driver.stdout.on("data",chunk=>{const match=String(chunk).match(/port (\d+)/);if(match&&Number(match[1])>0){port=Number(match[1]);clearTimeout(timer);resolve();}});
});
let browser;
const checks=[];
try {
  browser=await remote({hostname:"127.0.0.1",port,path:"/",logLevel:"error",capabilities:{browserName:"MicrosoftEdge","ms:edgeOptions":{args:["--headless=new","--disable-gpu","--no-first-run"]}}});
  const cdp=async(cmd,params)=>{
    const response=await fetch(`http://127.0.0.1:${port}/session/${browser.sessionId}/ms/cdp/execute`,{method:"POST",headers:{"Content-Type":"application/json"},body:JSON.stringify({cmd,params})});
    const result=await response.json();if(result.value?.error)throw new Error(JSON.stringify(result));return result.value;
  };
  const tap=async(label)=>{const button=await browser.$(`button=${label}`);await button.click();};
  const menu=async(name,label)=>{await browser.$(`button[aria-label^="${name}: "]`).click();const options=await browser.$$("[role='menuitemradio']");for(const option of options)if((await option.$("span").getText()).trim()===label){await option.click();return;}throw new Error(`Menu ${name}: option ${label} not found`);};
  const fit=async(label)=>{
    const geometry=await browser.execute(()=>({width:innerWidth,scroll:document.documentElement.scrollWidth,outside:[...document.querySelectorAll(".mobile-account,.mobile-card,.mobile-chart button,.mobile-nav button,.menu-select-panel")].filter(e=>e.getBoundingClientRect().width&& (e.getBoundingClientRect().right>innerWidth+1||e.getBoundingClientRect().left< -1)).map(e=>e.className)}));
    assert.ok(geometry.scroll<=geometry.width+1,`${label}: page overflow ${JSON.stringify(geometry)}`);
    assert.deepEqual(geometry.outside,[],`${label}: clipped content`);checks.push(label);
  };
  await browser.url(url+"/production/mobile/index.html");
  assert.ok((await browser.$("body").getText()).includes("No saved snapshot"));checks.push("Production has no synthetic balances");
  await browser.url(url+"/mobile/preview.html");await browser.$(".mobile-nav").waitForExist();
  for(const width of [320,360,390,430,768]) {
    await cdp("Emulation.setDeviceMetricsOverride",{width,height:844,deviceScaleFactor:1,mobile:true});
    for(const tab of ["Overview","Accounts","Budget","Reports","Calculators","Settings"]) {await tap(tab);await fit(`${width}px ${tab}`);}
    await tap("Reports");assert.equal((await browser.$$(".mobile-chart button")).length,12);
    await browser.$(".mobile-chart button").click();assert.ok((await browser.$(".mobile-month-detail").getText()).includes("November 2025"));
    if(width===390)await browser.saveScreenshot(path.join(output,"reports-390-default.png"));
  }
  await browser.$("button[aria-label='Hide amounts']").click();
  assert.equal(await browser.execute(()=>[...document.querySelectorAll(".mobile-chart button")].every(b=>b.getAttribute("aria-label").includes("••••"))),true);
  assert.equal(await browser.execute(()=>document.querySelector(".mobile-viewer").innerHTML.match(/\$[\d,]+\.\d{2}/)),null);checks.push("Chart, detail and accessibility amounts hidden");
  await browser.$("button[aria-label='Show amounts']").click();
  await cdp("Emulation.setDeviceMetricsOverride",{width:390,height:844,deviceScaleFactor:1,mobile:true});
  await browser.$("button[aria-label='Settings']").click();
  for(const theme of ["Default","Futuristic","Retro"])for(const mode of ["Light","Dark"]) {
    await tap("Settings");await menu("Theme",theme);await menu("Color mode",mode);await tap("Reports");
    await fit(`${theme} ${mode}`);
    await browser.saveScreenshot(path.join(output,`reports-${theme}-${mode}.png`));
    // "Where it went" (UAT mobile.2): the donut has an on-screen key and the flow chart names each bar
    // with its amount, legible (12px or more) and inside the drawing; a phone can't hover for figures.
    await browser.execute(()=>document.querySelector(".mobile-donut").scrollIntoView({block:"start"}));
    await browser.saveScreenshot(path.join(output,`where-it-went-donut-${theme}-${mode}.png`));
    await browser.execute(()=>{const flow=[...document.querySelectorAll(".mobile-viewer details")].find(d=>d.querySelector("summary")?.textContent==="Income to spending flow");flow.open=true;flow.scrollIntoView({block:"start"});});
    const where=await browser.execute(()=>{const svg=document.querySelector(".mobile-sankey"),box=svg?.getBoundingClientRect();const texts=[...(svg?.querySelectorAll("text")??[])].map(t=>t.getBoundingClientRect());const sizes=[...(svg?.querySelectorAll("text, tspan")??[])].map(t=>parseFloat(getComputedStyle(t).fontSize)*(box.width/svg.viewBox.baseVal.width));return {key:document.querySelectorAll(".mobile-donut-key li").length,labels:texts.length,inside:texts.every(r=>r.left>=box.left-1&&r.right<=box.right+1&&r.top>=box.top-1&&r.bottom<=box.bottom+1),smallest:Math.min(...sizes)};});
    assert.ok(where.key>0&&where.labels>0&&where.inside&&where.smallest>=11.95,`${theme} ${mode}: Where it went should be labelled on screen ${JSON.stringify(where)}`);checks.push(`${theme} ${mode} Where it went labelled`);
    await browser.saveScreenshot(path.join(output,`where-it-went-${theme}-${mode}.png`));
    // Leave the page as the later steps expect it: the flow section closed and the page at the top.
    await browser.execute(()=>{for(const d of document.querySelectorAll(".mobile-viewer details"))d.open=false;window.scrollTo(0,0);});
    const axeSource=await readFile(path.resolve("node_modules/axe-core/axe.min.js"),"utf8");
    await browser.execute(axeSource);
    const violations=await browser.executeAsync(done=>window.axe.run({runOnly:{type:"tag",values:["wcag2a","wcag2aa","wcag21aa"]}}).then(result=>done(result.violations.map(v=>({id:v.id,impact:v.impact,nodes:v.nodes.map(n=>n.target)})))));
    assert.deepEqual(violations,[],`${theme} ${mode} accessibility`);checks.push(`${theme} ${mode} automated accessibility`);
  }
  await browser.refresh();assert.equal(await browser.execute(()=>document.documentElement.dataset.palette),"retro");checks.push("Theme survives reload");
  for(const tab of ["Overview","Accounts","Budget"]) {await tap(tab);await browser.saveScreenshot(path.join(output,`${tab.toLowerCase()}-390-retro-dark.png`));}
  await tap("Calculators");
  for(const tool of ["Savings & investment growth","Account accumulation & withdrawals","Combined accumulation","Debt payoff","Cash flow forecast","Goals & savings plans","Loan payment"]) {await menu("Calculator",tool);await fit(tool);}
  await menu("Calculator","Loan payment");assert.ok((await browser.$("#mobile-main").getText()).includes("$100.00"));checks.push("Zero APR loan scenario");
  await menu("Profile","My personal finances (synthetic)");assert.equal(await browser.$("h1").getText(),"Your money at a glance");checks.push("Profile switch resets page/scenarios");
  await cdp("Network.enable",{});await cdp("Network.emulateNetworkConditions",{offline:true,latency:0,downloadThroughput:0,uploadThroughput:0});
  await tap("Reports");await browser.$(".mobile-chart button").click();await tap("Calculators");await menu("Calculator","Loan payment");
  assert.ok((await browser.$("#mobile-main").getText()).includes("$100.00"));checks.push("Already-loaded viewer calculations and navigation work offline");
  console.log(JSON.stringify({browser:"Edge",checks:checks.length,passed:checks,output},null,2));
} finally {
  if(browser)await browser.deleteSession();driver.kill();await new Promise(r=>server.close(r));
}
