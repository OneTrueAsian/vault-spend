import { afterEach, describe, expect, it, vi } from "vitest";
import { invoke as nativeInvoke } from "../node_modules/@tauri-apps/api/core.js";
import { invoke } from "./tauriInvoke";
import { onDataWrite } from "./askVault/dataWriteEvents";
import { readFileSync } from "node:fs";

vi.mock("../node_modules/@tauri-apps/api/core.js", () => ({ invoke: vi.fn(), convertFileSrc: vi.fn() }));
const stops: (() => void)[] = [];
afterEach(() => { while (stops.length) stops.pop()!(); vi.mocked(nativeInvoke).mockReset(); });
const listen = () => { const seen: string[] = []; stops.push(onDataWrite(c => seen.push(c))); return seen; };

describe("M5 write notification: the app's invoke", () => {
  it("passes the command, arguments and options through and returns the result", async () => {
    vi.mocked(nativeInvoke).mockResolvedValueOnce("saved");
    expect(await invoke("set_investment_plan", { accountId: 5 }, { headers: {} })).toBe("saved");
    expect(nativeInvoke).toHaveBeenCalledWith("set_investment_plan", { accountId: 5 }, { headers: {} });
  });
  it("notifies after a relevant command succeeds, with the command name only", async () => {
    const seen = listen(); vi.mocked(nativeInvoke).mockResolvedValueOnce(null);
    await invoke("update_holding_price", { id: 1, price: "9" }); expect(seen).toEqual(["update_holding_price"]);
  });
  it("notifies after the write completes, not before", async () => {
    const seen = listen(); let finish!: () => void; vi.mocked(nativeInvoke).mockReturnValueOnce(new Promise<void>(resolve => { finish = resolve; }) as never);
    const pending = invoke("delete_holding", {}); expect(seen).toEqual([]); finish(); await pending; expect(seen).toEqual(["delete_holding"]);
  });
  it("does not notify for reads or unrelated commands", async () => {
    const seen = listen(); vi.mocked(nativeInvoke).mockResolvedValue(null);
    await invoke("get_inflation_pct"); await invoke("set_profile_ui_state", {}); expect(seen).toEqual([]);
  });
  it("does not notify when the command fails, and passes the failure on unchanged", async () => {
    const seen = listen(); const failure = new Error("nope"); vi.mocked(nativeInvoke).mockRejectedValueOnce(failure);
    await expect(invoke("set_investment_plan", {})).rejects.toBe(failure); expect(seen).toEqual([]);
  });
  it("is what the build gives every importer of the Tauri core package", () => {
    const config = readFileSync("vite.config.ts", "utf8");
    expect(config).toContain("@tauri-apps"); expect(config).toContain("src/tauriInvoke.ts");
  });
  describe("the debug-build test hook", () => {
    afterEach(() => { vi.unstubAllEnvs(); vi.resetModules(); delete (globalThis as { __vaultspendDebug?: unknown }).__vaultspendDebug; });
    const load = async () => { vi.resetModules(); return import("./tauriInvoke"); };
    const hook = () => (globalThis as { __vaultspendDebug?: { invoke: (cmd: string, args?: Record<string, unknown>) => Promise<unknown> } }).__vaultspendDebug;
    const debugLoad = async (allowed: unknown = true) => {
      vi.stubEnv("TAURI_ENV_DEBUG", "true");
      vi.mocked(nativeInvoke).mockImplementation(async cmd => cmd === "debug_retirement_fixture_allowed" ? allowed : null);
      await load(); await new Promise(resolve => setTimeout(resolve, 0));
    };
    it.each([false, null, "true", undefined])("debug alone does not expose a hook when native fixture authorization is %s", async allowed => {
      // Set the implementation explicitly: undefined must not become the helper's default true.
      vi.stubEnv("TAURI_ENV_DEBUG", "true"); vi.mocked(nativeInvoke).mockResolvedValue(allowed);
      await load(); await new Promise(resolve => setTimeout(resolve, 0)); expect(hook()).toBeUndefined();
    });
    it("a failed native fixture check exposes nothing and observes the rejection", async () => {
      vi.stubEnv("TAURI_ENV_DEBUG", "true"); vi.mocked(nativeInvoke).mockRejectedValue(new Error("not a fixture"));
      await load(); await new Promise(resolve => setTimeout(resolve, 0)); expect(hook()).toBeUndefined();
    });
    it("exposes nothing while native fixture authorization is still pending", async () => {
      vi.stubEnv("TAURI_ENV_DEBUG", "true"); let finish!: (value: boolean) => void;
      vi.mocked(nativeInvoke).mockReturnValue(new Promise<boolean>(resolve => { finish = resolve; }));
      await load(); expect(hook()).toBeUndefined(); finish(true);
      await new Promise(resolve => setTimeout(resolve, 0)); expect(hook()).toBeDefined();
    });
    it("a fixture hook routes an allowed write through the production notification path after success", async () => {
      await debugLoad(); expect(hook()).toBeDefined();
      const { onDataWrite } = await import("./askVault/dataWriteEvents"); const seen: string[] = []; const stop = onDataWrite(c => seen.push(c));
      try { await hook()!.invoke("set_investment_plan", { accountId: 5 }); expect(seen).toEqual(["set_investment_plan"]); }
      finally { stop(); }
      expect(vi.mocked(nativeInvoke).mock.calls.map(c => c[0])).toEqual(["debug_retirement_fixture_allowed", "debug_retirement_fixture_allowed", "set_investment_plan"]);
    });
    it.each(["delete_account", "restore_backup", "plugin:opener|open_url", "set_investment_plan ", "__proto__"])("denies arbitrary operation %s before native execution", async command => {
      await debugLoad(); vi.mocked(nativeInvoke).mockClear();
      await expect(hook()!.invoke(command, {})).rejects.toThrow(/fixture operation/i);
      expect(nativeInvoke).not.toHaveBeenCalled();
    });
    it("rechecks the fixture before every operation, so a previously obtained hook cannot act after leaving it", async () => {
      await debugLoad(); const old = hook()!; vi.mocked(nativeInvoke).mockClear(); vi.mocked(nativeInvoke).mockResolvedValue(false);
      await expect(old.invoke("set_investment_plan", { accountId: 5 })).rejects.toThrow(/fixture/i);
      expect(vi.mocked(nativeInvoke).mock.calls.map(c => c[0])).toEqual(["debug_retirement_fixture_allowed"]);
    });
    it("reads and failed writes through the fixture hook do not announce a write", async () => {
      await debugLoad(); const { onDataWrite } = await import("./askVault/dataWriteEvents"); const seen: string[] = []; const stop = onDataWrite(c => seen.push(c));
      try {
        await hook()!.invoke("get_transaction_context");
        vi.mocked(nativeInvoke).mockImplementation(async cmd => { if (cmd === "debug_retirement_fixture_allowed") return true; throw new Error("write failed"); });
        await expect(hook()!.invoke("set_investment_plan", {})).rejects.toThrow("write failed"); expect(seen).toEqual([]);
      } finally { stop(); }
    });
    it.each([["false"], [undefined]])("a release build (TAURI_ENV_DEBUG=%s) exposes nothing", async value => {
      if (value !== undefined) vi.stubEnv("TAURI_ENV_DEBUG", value); else vi.stubEnv("TAURI_ENV_DEBUG", "");
      await load(); expect((globalThis as { __vaultspendDebug?: unknown }).__vaultspendDebug).toBeUndefined();
      expect(nativeInvoke).not.toHaveBeenCalled();
    });
    it("the build passes Tauri's debug flag to the frontend", () => { expect(readFileSync("vite.config.ts", "utf8")).toContain("TAURI_ENV_"); });
  });
});
