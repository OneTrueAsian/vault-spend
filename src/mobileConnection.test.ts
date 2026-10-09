import { expect, it, vi } from "vitest";
import { refreshMobileSnapshot, readMobileStatus, redeemMobilePairing, logoutMobile } from "./mobileConnection";
import { completeMobilePairing } from "./mobileConnection";
import { MAX_MOBILE_SNAPSHOT_BYTES } from "./mobileSnapshot";
const binding = { installationId: "a".repeat(32), profileId: "b".repeat(64), epoch: "c".repeat(64) };
it("all public transports use approved relative routes, same-origin credentials and refuse redirects", async () => {
  const status = { installationId: binding.installationId, csrf: "d".repeat(64), profiles: [] };
  const fetcher = vi.fn(async (input: RequestInfo | URL, _options?: RequestInit) => new Response(JSON.stringify(
    input === "/api/status" ? status : input === "/api/pair/redeem" ? { claim: "e".repeat(64) } : { paired: true },
  )));
  await readMobileStatus(fetcher);
  await redeemMobilePairing("f".repeat(64), "Phone", fetcher);
  await completeMobilePairing("e".repeat(64), fetcher);
  await logoutMobile(status.csrf, fetcher);
  await refreshMobileSnapshot({ prepareRefresh: async () => ({ id: "saved", fence: "before" }), replace: async () => "saved" }, binding, {}, fetcher);
  expect(fetcher.mock.calls.map(([route]) => route)).toEqual(["/api/status", "/api/pair/redeem", "/api/pair/complete", "/api/logout", `/api/snapshot/${binding.profileId}`]);
  for (const [, options] of fetcher.mock.calls) expect(options).toMatchObject({ credentials: "same-origin", redirect: "error", cache: "no-store", referrerPolicy: "no-referrer" });
  expect(fetcher.mock.calls[3][1]?.headers).toMatchObject({ "X-Vault-CSRF": status.csrf });
});
it.each(["//remote.invalid", "../other", "a/b", "a%2fb", "a?query", "a#fragment", "A".repeat(64)])("rejects unsafe snapshot identifiers before network: %s", async profileId => {
  const fetcher = vi.fn();
  await expect(refreshMobileSnapshot({ prepareRefresh: vi.fn(), replace: vi.fn() }, { ...binding, profileId }, {}, fetcher)).rejects.toThrow("mobile_binding_invalid");
  expect(fetcher).not.toHaveBeenCalled();
});
it("a redirect refusal preserves the saved snapshot", async () => {
  const replace = vi.fn();
  const fetcher = vi.fn(async (_input: RequestInfo | URL, options?: RequestInit) => {
    if (options?.redirect === "error") throw new TypeError("Redirect refused");
    return new Response("untrusted redirected snapshot");
  });
  await expect(refreshMobileSnapshot({ prepareRefresh: async () => ({ id: "saved", fence: "before" }), replace }, binding, {}, fetcher)).rejects.toThrow("Redirect refused");
  expect(replace).not.toHaveBeenCalled();
});
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
