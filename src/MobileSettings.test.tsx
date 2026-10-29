// @vitest-environment jsdom
import { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, vi, test, expect } from "vitest";
import { MobileSettings } from "./MobileSettings";
import { QuickSettingsContext } from "./SettingStar";
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
test("the card is anchored as mobile-snapshots, keeps its h2 title and offers a star", async () => {
 await act(async () => root.render(<QuickSettingsContext.Provider value={{ has: () => false, toggle: () => undefined }}><MobileSettings /></QuickSettingsContext.Provider>));
 const card = document.querySelector<HTMLElement>('[data-setting-card="mobile-snapshots"]')!;
 expect(card.hasAttribute("data-mobile-settings")).toBe(true);
 expect(card.querySelector("h2.reports-section-title")?.textContent?.trim()).toBe("Mobile snapshots");
 expect(card.querySelector('[aria-label="Add Mobile snapshots to Quick settings"]')).not.toBeNull();
});

test("Set up a phone sits right under the access status, and Pair a phone lives inside the phone setup section", async () => {
 await act(async () => root.render(<MobileSettings />));
 const card = document.querySelector<HTMLElement>("[data-mobile-settings]")!;
 const status = card.querySelector("[role=status]")!;
 const setUp = button("Set up a phone");
 expect(status.closest(".mobile-desktop-status")?.nextElementSibling?.contains(setUp)).toBe(true);
 const setupSection = [...card.querySelectorAll("details")].find((d) => d.querySelector("summary")?.textContent === "Phone setup and certificate trust")!;
 expect(setupSection.contains(button("Pair a phone"))).toBe(true);
 expect(card.querySelectorAll("details")[0].contains(button("Pair a phone"))).toBe(false);
});

test("starting a pairing opens the setup section so the code is visible", async () => {
 await act(async () => root.render(<MobileSettings />));
 const setupSection = [...document.querySelectorAll("details")].find((d) => d.querySelector("summary")?.textContent === "Phone setup and certificate trust")!;
 expect(setupSection.open).toBe(false);
 await act(async () => button("Pair a phone").click());
 expect(setupSection.open).toBe(true);
 expect(setupSection.querySelector("svg")).not.toBeNull();
});
