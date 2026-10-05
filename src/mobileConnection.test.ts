import { expect, it, vi } from "vitest";
import { refreshMobileSnapshot, readMobileStatus } from "./mobileConnection";
import { completeMobilePairing } from "./mobileConnection";
import { MAX_MOBILE_SNAPSHOT_BYTES } from "./mobileSnapshot";
const binding = { installationId: "a".repeat(32), profileId: "b".repeat(64), epoch: "c".repeat(64) };
it("captures the removal fence before HTTP and passes the trusted binding unchanged", async () => {
  const order: string[] = [];
  const guard = { id: "saved", fence: "before" };
  const repository = { prepareRefresh: vi.fn(async () => { order.push("fence"); return guard; }), replace: vi.fn(async () => { order.push("save"); return "saved" as const; }) };
  const fetcher = vi.fn(async (_input: RequestInfo | URL, _init?: RequestInit) => { order.push("network"); return new Response("snapshot"); });
  expect(await refreshMobileSnapshot(repository, binding, {}, fetcher)).toBe("saved");
  expect(order).toEqual(["fence", "network", "save"]);
  expect(repository.replace).toHaveBeenCalledWith("snapshot", binding, { guard });
  expect(fetcher.mock.calls[0][0]).toBe(`/api/snapshot/${binding.profileId}`);
});
it("does not replace saved data after auth failure", async () => {
  const repository = { prepareRefresh: vi.fn(async () => ({ id: "saved", fence: "before" })), replace: vi.fn() };
  await expect(refreshMobileSnapshot(repository, binding, {}, async () => new Response('{"error":"mobile_access_denied"}', { status: 401 }))).rejects.toThrow();
  expect(repository.replace).not.toHaveBeenCalled();
});
it("rejects unauthenticated or malformed status metadata", async () => {
  await expect(readMobileStatus(async () => new Response('{"profiles":[{"id":"guess"}]}'))).rejects.toThrow();
  await expect(readMobileStatus(async () => new Response('{}', {status:401}))).rejects.toThrow();
});
it("cancels oversized streamed data and keeps the old saved copy", async () => {
  const repository = { prepareRefresh: vi.fn(async () => ({ id: "saved", fence: "before" })), replace: vi.fn() };
  const cancelled = vi.fn();
  const stream = new ReadableStream({ start(controller) { controller.enqueue(new Uint8Array(MAX_MOBILE_SNAPSHOT_BYTES + 1)); }, cancel: cancelled });
  await expect(refreshMobileSnapshot(repository, binding, {}, async () => new Response(stream))).rejects.toThrow("mobile_response_too_large");
  expect(cancelled).toHaveBeenCalledOnce();
  expect(repository.replace).not.toHaveBeenCalled();
});
it("reports pending confirmation with a fixed code without echoing remote error text", async () => {
  await expect(completeMobilePairing("d".repeat(64), async () => new Response('{"error":"mobile_confirmation_pending"}', { status: 409 }))).rejects.toThrow("mobile_confirmation_pending");
  await expect(completeMobilePairing("d".repeat(64), async () => new Response('{"error":"private server path"}', { status: 409 }))).rejects.toThrow("mobile_refresh_unavailable");
});
it("times out an unavailable network and releases the refresh slot for retry",async()=>{
 vi.useFakeTimers();
 try{
  const repository={prepareRefresh:vi.fn(async()=>({id:"saved",fence:"before"})),replace:vi.fn(async()=>"saved" as const)};
  const response=refreshMobileSnapshot(repository,binding,{},async(_input,options)=>new Promise((_resolve,reject)=>options?.signal?.addEventListener("abort",()=>reject(new DOMException("Timed out","AbortError")))));
  const rejected=expect(response).rejects.toThrow("Timed out");await vi.advanceTimersByTimeAsync(16001);await rejected;expect(repository.replace).not.toHaveBeenCalled();
  await refreshMobileSnapshot(repository,binding,{},async()=>new Response("snapshot"));expect(repository.replace).toHaveBeenCalledOnce();
 }finally{vi.useRealTimers();}
});
