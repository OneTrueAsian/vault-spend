// Real compiled Tauri lifecycle + HTTPS. Trust is scoped to this Node client only.
import assert from "node:assert/strict";
import https from "node:https";
import net from "node:net";
import tls from "node:tls";
import { readFile, unlink, writeFile } from "node:fs/promises";
import path from "node:path";
import { launchApp } from "./harness.mjs";
const app=await launchApp();
const invoke=async(command,args={})=>app.browser.executeAsync((command,args,done)=>window.__TAURI_INTERNALS__.invoke(command,args).then(value=>done({ok:true,value}),error=>done({ok:false,error})),command,args).then(result=>{assert.ok(result.ok,String(result.error));return result.value;});
const request=(origin,pem,route="/mobile/index.html",headers={})=>new Promise((resolve,reject)=>{
  const req=https.get(origin+route,{ca:pem,rejectUnauthorized:true,headers,timeout:3000,family:4,checkServerIdentity:(_name,certificate)=>tls.checkServerIdentity(new URL(origin).hostname,certificate)},res=>{const chunks=[];res.on("data",c=>chunks.push(c));res.on("end",()=>resolve({status:res.statusCode,headers:res.headers,body:Buffer.concat(chunks)}));});req.on("error",reject);req.on("timeout",()=>req.destroy(new Error("HTTPS timeout")));
});
let origin;
try {
  assert.equal((await invoke("mobile_server_status")).running,false);
  const [status,publicCertificate]=await invoke("debug_start_mobile_asset_server");origin=status.origin;
  assert.equal(status.running,true);assert.ok(publicCertificate.pem.includes("BEGIN CERTIFICATE"));assert.ok(!JSON.stringify(publicCertificate).includes("PRIVATE KEY"));
  const root=await request(origin,publicCertificate.pem);assert.equal(root.status,200);assert.ok(root.body.toString().includes("../assets/"));assert.ok(root.headers["content-security-policy"].includes("script-src 'self'"));
  const worker=await request(origin,publicCertificate.pem,"/mobile/sw.js");assert.equal(worker.status,200);assert.ok(worker.body.toString().includes("vault-mobile-shell-"));
  for(const route of ["/api/snapshot","/config.json","/mobile-certificates.protected","/mobile/%2e%2e/config.json","/mobile/preview.html","/mobile/storage-test.html"]){const response=await request(origin,publicCertificate.pem,route);assert.equal(response.status,404,route);assert.equal(response.headers["cache-control"],"no-store");}
  assert.equal((await request(origin,publicCertificate.pem,"/mobile/index.html",{Host:"attacker.invalid"})).status,400);
  assert.equal((await request(origin,publicCertificate.pem,"/mobile/index.html",{Origin:"https://attacker.invalid"})).status,400);
  await assert.rejects(request(origin,null));
  await assert.rejects(request(origin.replace("127.0.0.1","localhost"),publicCertificate.pem),{code:"ERR_TLS_CERT_ALTNAME_INVALID"});
  const protectedFile=await readFile(path.join(app.testDbDir,"mobile-certificates.protected"));assert.ok(!protectedFile.includes(Buffer.from("PRIVATE KEY")));assert.ok(!protectedFile.includes(Buffer.from("BEGIN CERTIFICATE")));
  // Desktop still answers ordinary financial commands while the public listener is running.
  assert.ok(Array.isArray(await invoke("list_accounts")));
  await invoke("mobile_disable");assert.equal((await invoke("mobile_server_status")).running,false);await assert.rejects(request(origin,publicCertificate.pem));
  const keyPath=path.join(app.testDbDir,"mobile-certificates.protected");
  await unlink(keyPath);await assert.rejects(invoke("debug_start_mobile_asset_server"));await assert.rejects(readFile(keyPath));await writeFile(keyPath,protectedFile);
  const [again,reopened]=await invoke("debug_start_mobile_asset_server");origin=again.origin;assert.equal(reopened.fingerprint,publicCertificate.fingerprint);assert.equal(reopened.installationId,publicCertificate.installationId);assert.equal((await request(origin,reopened.pem)).status,200);
  // A slow handshake must not keep the listener alive after actual desktop exit.
  const slow=net.connect(new URL(origin).port,"127.0.0.1");slow.on("error",()=>{});await new Promise(r=>slow.once("connect",r));
  await Promise.race([invoke("debug_quit_app").catch(()=>{}),new Promise(resolve=>setTimeout(resolve,2000))]);
  let stopped=false;for(let attempt=0;attempt<20;attempt++){try{await request(origin,reopened.pem);await new Promise(resolve=>setTimeout(resolve,50));}catch{stopped=true;break;}}
  slow.destroy();assert.ok(stopped,"Desktop Quit must close the HTTPS listener");
  console.log("PASS compiled mobile HTTPS: protected identity, packaged assets, scoped trust, boundaries, desktop usability, stop/restart and app exit");
} finally { await app.close(); }
