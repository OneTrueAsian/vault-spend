// @vitest-environment jsdom
import { act } from "react";
import { createRoot } from "react-dom/client";
import { afterEach, expect, it, vi } from "vitest";
import { useFinancialRead } from "./useFinancialRead";
(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;
const mocks = vi.hoisted(() => ({ dispose: vi.fn() }));
vi.mock("./financialReads", () => ({ createFinancialClient: () => ({ dispose: mocks.dispose }) }));
const pending = <T,>() => { let resolve!: (value:T)=>void; const promise=new Promise<T>(r=>{resolve=r;});return {promise,resolve}; };
const host=document.createElement("div"); document.body.append(host);
let root:ReturnType<typeof createRoot>,owner:ReturnType<typeof useFinancialRead<string>>;
function Probe(){owner=useFinancialRead<string>();return <span>{owner.data?.value}</span>;}
afterEach(()=>{act(()=>root?.unmount());vi.clearAllMocks();});
async function mount(){root=createRoot(host);await act(async()=>root.render(<Probe/>));}
it("publishes the latest range and refuses an older completion",async()=>{
 await mount();const old=pending<string>(),next=pending<string>();let first!:Promise<string>,second!:Promise<string>;
 await act(async()=>{first=owner.refresh("old",()=>old.promise);second=owner.refresh("new",()=>next.promise);});
 const refusal=expect(first).rejects.toMatchObject({code:"superseded"});
 await act(async()=>{next.resolve("new totals");await second;old.resolve("old totals");await refusal;});
 expect(owner.data).toEqual({key:"new",value:"new totals"});
});
it("retains the previous model on failure and supports an explicit retry",async()=>{
 await mount();await act(async()=>{await owner.refresh("month",async()=>"valid");});
 await act(async()=>{await expect(owner.refresh("month",async()=>{throw {code:"internal_error",message:"unavailable"};})).rejects.toMatchObject({code:"internal_error"});});
 expect(owner.data?.value).toBe("valid");expect(owner.state?.error?.message).toBe("unavailable");
 await act(async()=>{await owner.refresh("month",async()=>"retried");});expect(owner.state?.error).toBeNull();expect(owner.data?.value).toBe("retried");
});
it("unmount invalidates pending publication and disposes the bound client",async()=>{
 await mount();const wait=pending<string>();let request!:Promise<string>;await act(async()=>{request=owner.refresh("month",()=>wait.promise);});
 const refusal=expect(request).rejects.toMatchObject({code:"superseded"});act(()=>root.unmount());root=undefined as unknown as typeof root;
 wait.resolve("late");await refusal;expect(mocks.dispose).toHaveBeenCalledTimes(1);
});
