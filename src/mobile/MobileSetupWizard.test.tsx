// @vitest-environment jsdom
import {act} from "react";
import {createRoot,type Root} from "react-dom/client";
import {afterEach,beforeEach,expect,test,vi} from "vitest";
import {MobileSetupWizard} from "./MobileSetupWizard";
(globalThis as {IS_REACT_ACT_ENVIRONMENT?:boolean}).IS_REACT_ACT_ENVIRONMENT=true;
let root:Root,container:HTMLDivElement;
const enable=vi.fn(),begin=vi.fn(),cancel=vi.fn(),pair=vi.fn(),close=vi.fn(),exportCertificate=vi.fn();
function button(name:string){return [...document.querySelectorAll("button")].find(b=>b.textContent===name)!;}
async function click(name:string){await act(async()=>button(name).click());}
async function render(origin:string|null="https://vault-spend-123456789012345678901234567890ab.local:8443"){
 await act(async()=>root.render(<MobileSetupWizard origin={origin} fingerprint="FULL FINGERPRINT" network="home" onNetwork={()=>undefined} networks={[{value:"home",label:"Home network"}]} onEnable={enable} onBegin={begin} onCancelSetup={cancel} onExport={exportCertificate} onPair={pair} onClose={close}/>));
}
beforeEach(()=>{container=document.createElement("div");document.body.append(container);root=createRoot(container);for(const fn of [enable,begin,cancel,pair,close,exportCertificate])fn.mockReset();enable.mockResolvedValue(undefined);begin.mockResolvedValue({url:"http://192.168.1.2:9999/setup/public/",expires:Date.now()/1000+600});cancel.mockResolvedValue(undefined);pair.mockResolvedValue(undefined);exportCertificate.mockResolvedValue(undefined);});
afterEach(()=>{act(()=>root.unmount());container.remove();});
test("does not enable or expose a bootstrap until the user reaches and confirms network setup",async()=>{
 await render();expect(enable).not.toHaveBeenCalled();expect(begin).not.toHaveBeenCalled();
 await click("Let’s get started");await click("My phone is on the home Wi-Fi");await click("Enable and show setup code");
 expect(enable).toHaveBeenCalledTimes(1);expect(begin).toHaveBeenCalledTimes(1);expect(document.querySelector("svg")).not.toBeNull();
 await click("The phone setup page is open");expect(button("The certificate is verified").disabled).toBe(true);
 expect(document.body.textContent).toContain("actual certificate");expect(document.body.textContent).toContain("direct transfer");
 await act(async()=>{document.querySelector<HTMLInputElement>(".mobile-setup-check input")!.click();});
 await click("The certificate is verified");await click("The certificate is installed");await click("Trust is turned on");
 await click("The viewer opened without a warning");await click("Create pairing QR");
 expect(cancel).toHaveBeenCalledOnce();expect(pair).toHaveBeenCalledOnce();expect(close).toHaveBeenCalledOnce();
});
test("existing IP origin requires explicit migration understanding before enable",async()=>{
 await render("https://192.168.1.2:8443");await click("Let’s get started");await click("My phone is on the home Wi-Fi");
 expect(button("Enable and show setup code").disabled).toBe(true);expect(enable).not.toHaveBeenCalled();
 await act(async()=>document.querySelector<HTMLInputElement>(".mobile-setup-check input")!.click());
 await click("Enable and show setup code");expect(enable).toHaveBeenCalledOnce();
});
test("native failures keep the guide at setup and never manufacture a successful QR or pairing",async()=>{
 enable.mockRejectedValue("The selected network is unavailable.");
 await render();await click("Let’s get started");await click("My phone is on the home Wi-Fi");await click("Enable and show setup code");
 expect(document.querySelector('[role="alert"]')?.textContent).toContain("unavailable");
 expect(begin).not.toHaveBeenCalled();expect(pair).not.toHaveBeenCalled();expect(document.querySelector("svg")).toBeNull();
});


test("direct-transfer export stays in verification and visible close cancels setup",async()=>{
 await render();await click("Let’s get started");await click("My phone is on the home Wi-Fi");await click("Enable and show setup code");await click("The phone setup page is open");
 await click("Export certificate for direct transfer");expect(exportCertificate).toHaveBeenCalledOnce();expect(button("The certificate is verified").disabled).toBe(true);
 await click("Close guide");expect(cancel).toHaveBeenCalledOnce();expect(close).toHaveBeenCalledOnce();expect(pair).not.toHaveBeenCalled();
});
