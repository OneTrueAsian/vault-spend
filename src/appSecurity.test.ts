// The app window's content rules (2026-10-02 QA, M2). Vault Spend shows only its own bundled files
// and talks only to its own backend, so the window says exactly that: no remote scripts, styles,
// fonts or requests, and no plugins or frames. With `"csp": null`, anything that ever got into the
// page could have loaded remote code with every app command in reach.
import { readdirSync, readFileSync } from "node:fs";
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
  it("never requests anything itself (remote calls go through the backend)", () => {
    const srcDir = new URL("./", import.meta.url);
    const offenders = readdirSync(srcDir, { recursive: true, encoding: "utf8" })
      .filter((f) => /\.(ts|tsx)$/.test(f) && !/\.test\.tsx?$/.test(f))
      .filter((f) => /\bfetch\s*\(|new\s+XMLHttpRequest|new\s+WebSocket|new\s+EventSource/.test(readFileSync(new URL(f.split("\\").join("/"), srcDir), "utf8")));
    expect(offenders).toEqual([]);
  });
});

describe("The page itself", () => {
  it("asks no remote server for anything (fonts included: every style bundles or uses system fonts)", () => {
    const html = read("../index.html");
    expect(html).not.toMatch(/https?:\/\//);
  });
});
