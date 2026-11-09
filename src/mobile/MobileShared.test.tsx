// @vitest-environment jsdom
import {act,useState} from "react";
import {createRoot} from "react-dom/client";
import {expect,it} from "vitest";
import {MobileMonthField} from "./MobileShared";
(globalThis as {IS_REACT_ACT_ENVIRONMENT?:boolean}).IS_REACT_ACT_ENVIRONMENT=true;
it("chooses and clears a withdrawal month using themed menus without a native month input",()=>{
 const container=document.createElement("div");document.body.append(container);const root=createRoot(container);
 function Form(){const [value,setValue]=useState("");return <><MobileMonthField label="Withdraw month" value={value} onChange={setValue} anchorYear={2026}/><output>{value}</output></>;}
 const tap=(text:string)=>act(()=>{const button=[...container.querySelectorAll("button")].find(b=>b.getAttribute("aria-label")===text||b.textContent===text);expect(button).toBeDefined();button!.click();});
 try{act(()=>root.render(<Form/>));expect(container.querySelector("input[type=month],select")).toBeNull();
 tap("Withdraw year: 2026");tap("2027");expect(container.querySelector("output")!.textContent).toBe("2027-01");
 tap("Withdraw month: January");tap("March");expect(container.querySelector("output")!.textContent).toBe("2027-03");
 tap("Withdraw month: March");tap("No withdrawal month");expect(container.querySelector("output")!.textContent).toBe("");
 }finally{act(()=>root.unmount());container.remove();}
});
