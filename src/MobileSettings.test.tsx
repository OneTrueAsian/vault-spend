// @vitest-environment jsdom
import { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, vi, test, expect } from "vitest";
import { MobileSettings } from "./MobileSettings";
const { invoke, save }=vi.hoisted(()=>({invoke:vi.fn(),save:vi.fn()}));
vi.mock("@tauri-apps/api/core",()=>({invoke}));
vi.mock("@tauri-apps/plugin-dialog",()=>({save}));
(globalThis as {IS_REACT_ACT_ENVIRONMENT?:boolean}).IS_REACT_ACT_ENVIRONMENT=true;
let root:Root,container:HTMLDivElement;
beforeEach(()=>{container=document.createElement("div");document.body.append(container);root=createRoot(container);invoke.mockReset();save.mockReset();invoke.mockImplementation((command:string)=>Promise.resolve(command==="mobile_server_status"?{running:true,origin:"https://192.168.1.4:8443",fingerprint:"PUBLIC",leafExpires:1900000000,error:null}:command==="mobile_network_interfaces"?[["Wi-Fi","192.168.1.4"]]:command==="mobile_list_devices"?[{id:"phone",label:"My phone",profiles:["personal"],lastSeen:1,expires:1900000000}]:command==="mobile_pairing_profiles"?[{id:"personal",name:"Personal"}]:command==="mobile_begin_pairing"?"a".repeat(64):command==="mobile_public_certificate"?{pem:"PUBLIC ROOT",fingerprint:"PUBLIC"}:null));});
afterEach(()=>{act(()=>root.unmount());container.remove();});
function button(name:string){return [...document.querySelectorAll("button")].find(b=>b.textContent===name)!;}
test("network remains opt in, uses a themed menu and creates an ephemeral QR",async()=>{
 await act(async()=>root.render(<MobileSettings/>));expect(invoke).not.toHaveBeenCalledWith("mobile_configure",expect.anything());
 expect(document.querySelector("select")).toBeNull();expect(document.body.textContent).toContain("Personal");
 await act(async()=>button("Pair a phone").click());expect(document.querySelector("svg")).not.toBeNull();expect(document.body.textContent).toContain("/mobile/#pair="+"a".repeat(64));
 await act(async()=>button("Cancel pairing").click());expect(document.querySelector("svg")).toBeNull();expect(invoke).toHaveBeenCalledWith("mobile_cancel_pairing");
});
test("revoke requires a confirmation and exports only the public certificate",async()=>{
 await act(async()=>root.render(<MobileSettings/>));await act(async()=>button("Revoke phone").click());expect(invoke).not.toHaveBeenCalledWith("mobile_revoke_device",expect.anything());
 await act(async()=>button("Confirm").click());expect(invoke).toHaveBeenCalledWith("mobile_revoke_device",{id:"phone"});
 save.mockResolvedValue("public.crt");await act(async()=>button("Export public certificate").click());expect(invoke).toHaveBeenCalledWith("mobile_export_certificate",{path:"public.crt"});
});
