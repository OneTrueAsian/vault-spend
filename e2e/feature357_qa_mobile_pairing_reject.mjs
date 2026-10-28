// UAT-224 rejecting a phone (MobilePairingPrompt.tsx "Approve this phone?": Reject / Approve phone). feature167 and mobileHttpsHarness drive Approve, including the six themes; this drives Reject through the real
// button: the phone that redeemed a one-time code is left with no access (its claim cannot complete, it gets no cookie, it sees no profiles), the pending request is gone, the code cannot be reused,
// and a second phone can still be approved afterwards. Loopback test HTTPS server only; no physical phone.
import assert from "node:assert/strict";
import { launchApp } from "./harness.mjs";
import { ipc, client } from "./mobileHttpsHarness.mjs";
import { seedFixture } from "./lib/seed.mjs";

const dbDir = await seedFixture(`
cur.execute("INSERT INTO accounts (name, account_type, starting_balance) VALUES ('Mobile checking', 'checking', '1000.00')")
`);
const app = await launchApp({ dbDir });
const { browser: b } = app;
const buttons = () => b.execute(() => Array.from(document.querySelectorAll("button")).map(x => x.textContent));
try {
  const [server, certificate] = await ipc(app, "debug_start_mobile_asset_server");
  const request = client(server.origin, certificate.pem);
  const base = (await ipc(app, "list_profiles"))[0];

  // A phone redeems a one-time code; nothing is allowed until the desktop decides.
  const code = await ipc(app, "mobile_begin_pairing");
  const redeemed = await request("/api/pair/redeem", { body: { code, label: "Declined phone" } });
  assert.equal(redeemed.status, 202);
  const claim = JSON.parse(redeemed.body).claim;
  assert.equal((await request("/api/pair/complete", { body: { claim } })).status, 409, "waiting for the desktop");
  await b.waitUntil(async () => (await buttons()).includes("Reject"), { timeout: 8000, timeoutMsg: "the desktop asks 'Approve this phone?'" });
  const dialog = await b.execute(() => document.querySelector('[role="dialog"]').innerText);
  assert.ok(dialog.includes("Approve this phone?") && dialog.includes("Declined phone"), dialog);
  assert.ok((await buttons()).includes("Approve phone"), "Approve is offered beside Reject");

  // Reject.
  await b.execute(() => Array.from(document.querySelectorAll("button")).find(x => x.textContent === "Reject").click());
  await b.waitUntil(async () => (await ipc(app, "mobile_pending_pairings")).length === 0, { timeout: 8000, timeoutMsg: "the request is gone" });
  await b.waitUntil(async () => !(await b.$('[role="dialog"]').isExisting()), { timeout: 8000, timeoutMsg: "the dialog closes" });
  const completed = await request("/api/pair/complete", { body: { claim } });
  assert.notEqual(completed.status, 200, "a rejected phone cannot finish pairing: " + completed.status);
  assert.ok(!completed.headers["set-cookie"], "and gets no cookie");
  assert.equal((await request("/api/status")).status, 401, "without a cookie it sees nothing");
  assert.equal((await request("/api/pair/redeem", { body: { code, label: "Declined phone" } })).status, 403, "the used code cannot be redeemed again");

  // A different phone can still be approved afterwards.
  const code2 = await ipc(app, "mobile_begin_pairing");
  const second = await request("/api/pair/redeem", { body: { code: code2, label: "Approved phone" } });
  assert.equal(second.status, 202);
  const claim2 = JSON.parse(second.body).claim;
  await b.waitUntil(async () => (await buttons()).includes("Approve phone"), { timeout: 8000 });
  await b.execute(() => document.querySelector(".modal-overlay input[type=checkbox]").click());
  await b.execute(() => Array.from(document.querySelectorAll("button")).find(x => x.textContent === "Approve phone").click());
  await b.waitUntil(async () => (await ipc(app, "mobile_pending_pairings")).length === 0, { timeout: 8000 });
  const done = await request("/api/pair/complete", { body: { claim: claim2 } });
  assert.equal(done.status, 200, "the approved phone completes");
  const cookie = done.headers["set-cookie"][0].split(";")[0];
  const status = JSON.parse((await request("/api/status", { cookie })).body);
  assert.equal(status.profiles.length, 1);
  assert.equal(status.profiles[0].name, base.name);
  console.log("FEATURE 357 PASSED: Reject leaves the phone with no cookie, no profiles; the code is spent; a second phone can still be approved.");
} finally { await app.close(); }
