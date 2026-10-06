import assert from "node:assert/strict";
import { readFile,writeFile } from "node:fs/promises";
import path from "node:path";
import { launchApp } from "./harness.mjs";
import { ipc,client,pair } from "./mobileHttpsHarness.mjs";
import { seedFixture } from "./lib/seed.mjs";
import { dateInMonth,monthFromNow } from "./lib/dates.mjs";
const dbDir=await seedFixture(`
cur.execute("INSERT INTO accounts (name, account_type, starting_balance) VALUES ('Mobile checking', 'checking', '1000.00')")
account = cur.lastrowid
cur.execute("INSERT INTO transactions (account_id,date,description,amount,category,fingerprint) VALUES (?, '${dateInMonth(-1,4)}','Private merchant','-125.00','Groceries','mobile-check')", (account,))
cur.execute("INSERT INTO budgets (category,period,monthly_amount,budget_group) VALUES ('Groceries','${monthFromNow(-1)}','400.00','flexible')")
cur.execute("INSERT OR IGNORE INTO budget_periods (period) VALUES ('${monthFromNow(-1)}')")
`);
const app=await launchApp({dbDir});
try {
  const [server,certificate]=await ipc(app,"debug_start_mobile_asset_server");const request=client(server.origin,certificate.pem);
  assert.equal((await request("/api/status")).status,401);
  const base=(await ipc(app,"list_profiles"))[0];
  const cookie=await pair(app,request,[base.id],"Owner phone",true);
  const status=JSON.parse((await request("/api/status",{cookie})).body);assert.equal(status.profiles.length,1);assert.equal(status.profiles[0].name,base.name);assert.notEqual(status.profiles[0].id,base.id);
  assert.equal((await request("/api/status",{cookie:"__Host-vaultspend-device="+"0".repeat(64)})).status,401);
  assert.equal((await request("/api/snapshot/"+"0".repeat(64),{cookie})).status,403);
  assert.equal((await request("/api/invoke",{cookie,body:{command:"list_accounts"}})).status,404);
  const before=await ipc(app,"debug_mobile_database_digest");
  const snapshot=await request(`/api/snapshot/${status.profiles[0].id}`,{cookie});assert.equal(snapshot.status,200,snapshot.body);
  assert.match(snapshot.headers["set-cookie"][0],/Secure; HttpOnly; SameSite=Strict; Max-Age=\d+/,"Snapshot reads must renew the remembered browser cookie consistently with server expiry");
  const data=JSON.parse(snapshot.body);assert.equal(data.profile.id,status.profiles[0].id);assert.equal(data.installationId,status.installationId);assert.equal(data.epoch,status.profiles[0].epoch);assert.ok(!("transactions" in data));assert.equal(snapshot.headers["cache-control"],"no-store");
  assert.ok(snapshot.body.includes("Mobile checking"));assert.ok(!snapshot.body.includes('"fingerprint"')&&!snapshot.body.includes('"description"'),"Raw ledger rows and fingerprints must remain desktop-only; approved merchant aggregates are allowed");
  assert.equal(await ipc(app,"debug_mobile_database_digest"),before,"HTTPS reads must not change any database pages");
  assert.equal((await request(`/api/snapshot/${status.profiles[0].id}`,{cookie})).status,429);
  await ipc(app,"create_profile",{name:"Unapproved work"});
  assert.equal(JSON.parse((await request("/api/status",{cookie})).body).profiles.length,1,"Unapproved profile metadata must remain hidden");
  const work=(await ipc(app,"list_profiles")).find(profile=>profile.is_active);
  const otherCookie=await pair(app,request,[base.id,work.id],"Second phone");
  const approved=JSON.parse((await request("/api/status",{cookie:otherCookie})).body);assert.equal(approved.profiles.length,2);
  const workGrant=approved.profiles.find(profile=>profile.name===work.name);
  await ipc(app,"switch_profile",{id:base.id});
  assert.equal((await request(`/api/snapshot/${workGrant.id}`,{cookie:otherCookie})).status,409,"Inactive profiles cannot be refreshed or opened by the phone");
  assert.equal((await request(`/api/snapshot/${workGrant.id}`,{cookie:otherCookie,body:{command:"unlock"}})).status,405);
  await ipc(app,"delete_profile",{id:work.id});
  assert.equal((await request(`/api/snapshot/${workGrant.id}`,{cookie:otherCookie})).status,403,"Deleted profiles lose future grants");
  const otherDevice=(await ipc(app,"mobile_list_devices")).at(-1);
  await ipc(app,"mobile_remove_grant",{id:otherDevice.id,profile:base.id});
  assert.equal(JSON.parse((await request("/api/status",{cookie:otherCookie})).body).profiles.length,0);
  await ipc(app,"mobile_revoke_device",{id:otherDevice.id});
  assert.equal((await request("/api/status",{cookie:otherCookie})).status,401);
  const registryPath=path.join(app.testDbDir,"mobile-devices.protected");const original=await readFile(registryPath);const damaged=Buffer.from(original);damaged[Math.floor(damaged.length/2)]^=1;await writeFile(registryPath,damaged);
  assert.equal((await request("/api/status",{cookie})).status,401,"Corrupt protected device storage must fail closed");
  await assert.rejects(ipc(app,"mobile_begin_pairing"));
  await writeFile(registryPath,original);assert.equal((await request("/api/status",{cookie})).status,200);
  assert.equal((await request("/api/status",{cookie:cookie+"; "+cookie})).status,401,"Duplicate credentials are ambiguous and must be denied");
  assert.equal((await request("/api/logout",{cookie,body:{}})).status,403);
  const loggedOut=await request("/api/logout",{cookie,body:{},headers:{"X-Vault-CSRF":status.csrf}});assert.equal(loggedOut.status,200);assert.match(loggedOut.headers["set-cookie"][0],/Max-Age=0/);
  assert.equal((await request("/api/status",{cookie})).status,401);
  const protectedFile=await readFile(path.join(app.testDbDir,"mobile-devices.protected"));assert.ok(!protectedFile.includes(Buffer.from(cookie.split("=")[1])));
  console.log("PASS mobile pairing confirmation, verifier-only cookies, explicit grants, read-only financial projection, metadata privacy, limits and logout");
}finally{await app.close();}
