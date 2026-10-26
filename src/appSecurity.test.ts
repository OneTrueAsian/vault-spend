// The app window's content rules (2026-10-02 QA, M2). Vault Spend shows only its own bundled files
// and talks only to its own backend, so the window says exactly that: no remote scripts, styles,
// fonts or requests, and no plugins or frames. With `"csp": null`, anything that ever got into the
// page could have loaded remote code with every app command in reach.
import { mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { networkCapabilities, rendererSourceGraph } from "./testSupport/rendererNetworkPolicy";
import { describe, expect, it } from "vitest";

const read = (rel: string) => readFileSync(new URL(rel, import.meta.url), "utf8");
const conf = JSON.parse(read("../src-tauri/tauri.conf.json"));

describe("Content Security Policy", () => {
  const csp: string = conf.app.security.csp;
  const directive = (name: string) => csp.split(";").map((d) => d.trim()).find((d) => d.startsWith(`${name} `));

  it("is set", () => {
    expect(typeof csp).toBe("string");
  });

  it("allows only the app's own files and its own backend", () => {
    expect(directive("default-src")).toBe("default-src 'self'");
    expect(directive("script-src")).toBe("script-src 'self'");
    expect(directive("connect-src")).toBe("connect-src ipc: http://ipc.localhost");
    expect(directive("object-src")).toBe("object-src 'none'");
    expect(directive("base-uri")).toBe("base-uri 'none'");
    expect(directive("frame-src")).toBe("frame-src 'none'");
  });

  it("names no remote origin anywhere", () => {
    expect(csp).not.toMatch(/https?:\/\/(?!ipc\.localhost)/);
  });
});

describe("The page's own code", () => {
  // The rules above refuse any page request to another site, and they do it silently: 1.2.9's update
  // check asked GitHub straight from the page, got blocked, and no one heard about 1.3.0. Anything
  // that needs the internet goes through a backend command instead (e.g. `fetch_latest_release`).
  it("desktop runtime imports acquire no browser network capabilities", () => {
    const graph = rendererSourceGraph(fileURLToPath(new URL("./main.tsx", import.meta.url)));
    expect([...graph.keys()].some(f => f.endsWith("App.tsx"))).toBe(true);
    expect([...graph.keys()].some(f => f.endsWith("ReportsView.tsx"))).toBe(true);
    expect([...graph.keys()].some(f => f.endsWith("mobileConnection.ts"))).toBe(false);
    const offenders = [...graph].filter(([file, source]) => networkCapabilities(source, file).length).map(([file]) => file);
    expect(offenders).toEqual([]);
  });

  it.each([
    'fetch("https://example.invalid")',
    'const fetcher = fetch; fetcher("/api/status")',
    'const fetcher = window.fetch.bind(window); fetcher("/")',
    'const { fetch: request } = globalThis; request("/")',
    'globalThis["f\\u0065tch"]("/")',
    'const g = window; g["fetch"]("/")',
    'const Constructor = WebSocket; new Constructor("wss://example.invalid")',
    'new XMLHttpRequest()', 'new EventSource("/")',
    'navigator.sendBeacon("/", "data")', 'window[capability]("/")',
    'const g = window; const h = g; h[capability]("/")',
    'Reflect.get(globalThis, "fetch")("/")',
  ])("detects prohibited capability acquisition: %s", source => {
    expect(networkCapabilities(source)).not.toEqual([]);
  });

  it("permits typed IPC and ignores comments, inert strings and type references", () => {
    expect(networkCapabilities('import { invoke as call } from "@tauri-apps/api/core"; call("fetch_latest_release"); // fetch("/")\nconst note = "new WebSocket"; type Fetcher = typeof fetch;')).toEqual([]);
  });

  it("recognizes intentional mobile transport instead of scanning it as desktop code", () => {
    expect(networkCapabilities(read("./mobileConnection.ts"))).toContain("fetch");
  });

  it("follows runtime/re-export/lazy dependencies, skips named type-only imports and fails closed on unknown imports", () => {
    const dir = mkdtempSync(join(tmpdir(), "vaultspend-renderer-policy-"));
    try {
      writeFileSync(join(dir, "main.ts"), 'import { type Foo } from "./types"; import type { Bar } from "./otherTypes"; export { type Baz } from "./exportTypes"; import "./eager"; const view = () => import("./lazy");');
      writeFileSync(join(dir, "eager.ts"), 'export { helper } from "./shared";');
      writeFileSync(join(dir, "shared.ts"), 'export const helper = fetch;');
      writeFileSync(join(dir, "lazy.tsx"), 'export const View = () => <div />;');
      const graph = rendererSourceGraph(join(dir, "main.ts"));
      expect([...graph.keys()].map(f => f.slice(dir.length + 1)).sort()).toEqual(["eager.ts", "lazy.tsx", "main.ts", "shared.ts"]);
      expect([...graph].filter(([file, source]) => networkCapabilities(source, file).length).map(([file]) => file)).toEqual([join(dir, "shared.ts")]);
      writeFileSync(join(dir, "main.ts"), 'import "./missing";');
      expect(() => rendererSourceGraph(join(dir, "main.ts"))).toThrow("Unresolved renderer dependency");
      writeFileSync(join(dir, "main.ts"), 'import(moduleName);');
      expect(() => rendererSourceGraph(join(dir, "main.ts"))).toThrow("Nonliteral renderer import");
    } finally {
      if (dirname(resolve(dir)) !== resolve(tmpdir())) throw new Error("Unexpected fixture cleanup path");
      rmSync(dir, { recursive: true, force: true });
    }
  });
});

describe("The page itself", () => {
  it("asks no remote server for anything (fonts included: every style bundles or uses system fonts)", () => {
    const html = read("../index.html");
    expect(html).not.toMatch(/https?:\/\//);
  });
});
