import { createHash } from "node:crypto";
import type { Plugin } from "vite";
import { mobileIcon } from "./mobile-icons";

export function mobileOfflineBuild(entry:string):Plugin {
  return {
    name:"versioned-offline-shell",
    transformIndexHtml(){return [{tag:"link",attrs:{rel:"manifest",href:"./manifest.webmanifest"}},{tag:"link",attrs:{rel:"apple-touch-icon",href:"./icon-192.png"}},{tag:"meta",attrs:{name:"theme-color",content:"#233d7b"}}];},
    generateBundle:{order:"post",handler(_options,bundle){
      const extras:Record<string,string|Uint8Array>={"mobile/icon-192.png":mobileIcon(192),"mobile/icon-512.png":mobileIcon(512),"mobile/manifest.webmanifest":JSON.stringify({name:"Vault Spend",short_name:"Vault Spend",id:"./",start_url:`./${entry.split("/").pop()}`,scope:"./",display:"standalone",background_color:"#f5f7fb",theme_color:"#233d7b",icons:[{src:"./icon-192.png",sizes:"192x192",type:"image/png",purpose:"any"},{src:"./icon-512.png",sizes:"512x512",type:"image/png",purpose:"any"}]})};
      for(const [fileName,source] of Object.entries(extras))this.emitFile({type:"asset",fileName,source});
      const files=[...new Set([...Object.keys(bundle),...Object.keys(extras),entry])].filter(f=>!f.endsWith(".map"));
      const digests:Record<string,string>={};
      for(const file of files){const asset=bundle[file];const content=asset?(asset.type==="chunk"?asset.code:asset.source):extras[file];if(content===undefined)this.error(`Missing offline resource: ${file}`);digests[file]=createHash("sha256").update(content).digest("hex");}
      const policy=String.raw`
const cacheName=__CACHE_NAME__;
const assets=__ASSETS__.map(file=>new URL('../'+file,self.registration.scope).href);
const expected=new Map(Object.entries(__DIGESTS__).map(([file,hash])=>[new URL('../'+file,self.registration.scope).href,hash]));
const allowed=new Set(assets);
async function fetchStatic(url){
  const response=await fetch(new Request(url,{cache:'reload',credentials:'omit'}));
  if(!response.ok||response.type==='opaque'||response.redirected)throw new Error('Incomplete offline assets');
  const bytes=await response.clone().arrayBuffer(),digest=await crypto.subtle.digest('SHA-256',bytes);
  const hash=Array.from(new Uint8Array(digest),n=>n.toString(16).padStart(2,'0')).join('');
  if(hash!==expected.get(url))throw new Error('Offline asset version changed');
  return response;
}
const shell=new URL(__ENTRY__,self.registration.scope).href;
self.addEventListener('install',event=>event.waitUntil((async()=>{
  const existed=(await caches.keys()).includes(cacheName);
  try{
    const cache=await caches.open(cacheName);
    for(const url of assets){
      const response=await fetchStatic(url);
      await cache.put(url,response);
    }
  }catch(error){if(!existed)await caches.delete(cacheName);throw error;}
  // No skipWaiting: a new version never takes over an open viewer with an old asset graph.
})()));
self.addEventListener('activate',event=>event.waitUntil((async()=>{
  const names=(await caches.keys()).filter(name=>name.startsWith('vault-mobile-shell-'));
  // Keep one previous complete version for recovery; this worker never caches API responses.
  for(const name of names.slice(0,-2))if(name!==cacheName)await caches.delete(name);
  await self.clients.claim();
})()));
self.addEventListener('message',event=>{
  if(!['offline-status','repair-offline-shell'].includes(event.data?.type)||!event.ports[0])return;
  event.waitUntil((async()=>{
    let ready=false;
    try{const cache=await caches.open(cacheName);if(event.data.type==='repair-offline-shell'){for(const url of assets){if((await cache.match(url))?.ok)continue;try{const response=await fetchStatic(url);await cache.put(url,response);}catch{}}}ready=(await Promise.all(assets.map(async url=>(await cache.match(url))?.ok===true))).every(Boolean);}catch{}
    event.ports[0].postMessage({type:'offline-status',ready,cacheName});
  })());
});
self.addEventListener('fetch',event=>{
  const request=event.request,url=new URL(request.url);
  if(request.method!=='GET'||url.origin!==self.location.origin||url.search)return;
  const isShell=request.mode==='navigate'&&(url.href===self.registration.scope||url.href===shell);
  // Explicit allowlist only. API/auth/sync and unknown routes remain network-only, even offline.
  if(!isShell&&!allowed.has(url.href))return;
  event.respondWith((async()=>{
    const cache=await caches.open(cacheName),cached=await cache.match(isShell?shell:url.href);
    return cached??fetch(request);
  })());
});
`;
      const hash=createHash("sha256").update(policy).update(JSON.stringify(extras));
      for(const file of Object.values(bundle))hash.update(file.fileName).update(file.type==="chunk"?file.code:file.source);
      const version=hash.digest("hex").slice(0,20);
      const source=policy.replace("__CACHE_NAME__",JSON.stringify(`vault-mobile-shell-${version}`)).replace("__ASSETS__",JSON.stringify(files)).replace("__DIGESTS__",JSON.stringify(digests)).replace("__ENTRY__",JSON.stringify(entry.split("/").pop()));
      this.emitFile({type:"asset",fileName:"mobile/sw.js",source});
    }},
  };
}
