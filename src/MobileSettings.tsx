import "./MobileControls.css";
import { useCallback, useEffect, useRef, useState } from "react";

import { invoke } from "@tauri-apps/api/core";

import { save } from "@tauri-apps/plugin-dialog";

import { QRCodeSVG } from "qrcode.react";

import { MenuSelect } from "./MenuSelect";

import { ModalShell } from "./Modal";

import { errorMessage } from "./errorMessage";
import { formatEpochDateTime } from "./format";

import "./MobileSettings.css";

import { MobileSetupWizard } from "./MobileSetupWizard";

interface Status{running:boolean;origin:string|null;fingerprint:string|null;leafExpires:number|null;error:string|null}

interface Config{enabled:boolean;ipv4:string;port:number;interface:string;identity_initialized?:boolean;hostname?:string|null}

interface Device{id:string;label:string;profiles:string[];lastSeen:number|null;expires:number}

interface Profile{id:string;name:string}

function date(seconds:number|null){return seconds?formatEpochDateTime(seconds):"Not yet connected";}

export function MobileSettings(){

 const [status,setStatus]=useState<Status|null>(null),[interfaces,setInterfaces]=useState<[string,string][]>([]),[network,setNetwork]=useState(""),[port,setPort]=useState("8443");

 const [devices,setDevices]=useState<Device[]>([]),[profiles,setProfiles]=useState<Profile[]>([]),[notice,setNotice]=useState(""),[busy,setBusy]=useState(false),[pair,setPair]=useState<{url:string;expires:number}|null>(null),[now,setNow]=useState(Date.now());

 const [confirm,setConfirm]=useState<{title:string;copy:string;action:()=>Promise<unknown>}|null>(null);

 const [setupOpen,setSetupOpen]=useState(false);

 const initialized=useRef(false);

 const refresh=useCallback(async()=>{

  const [next,networks,saved,phones,names]=await Promise.all([invoke<Status>("mobile_server_status"),invoke<[string,string][]>("mobile_network_interfaces"),invoke<Config|null>("mobile_saved_config"),invoke<Device[]>("mobile_list_devices"),invoke<Profile[]>("mobile_pairing_profiles")]);

  setStatus(next);setInterfaces(networks);setDevices(phones);setProfiles(names);

  if(!initialized.current){initialized.current=true;setNetwork(saved?JSON.stringify([saved.interface,saved.ipv4]):networks[0]?JSON.stringify(networks[0]):"");setPort(String(saved?.port??8443));}

 },[]);

 useEffect(()=>{void refresh().catch(error=>setNotice(errorMessage(error)));const timer=setInterval(()=>{setNow(Date.now());void refresh().catch(()=>undefined);},5000);return()=>{clearInterval(timer);void invoke("mobile_cancel_setup").catch(()=>undefined);};},[refresh]);

 useEffect(()=>{if(pair&&now>=pair.expires){setPair(null);void invoke("mobile_cancel_pairing").catch(()=>undefined);}},[pair,now]);

 const run=async(action:()=>Promise<unknown>)=>{if(busy)return;setBusy(true);setNotice("");try{await action();await refresh();}catch(error){setNotice(errorMessage(error));}finally{setBusy(false);}};

 const config=():Config=>{const selected=interfaces.find(item=>JSON.stringify(item)===network);const number=Number(port);if(!selected||!Number.isInteger(number)||number<1024||number>65535)throw new Error("Choose an available network and a port from 1024 to 65535.");return {enabled:true,interface:selected[0],ipv4:selected[1],port:number};};

 const exportCertificate=async()=>{const path=await save({defaultPath:"vault-spend-local-root.crt",filters:[{name:"Public certificate",extensions:["crt"]}]});if(path){await invoke("mobile_export_certificate",{path});setNotice("Public certificate exported. Compare its SHA-256 fingerprint with the one shown here before trusting it on your phone.");}};

 const pairPhone=async()=>{const code=await invoke<string>("mobile_begin_pairing");setPair({url:`${status!.origin}/mobile/#pair=${code}`,expires:Date.now()+300000});};

 return <section className="card mobile-desktop-settings" aria-labelledby="mobile-settings-title" data-mobile-settings>

  <div className="card-head"><h2 id="mobile-settings-title" className="reports-section-title">Mobile snapshots</h2></div>

  <p className="modal-message-secondary">Take a saved, read-only snapshot with you. Refresh on your local Wi-Fi while Vault Spend is open and the requested profile is active and unlocked. No cloud storage.</p>

  <p role="status">{status?.running?"Local HTTPS is running":"Mobile access is stopped"}{status?.error?`. ${status.error}`:""}</p>

  <div className="modal-actions"><button disabled={busy} onClick={()=>setSetupOpen(true)}>Set up a phone</button></div>

  <details><summary>Advanced connection settings</summary>

  <div className="mobile-desktop-fields"><div><MenuSelect ariaLabel="Local network" value={network} onChange={setNetwork} options={interfaces.map(item=>({value:JSON.stringify(item),label:`${item[0]} · ${item[1]}`}))} placeholder="Choose a local network" disabled={busy} fill/></div><label>Fixed port<input aria-label="Mobile HTTPS port" type="number" min="1024" max="65535" value={port} disabled={busy} onChange={event=>setPort(event.target.value)}/></label></div>

  <p className="modal-message-secondary">Guided setup uses a stable local name. The advanced IP address method requires a stable address; changing its address or port creates a different saved-data location.</p>

  <div className="modal-actions"><button disabled={busy||!network} onClick={()=>void run(async()=>{setPair(null);await invoke("mobile_configure",{config:config()});})}>Enable local HTTPS</button><button className="modal-secondary" disabled={busy||!status?.running} onClick={()=>void run(async()=>{setPair(null);await invoke("mobile_disable");})}>Disable mobile access</button></div></details>

  {status?.origin&&<><p>Viewer address: <strong className="mobile-desktop-code">{status.origin}/mobile/</strong></p><p>Server certificate valid until {date(status.leafExpires)}. It renews automatically under the same trusted root while the service runs.</p></>}

  <details><summary>Phone setup and certificate trust</summary><ol>

   <li>Connect both devices to the same private Wi-Fi. Export the public certificate and transfer it to your phone using a method you control, such as a cable. No private key is exported.</li>

   <li>Compare the certificate’s SHA-256 fingerprint with this desktop. Trusting this root authorizes certificates signed by this installation; remove it when you stop using mobile access.</li>

   <li>On iPhone, install the certificate profile in Settings, then enable it in General → About → Certificate Trust Settings. Remove its profile in General → VPN &amp; Device Management when finished.</li>

   <li>On Android, use Settings → Security &amp; privacy → More security settings → Encryption &amp; credentials → Install a certificate → CA certificate. Names vary by device. Remove this certificate under User credentials when finished.</li>

   <li>Open the viewer address without a certificate warning. Use your browser’s Add to Home Screen option if available. Open that shortcut before pairing; its saved storage may be separate from your browser.</li>

   <li>Choose Pair a phone here, then scan the QR or enter its one-time code in that viewer. Approve the request on this desktop, choose profile access, and download your first snapshot.</li>

  </ol><p>Phone and home-screen compatibility still require device acceptance testing. Never bypass a certificate warning.</p><button className="modal-secondary" disabled={busy||!status?.origin} onClick={()=>void run(exportCertificate)}>Export public certificate</button><p className="mobile-desktop-code">SHA-256: {status?.fingerprint??"Enable local HTTPS to create the certificate."}</p></details>

  <div className="modal-actions"><button disabled={busy||!status?.running} onClick={()=>void run(async()=>{await pairPhone();})}>Pair a phone</button>{pair&&<button className="modal-secondary" disabled={busy} onClick={()=>void run(async()=>{await invoke("mobile_cancel_pairing");setPair(null);})}>Cancel pairing</button>}</div>

  {pair&&<div className="mobile-desktop-pair"><QRCodeSVG value={pair.url} size={208} marginSize={4} title="One-time phone pairing link"/><p>Scan after trusting the certificate. Expires in {Math.max(0,Math.ceil((pair.expires-now)/1000))} seconds.</p><p className="mobile-desktop-code">{pair.url}</p><p>For a home-screen shortcut, open that shortcut and paste just this one-time code:</p><code className="mobile-desktop-code">{pair.url.split("#pair=")[1]}</code></div>}

  <h3>Approved phones</h3><p>Revoke blocks future downloads. It cannot erase saved offline copies.</p>

  {devices.length===0?<p>No phones are approved.</p>:devices.map(device=><article key={device.id} className="mobile-desktop-device"><strong>{device.label}</strong><p>Last connected: {date(device.lastSeen)} (recorded at most every five minutes). Access expires: {date(device.expires)}.</p>{device.profiles.map(id=><div key={id} className="mobile-desktop-grant"><span>{profiles.find(p=>p.id===id)?.name??"Unavailable profile"}</span><button className="modal-secondary" disabled={busy} onClick={()=>setConfirm({title:"Remove profile access?",copy:`This blocks ${device.label} from downloading new snapshots of this profile. Saved copies remain on the phone.`,action:()=>invoke("mobile_remove_grant",{id:device.id,profile:id})})}>Remove profile access</button></div>)}<button className="modal-secondary" disabled={busy} onClick={()=>setConfirm({title:"Revoke phone?",copy:`This blocks future access for ${device.label}. Saved offline copies remain on the phone.`,action:()=>invoke("mobile_revoke_device",{id:device.id})})}>Revoke phone</button></article>)}

  <details><summary>Troubleshooting and reset</summary><p>Keep the desktop open, activate and unlock the requested profile, and check that both devices use the same Wi-Fi. Guest-network isolation, a changed address, an occupied port or a firewall rule may prevent access. Check the chosen interface and permit only this app’s private-network traffic if your operating system asks.</p><p>A trust reset stops mobile access, revokes every phone and creates a new certificate for the selected address. Remove the old certificate on each phone, install the replacement, and pair again. Old saved snapshots remain at their previous browser origin.</p><button className="modal-secondary" disabled={busy||!network} onClick={()=>setConfirm({title:"Reset mobile trust?",copy:"This stops mobile access and revokes all phones. Every phone must trust the new certificate and pair again. Saved offline copies cannot be erased remotely.",action:async()=>{setPair(null);await invoke("mobile_reset_trust",{config:config()});}})}>Reset mobile trust</button></details>

  {notice&&<p role="status">{notice}</p>}

  {setupOpen&&<MobileSetupWizard origin={status?.origin??null} fingerprint={status?.fingerprint??null} network={network} onNetwork={setNetwork} networks={interfaces.map(item=>({value:JSON.stringify(item),label:`${item[0]} · ${item[1]}`}))} onEnable={async()=>{setPair(null);await invoke("mobile_configure_guided",{config:config()});await refresh();}} onBegin={()=>invoke("mobile_begin_setup")} onCancelSetup={()=>invoke("mobile_cancel_setup")} onExport={exportCertificate} onPair={pairPhone} onClose={()=>setSetupOpen(false)}/>}

  {confirm&&<ModalShell title={confirm.title} onCancel={()=>{if(!busy)setConfirm(null);}} footer={<div className="modal-actions"><button className="modal-secondary" disabled={busy} onClick={()=>setConfirm(null)}>Cancel</button><button disabled={busy} onClick={()=>void run(async()=>{await confirm.action();setConfirm(null);})}>Confirm</button></div>}><p>{confirm.copy}</p></ModalShell>}

 </section>;

}
