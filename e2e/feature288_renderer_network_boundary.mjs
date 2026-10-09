// CSP runtime refusal, complementary to the source import/capability guard.
import assert from 'node:assert/strict';
import { launchApp } from './harness.mjs';
const app=await launchApp();
try {
 const result=await app.browser.executeAsync(done=>{
  const blocked='https://example.invalid/vault-spend-network-fixture';
  const violations=[];const listener=e=>violations.push({directive:e.effectiveDirective,uri:e.blockedURI});
  document.addEventListener('securitypolicyviolation',listener);
  (async()=>{
   const invoke=window.__TAURI_INTERNALS__.invoke;
   const version=await invoke('plugin:app|version');
   const fetcher=window.fetch.bind(window);let refused=false;
   try{await fetcher(blocked);}catch{refused=true;}
   const deadline=performance.now()+3000;
   while(!violations.some(v=>v.directive==='connect-src')&&performance.now()<deadline)await new Promise(r=>setTimeout(r,20));
   const afterVersion=await invoke('plugin:app|version');
   done({version,afterVersion,refused,violations});
  })().catch(e=>done({error:String(e)})).finally(()=>document.removeEventListener('securitypolicyviolation',listener));
 });
 assert.equal(result.error,undefined);assert.match(result.version,/^\d+\.\d+\.\d+/);
 assert.equal(result.afterVersion,result.version);
 assert.equal(result.refused,true);
 assert.ok(result.violations.some(v=>v.directive==='connect-src'&&v.uri.startsWith('https://example.invalid')),'a real connect-src violation must accompany refusal; DNS failure alone is insufficient');
 console.log('FEATURE 288 PASSED: compiled CSP rejects aliased renderer fetch and permits package-owned IPC');
}finally{await app.close();}
