import { describe, expect, it, vi } from "vitest";
import { createViewLoaders } from "./viewLoaders";

describe("view loaders", () => {
  it("loads each view's module once however many times it is asked for", async () => {
    const dashboard = vi.fn(() => Promise.resolve({ default: "dashboard" }));
    const loaders = createViewLoaders({ dashboard, budget: () => Promise.resolve({ default: "budget" }) });
    const first = loaders.load("dashboard");
    const second = loaders.load("dashboard");
    expect(first).toBe(second);
    expect(await first).toEqual({ default: "dashboard" });
    expect(dashboard).toHaveBeenCalledTimes(1);
  });

  it("preloads the requested views first and every remaining view afterwards, without failing on a broken chunk", async () => {
    const calls: string[] = [];
    const make = (name: string, fail = false) => () => {
      calls.push(name);
      return fail ? Promise.reject(new Error("chunk missing")) : Promise.resolve({ default: name });
    };
    const loaders = createViewLoaders({ dashboard: make("dashboard"), budget: make("budget", true), reports: make("reports") });
    await loaders.preload(["dashboard"]);
    expect(calls).toEqual(["dashboard"]);
    await loaders.preloadRest();
    expect(calls.sort()).toEqual(["budget", "dashboard", "reports"]);
    // A failed preload must not poison the view: asking again retries the import.
    await expect(loaders.load("budget")).rejects.toThrow("chunk missing");
    expect(calls.filter((name) => name === "budget")).toHaveLength(2);
  });

  it("exposes a view's module synchronously once it has loaded, so it can be drawn without suspending", async () => {
    const loaders = createViewLoaders({ dashboard: () => Promise.resolve({ default: "dashboard" }) });
    expect(loaders.peek("dashboard")).toBeUndefined();
    const pending = loaders.load("dashboard");
    expect(loaders.peek("dashboard")).toBeUndefined();
    await pending;
    expect(loaders.peek("dashboard")).toEqual({ default: "dashboard" });
  });
});
