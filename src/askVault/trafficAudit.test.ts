// @vitest-environment node
import { describe, expect, it } from "vitest";
import { runInNewContext } from "node:vm";
import { assertTrafficAudit, installTrafficRecorder, nearestRank, classifyDifferential } from "../../e2e/askVaultTrafficAudit.mjs";

const clean = () => ({ installed: ["fetch", "xhr", "beacon", "socket", "eventsource", "invoke"], requests: ["ipc://localhost/get_ask_vault_snapshot"], commands: ["get_ask_vault_snapshot"], before: { local: 1, external: 2 }, after: { local: 1, external: 2 } });
describe("M6 Task 6 retained-evidence safety", () => {
  it("accepts a complete exact read-only trace and unchanged revision", () => {
    expect(() => assertTrafficAudit(clean(), ["get_ask_vault_snapshot"])).not.toThrow();
  });
  it.each(["https://example.com", "http://localhost:9999/exfil", "http://tauri.localhost.evil/a", "data:text/plain,secret", "ws://example.com"]) ("rejects unexpected attempted traffic %s", url => {
    expect(() => assertTrafficAudit({ ...clean(), requests: [...clean().requests, url] }, ["get_ask_vault_snapshot"])).toThrow();
  });
  it("accepts only exact asset origin and the supported IPC transports", () => {
    expect(() => assertTrafficAudit({ ...clean(), requests: ["http://tauri.localhost/assets/app.js", "http://ipc.localhost/get_ask_vault_snapshot"] }, ["get_ask_vault_snapshot"])).not.toThrow();
  });
  it.each(["set_profile_ui_state", "get_unapproved_secret", "plugin:unknown|write", "delete_account"])("rejects any command outside the explicit allow-list: %s", command => {
    expect(() => assertTrafficAudit({ ...clean(), commands: [...clean().commands, command] }, ["get_ask_vault_snapshot"])).toThrow();
  });
  it("rejects IPC commands hidden only in URLs, missing observations, missing instrumentation and changed revisions", () => {
    expect(() => assertTrafficAudit({ ...clean(), requests: ["ipc://localhost/delete_account"] }, ["get_ask_vault_snapshot"])).toThrow();
    expect(() => assertTrafficAudit({ ...clean(), commands: [], requests: [] }, ["get_ask_vault_snapshot"])).toThrow();
    expect(() => assertTrafficAudit({ ...clean(), installed: ["fetch"] }, ["get_ask_vault_snapshot"])).toThrow();
    expect(() => assertTrafficAudit({ ...clean(), after: { local: 2, external: 2 } }, ["get_ask_vault_snapshot"])).toThrow();
  });
  it("uses the approved nearest-rank statistic without treating a maximum as p95", () => {
    const values = [...Array.from({ length: 29 }, (_, i) => i + 1), 1000];
    expect(nearestRank(values, .95)).toBe(29);
    expect(nearestRank(values, 1)).toBe(1000);
    expect(values[0]).toBe(1);
    expect(() => nearestRank([], .95)).toThrow();
    expect(() => nearestRank([NaN], .95)).toThrow();
  });
  it("flags changed accepted queries in either direction, missing rows, duplicates and reorderings", () => {
    const row = (key: string, status: string, amount = "1") => [key, JSON.stringify({ status, amount })];
    expect(classifyDifferential([row("a", "unsupported")], [row("a", "clarify")]).clarificationChanges).toHaveLength(1);
    expect(classifyDifferential([row("a", "query")], [row("a", "query", "2")]).violations).toHaveLength(1);
    expect(classifyDifferential([row("a", "unsupported")], [row("a", "query")]).violations).toHaveLength(1);
    expect(classifyDifferential([row("a", "query")], []).violations.length).toBeGreaterThan(0);
    expect(classifyDifferential([row("a", "query"), row("a", "query")], [row("a", "query")]).violations.length).toBeGreaterThan(0);
    expect(classifyDifferential([row("a", "query"), row("b", "query")], [row("b", "query"), row("a", "query")]).violations).toEqual([]);
  });
  it("records attempted fetch/XHR/beacon/socket/eventsource calls without blocking them", () => {
    const forwarded: string[] = [];
    class XHR { open(_method: string, url: string) { forwarded.push(url); } }
    class Socket { constructor(url: string) { forwarded.push(url); } }
    const context = { URL, XMLHttpRequest: XHR, navigator: { sendBeacon: (url: string) => { forwarded.push(url); return true; } }, window: {
      fetch: (url: string) => { forwarded.push(url); return Promise.reject(new Error("blocked network")); }, WebSocket: Socket, EventSource: Socket,
      __TAURI_INTERNALS__: { invoke: (command: string) => { forwarded.push(command); return command; } },
    } };
    runInNewContext(`(${installTrafficRecorder.toString()})(); new XMLHttpRequest().open('GET', 'https://xhr.invalid'); navigator.sendBeacon('https://beacon.invalid'); new window.WebSocket('ws://socket.invalid'); new window.EventSource('https://event.invalid'); window.__TAURI_INTERNALS__.invoke('set_secret'); window.fetch('https://fetch.invalid').catch(()=>{});`, context);
    const state = (context.window as unknown as { __task6Traffic: { requests: string[]; commands: string[] } }).__task6Traffic;
    expect(state.requests).toHaveLength(5);
    expect(state.commands).toEqual(["set_secret"]);
    expect(forwarded).toHaveLength(6);
    expect(state.requests).toContain("https://fetch.invalid"); // attempted traffic counts even if the transport rejects it
  });
});
