import assert from "node:assert/strict";
import { launchApp } from "./harness.mjs";
import { seedFixture } from "./lib/seed.mjs";
import { invoke } from "./lib/change-password.mjs";
import { enableProtectionThroughUI } from "./lib/protection.mjs";

// Native contract acceptance only: M5 has no routed question-to-result flow yet.
// Real linked money-in counts once for the selected investment account; other account evidence never leaks.
const dbDir = await seedFixture(String.raw`
import datetime
today=datetime.date.today();past=(today.replace(day=1)-datetime.timedelta(days=1)).replace(day=1)
ids=[]
for name,kind in [('M5 IRA','investment'),('M5 Other','investment'),('M5 Checking','checking')]:
    cur.execute("INSERT INTO accounts(name,account_type,starting_balance) VALUES(?,?,'0')",(name,kind));ids.append(cur.lastrowid)
def add(account,amount,date,tag,deleted=None):
    cur.execute("INSERT INTO transactions(account_id,date,description,amount,fingerprint,deleted_at) VALUES(?,?,?,?,?,?)",(account,date.isoformat(),tag,amount,tag,deleted));return cur.lastrowid
out=add(ids[2],'-150',past,'transfer out');incoming=add(ids[0],'150',past,'transfer in')
cur.execute('INSERT INTO transfer_links(out_transaction_id,in_transaction_id) VALUES(?,?)',(out,incoming))
add(ids[0],'-20',past,'withdrawal');add(ids[0],'999',today+datetime.timedelta(days=2),'future');add(ids[0],'700',past,'deleted',today.isoformat())
add(ids[1],'987654',past,'unrelated private value')
cur.execute("INSERT INTO holdings(account_id,symbol,name,shares,price,cost_basis) VALUES(?,'FAKE','fixture','100','2.5','0')",(ids[0],))
cur.execute("INSERT INTO investment_plans(account_id,monthly_contribution,annual_return_pct) VALUES(?,'0','0')",(ids[0],))
cur.execute("UPDATE app_settings SET inflation_pct='0' WHERE id=1")
`);
const app = await launchApp({ dbDir }); const b = app.browser;
try {
  const origin = (await invoke(b, "get_transaction_context")).ok;
  const auth = { expectedGeneration: origin.generation, expectedSessionRevision: origin.sessionRevision };
  const list = await invoke(b, "get_ask_vault_retirement_accounts", { ...auth, request: { contractVersion: 1, expectedRevision: null } });
  assert.ok(list.ok, list.error); assert.deepEqual(list.ok.accounts.map(a => a.name), ["M5 IRA", "M5 Other"]);
  assert.deepEqual(Object.keys(list.ok).sort(), ["accounts", "asOf", "context", "contractVersion", "revision"]);
  for (const row of list.ok.accounts) assert.deepEqual(Object.keys(row).sort(), ["id", "name"]);
  const request = { contractVersion: 1, accountId: list.ok.accounts[0].id, expectedRevision: list.ok.revision };
  const result = await invoke(b, "get_ask_vault_retirement_context", { ...auth, request });
  assert.ok(result.ok, result.error); assert.deepEqual(result.ok.worth, { amount: "250", basis: "holdings" });
  assert.deepEqual(result.ok.contribution, { kind: "saved", monthlyAmount: "0" });
  assert.deepEqual(result.ok.returnAssumption, { kind: "stored-plan", annualPct: "0" });
  assert.deepEqual(result.ok.inflation, { kind: "stored", pct: "0" });
  assert.deepEqual(result.ok.revision, list.ok.revision); assert.deepEqual(result.ok.context, list.ok.context);
  assert.ok(!JSON.stringify(result.ok).includes("987654"), "no unrelated account evidence");
  assert.deepEqual((await invoke(b, "get_ask_vault_retirement_context", { ...auth, request })).ok, result.ok, "exact repeat and no revision writes");
  for (const bad of [{ ...request, accountId: 0 }, { ...request, accountId: 999999 }, { ...request, contractVersion: 2 }, { ...request, asOf: list.ok.asOf }, { ...request, expectedRevision: { local: 99999999, external: 99999 } }])
    assert.ok((await invoke(b, "get_ask_vault_retirement_context", { ...auth, request: bad })).error, "invalid/absent/stale requests refuse");
  // History read on the other account has no saved plan and is not replaced by saved or default zero.
  const other = await invoke(b, "get_ask_vault_retirement_context", { ...auth, request: { ...request, accountId: list.ok.accounts[1].id } });
  assert.ok(other.ok, other.error); assert.equal(other.ok.contribution.kind, "history"); assert.equal(other.ok.contribution.monthlyAmount, "987654");
  assert.deepEqual(other.ok.returnAssumption, { kind: "application-default", annualPct: "7" });
  await b.$("button*=Settings").click(); const password = "m5 native fixture password";
  await enableProtectionThroughUI(b, password);
  await b.waitUntil(async () => (await b.$(".page").getText()).includes("Password protection: On"), { timeout: 15000 });
  const protectedOrigin = (await invoke(b, "get_transaction_context")).ok;
  const protectedAuth = { expectedGeneration: protectedOrigin.generation, expectedSessionRevision: protectedOrigin.sessionRevision };
  const readArgs = { ...protectedAuth, request: { ...request, expectedRevision: null } };
  assert.ok((await invoke(b, "get_ask_vault_retirement_context", readArgs)).ok);
  assert.equal((await invoke(b, "debug_apply_system_session_event", { event: "locked" })).ok, true);
  await b.$("[data-profile-lock-screen]").waitForExist({ timeout: 10000 });
  assert.ok((await invoke(b, "get_ask_vault_retirement_context", readArgs)).error);
  assert.ok((await invoke(b, "get_ask_vault_retirement_accounts", { ...protectedAuth, request: { contractVersion: 1, expectedRevision: null } })).error);
  await b.$("#password-form-field").setValue(password); await b.$("button=Unlock").click(); await b.$(".brand-word").waitForExist({ timeout: 10000 });
  assert.ok((await invoke(b, "get_ask_vault_retirement_context", readArgs)).error, "old origin cannot read after unlock");
  console.log("FEATURE 303 M5 NATIVE CONTEXT CONTRACT PASSED (no routed M5 UI claimed)");
} finally { await app.close(); }
