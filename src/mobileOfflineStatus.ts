export interface OfflineShellStatus { ready:boolean;updateWaiting:boolean;message:string }
export interface OfflineReadiness { storage:boolean;savedProfiles:number;storageErrors:number;shell:OfflineShellStatus }
export function offlineReadiness(state:OfflineReadiness):string {
  if(!state.storage)return "Encrypted storage is unavailable. Reconnect using your desktop web address or allow browser storage.";
  if(state.storageErrors)return "Some saved copies could not be opened. Reconnect to refresh them or remove the saved copies.";
  if(!state.savedProfiles)return "No snapshot saved on this device. Connect to your desktop to download one.";
  if(!state.shell.ready)return "Snapshot saved. Offline setup is incomplete; keep this page open while connected.";
  return state.shell.updateWaiting?"Ready offline. A viewer update is waiting; close other viewer tabs and reopen when convenient.":"Ready offline. Showing saved snapshots.";
}
/** Confirm the controlling worker's completed cache, rather than treating registration as ready. */
export async function startOfflineShell(onStatus:(status:OfflineShellStatus)=>void):Promise<()=>void> {
  if(!globalThis.isSecureContext||!("serviceWorker" in navigator)){
    onStatus({ready:false,updateWaiting:false,message:"Offline setup needs a trusted web address and a browser that supports offline storage."});return ()=>undefined;
  }
  let stopped=false;
  const listeners:Array<()=>void>=[];
  try{
    const registration=await navigator.serviceWorker.register(new URL("./sw.js",document.baseURI),{scope:new URL("./",document.baseURI).pathname,updateViaCache:"none"});
    const check=async(repair=false)=>{
      if(stopped)return;
      const controller=navigator.serviceWorker.controller;
      if(!controller){onStatus({ready:false,updateWaiting:!!registration.waiting,message:"Preparing offline viewer…"});return;}
      const ready=await new Promise<boolean>(resolve=>{
        const channel=new MessageChannel();const timer=setTimeout(()=>{channel.port1.close();resolve(false);},4000);
        channel.port1.onmessage=event=>{clearTimeout(timer);channel.port1.close();resolve(event.data?.type==="offline-status"&&event.data.ready===true);};
        try{controller.postMessage({type:repair?"repair-offline-shell":"offline-status"},[channel.port2]);}catch{clearTimeout(timer);channel.port1.close();resolve(false);}
      });
      if(!stopped)onStatus({ready,updateWaiting:!!registration.waiting,message:ready?"Offline shell is ready.":"Offline assets are incomplete. Reconnect and reopen the viewer."});
    };
    const changed=()=>{void check();};
    const online=()=>{void check(true);};
    const watch=()=>{const installing=registration.installing;if(installing){installing.addEventListener("statechange",changed);listeners.push(()=>installing.removeEventListener("statechange",changed));}};
    registration.addEventListener("updatefound",watch);navigator.serviceWorker.addEventListener("controllerchange",changed);globalThis.addEventListener("online",online);
    listeners.push(()=>registration.removeEventListener("updatefound",watch),()=>navigator.serviceWorker.removeEventListener("controllerchange",changed),()=>globalThis.removeEventListener("online",online));
    watch();void check(true);
  }catch{
    if(!stopped)onStatus({ready:false,updateWaiting:false,message:"Offline setup could not finish. Reconnect and reopen the viewer."});
  }
  return ()=>{stopped=true;listeners.forEach(remove=>remove());};
}
