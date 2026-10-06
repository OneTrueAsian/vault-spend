import { useCallback, useEffect, useRef, useState } from "react";
import { createMobileRepository } from "./mobileIndexedDb";
import { MobileRepository, MobileStorageError } from "./mobileRepository";
import { offlineReadiness, startOfflineShell, type OfflineShellStatus } from "./mobileOfflineStatus";
import { MobileConnectionError, readMobileStatus, logoutMobile, redeemMobilePairing, completeMobilePairing, type MobileStatus } from "./mobileConnection";
import { forgetMobileAccess, mobileConnectionMessage, MobileEpochApproval, refreshSelectedMobile } from "./mobileSession";
import { MobileViewer } from "./MobileViewer";

const defaultRepository=createMobileRepository();
type SavedState=Awaited<ReturnType<MobileRepository["load"]>>;
const empty:SavedState={snapshots:[],active:null,errors:[]};
function message(error:unknown):string{return error instanceof MobileStorageError?error.message:"Saved data could not be changed. Your previous saved copy was kept.";}

export function MobileOfflineApp({repository=defaultRepository}:{repository?:MobileRepository}) {
  const [data,setData]=useState<SavedState>(empty),[storage,setStorage]=useState(false),[loading,setLoading]=useState(true);
  const [shell,setShell]=useState<OfflineShellStatus>({ready:false,updateWaiting:false,message:"Preparing offline viewer…"});
  const [connectionOpen,setConnectionOpen]=useState(false);
  const [notice,setNotice]=useState(""),[pending,setPending]=useState<"profile"|"all"|null>(null),[busy,setBusy]=useState(false);
  const [status,setStatus]=useState<MobileStatus|null>(null),[chosen,setChosen]=useState<string|null>(null),[epoch,setEpoch]=useState<MobileEpochApproval|null>(null),[refreshing,setRefreshing]=useState(false);
  const [code,setCode]=useState(()=>{const fragment=window.location.hash;if(fragment.startsWith("#pair=")){window.history.replaceState(null,"",window.location.pathname);return /^[a-f0-9]{64}$/.test(fragment.slice(6))?fragment.slice(6):"";}return "";}),[label,setLabel]=useState("My phone"),[pairing,setPairing]=useState(false),[pairForm,setPairForm]=useState(false);
  const active=useRef<string|null>(null),refreshLock=useRef(false),pairAttempt=useRef(0),pairTimer=useRef<ReturnType<typeof setTimeout>|null>(null),epochDialog=useRef<HTMLDialogElement>(null);
  active.current=chosen??data.active;
  const dialog=useRef<HTMLDialogElement>(null),request=useRef(0);
  const reload=useCallback(async()=>{
    const current=++request.current;
    try{const saved=await repository.load();if(current===request.current){setData(saved);setStorage(true);active.current??=saved.active??(saved.snapshots[0]?`${saved.snapshots[0].installationId}/${saved.snapshots[0].profile.id}`:null);}}
    catch(error){if(current===request.current){setStorage(false);setNotice(message(error));}}
    finally{if(current===request.current)setLoading(false);}
  },[repository]);
  const refresh=useCallback(async(key:string|null=active.current,approval?:string)=>{
    if(refreshLock.current)return;refreshLock.current=true;setRefreshing(true);
    try{const next=await refreshSelectedMobile(repository,key,fetch,approval,setStatus);const selected=key??`${next.installationId}/${next.profiles[0].id}`;await repository.select(selected);setChosen(selected);setEpoch(null);setNotice("Saved snapshot updated. You can view it away from your desktop.");await reload();}
    catch(error){if(error instanceof MobileEpochApproval)setEpoch(error);setNotice(mobileConnectionMessage(error));}
    finally{refreshLock.current=false;setRefreshing(false);}
  },[repository,reload]);
  useEffect(()=>{const counter=request;let cancelled=false;void reload().then(async()=>{if(!cancelled&&await repository.remembered())await refresh();}).catch(error=>{if(!cancelled)setNotice(message(error));});const unsubscribe=repository.subscribe(()=>{void reload();});const foreground=()=>{if(document.visibilityState==="visible")void repository.remembered().then(remembered=>{if(remembered&&!cancelled)void refresh();}).catch(()=>undefined);};document.addEventListener("visibilitychange",foreground);return()=>{cancelled=true;counter.current++;unsubscribe();document.removeEventListener("visibilitychange",foreground);};},[repository,reload,refresh]);
  useEffect(()=>{if(code){setPairForm(true);setConnectionOpen(true);}},[code]);
  useEffect(()=>{if(!loading&&data.snapshots.length===0)setConnectionOpen(true);},[loading,data.snapshots.length]);
  useEffect(()=>()=>{pairAttempt.current++;if(pairTimer.current)clearTimeout(pairTimer.current);},[]);
  useEffect(()=>{if(epoch&&!epochDialog.current?.open)epochDialog.current?.showModal();if(!epoch&&epochDialog.current?.open)epochDialog.current.close();},[epoch]);
  const cancelPair=()=>{pairAttempt.current++;if(pairTimer.current)clearTimeout(pairTimer.current);setPairing(false);setCode("");};
  const startPair=async()=>{
    if(pairing||refreshing||busy)return;const attempt=++pairAttempt.current;setPairing(true);setNotice("Connecting to your desktop…");const expires=Date.now()+300000;
    try{
      const pairFence=await repository.accessFence();
      try{const old=await readMobileStatus();await logoutMobile(old.csrf);}catch(error){if(!(error instanceof MobileConnectionError&&error.code==="mobile_access_denied"))throw error;}
      if(attempt!==pairAttempt.current)return;
      const claim=await redeemMobilePairing(code.trim(),label.trim());setCode("");
      const poll=async()=>{
        if(attempt!==pairAttempt.current)return;
        if(Date.now()>=expires){setPairing(false);setNotice("Pairing expired. Create a new code on your desktop.");return;}
        try{await completeMobilePairing(claim);if(attempt!==pairAttempt.current)return;await repository.remember(pairFence);setPairing(false);setPairForm(false);setChosen(null);active.current=null;await refresh(null);}
        catch(error){if(attempt!==pairAttempt.current)return;if(error instanceof MobileConnectionError&&error.code==="mobile_confirmation_pending"){setNotice(mobileConnectionMessage(error));pairTimer.current=setTimeout(()=>void poll(),2000);}else{setPairing(false);setNotice(mobileConnectionMessage(error));}}
      };await poll();
    }catch(error){if(attempt===pairAttempt.current){setPairing(false);setNotice(mobileConnectionMessage(error));}}
  };

  useEffect(()=>{let cancelled=false;let stop:()=>void=()=>undefined;void startOfflineShell(setShell).then(cleanup=>{if(cancelled)cleanup();else stop=cleanup;});return ()=>{cancelled=true;stop();};},[]);
  useEffect(()=>{if(pending&&!dialog.current?.open)dialog.current?.showModal();if(!pending&&dialog.current?.open)dialog.current.close();},[pending]);
  const selected=data.snapshots.find(s=>`${s.installationId}/${s.profile.id}`===active.current)??(chosen?undefined:data.snapshots[0]);
  const confirm=async()=>{
    if(!pending||busy)return;
    const action=pending;setBusy(true);request.current++;cancelPair();
    try{
      if(action==="all"){setStatus(null);setEpoch(null);setChosen(null);active.current=null;setData(empty);const revoked=await forgetMobileAccess(repository);setNotice(revoked?"Saved snapshots and encryption keys were removed. Desktop access was revoked.":"Saved snapshots and encryption keys were removed. Automatic reconnection is disabled. Revoke this phone on your desktop; an offline browser cannot clear its protected access cookie.");}
      else if(selected){await repository.remove(`${selected.installationId}/${selected.profile.id}`);setChosen(null);setNotice("This profile’s saved copy and encryption key were removed. Other saved profiles remain available.");}
      setPending(null);await reload();
    }catch(error){setNotice(message(error));}
    finally{setBusy(false);}
  };
  const options=new Map(data.snapshots.map(s=>[`${s.installationId}/${s.profile.id}`,{value:`${s.installationId}/${s.profile.id}`,label:s.profile.name}]));
  status?.profiles.forEach(p=>{const key=`${status.installationId}/${p.id}`;if(!options.has(key))options.set(key,{value:key,label:`${p.name} (No saved snapshot)`});});
  const connectionControls=<section className="mobile-offline-controls" aria-label="Phone connection"><p role="status">{loading?"Opening saved snapshots…":offlineReadiness({storage,savedProfiles:data.snapshots.length,storageErrors:data.errors.length,shell})}</p>{!shell.ready&&<p className="mobile-muted">{shell.message}</p>}{notice&&<p role="status">{notice}</p>}{data.errors.map((error,i)=><p className="mobile-notice" key={i}>{error.message}</p>)}<details className="mobile-connection-options" open={connectionOpen} onToggle={event=>setConnectionOpen(event.currentTarget.open)}><summary>Connection &amp; saved data</summary><div className="mobile-storage-actions"><button disabled={busy||pairing} onClick={()=>{setConnectionOpen(true);setPairForm(!pairForm);}}>Pair this phone</button>{!selected&&status&&<button disabled={refreshing||busy||pairing} onClick={()=>void refresh()}>Download selected snapshot</button>}{selected&&<button disabled={busy} onClick={()=>setPending("profile")}>Remove saved profile</button>}<button className="mobile-danger" disabled={busy||!storage} onClick={()=>setPending("all")}>Forget this phone</button></div>{pairForm&&<form className="mobile-pair-form" onSubmit={event=>{event.preventDefault();void startPair();}}><h2>Pair with your desktop</h2><p>On the same Wi-Fi, keep Vault Spend open. Create a code in Settings → Mobile snapshots, then approve this phone and choose its profiles there. Pair in your home-screen shortcut if you will use it.</p><label>One-time pairing code<input aria-label="One-time pairing code" value={code} disabled={pairing} autoComplete="off" spellCheck={false} onChange={event=>setCode(event.target.value)}/></label><label>Phone name<input aria-label="Phone name" value={label} disabled={pairing} maxLength={60} autoComplete="off" onChange={event=>setLabel(event.target.value)}/></label><p>Access is remembered in this browser. Your saved snapshots are read only.</p><div className="mobile-storage-actions"><button className="mobile-primary" disabled={pairing||refreshing||busy||!storage||!/^[a-f0-9]{64}$/.test(code.trim())||!label.trim()} type="submit">{pairing?"Waiting for desktop approval…":"Request desktop approval"}</button>{pairing&&<button type="button" onClick={cancelPair}>Cancel pairing</button>}</div></form>}</details></section>;
  return <><MobileViewer connectionControls={connectionControls} snapshots={data.snapshots} selectedProfile={chosen??data.active??undefined} availableProfiles={[...options.values()]} refreshing={refreshing} onRefresh={()=>void refresh()} onProfileChange={id=>{setChosen(id);active.current=id;if(data.snapshots.some(s=>`${s.installationId}/${s.profile.id}`===id))void repository.select(id).catch(error=>setNotice(message(error)));setNotice("Showing the saved snapshot. Refresh while this profile is open and unlocked on your desktop.");}}/><dialog aria-labelledby="mobile-storage-title" className="mobile-storage-dialog" ref={dialog} onCancel={event=>{if(busy)event.preventDefault();else setPending(null);}}><h2 id="mobile-storage-title">{pending==="all"?"Forget this phone?":"Remove this saved profile?"}</h2><p>{pending==="all"?"This removes every saved snapshot and encryption key and revokes desktop access if reachable. Offline, also revoke this phone on the desktop. Automatic reconnection stays disabled until you pair again.":"This removes the selected profile’s saved snapshot and encryption key from this device. You will need to reconnect to download it again."}</p><p>This action does not change your desktop financial data.</p><div className="mobile-storage-actions"><button autoFocus disabled={busy} onClick={()=>setPending(null)}>Cancel</button><button className="mobile-danger" disabled={busy} onClick={()=>{void confirm();}}>{busy?"Removing…":"Remove saved data"}</button></div></dialog><dialog ref={epochDialog} aria-labelledby="mobile-epoch-title" className="mobile-storage-dialog" onCancel={()=>setEpoch(null)}><h2 id="mobile-epoch-title">Replace this saved snapshot?</h2><p>This desktop profile has a new snapshot identity. Replace only this profile’s saved copy? Other saved profiles remain available.</p><div className="mobile-storage-actions"><button autoFocus onClick={()=>setEpoch(null)}>Keep saved copy</button><button className="mobile-primary" disabled={refreshing} onClick={()=>{if(epoch)void refresh(epoch.key,epoch.previous);}}>Replace saved snapshot</button></div></dialog></>;
}
