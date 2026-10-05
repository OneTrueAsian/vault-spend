// The big top bar is gone (1.3.0): Hide amounts and Light / Dark / System live at the foot of the
// sidebar, and each page's own actions sit beside its title. The tagline only stays where people
// read it on purpose: the welcome dialog and Settings > About.
import { readdirSync, readFileSync, statSync } from "node:fs";
import { join, relative } from "node:path";
import { describe, expect, it } from "vitest";

const SRC = join(__dirname);
const ALLOWED_TAGLINE = new Set(["Modal.tsx", "SettingsView.tsx"]);

function files(dir: string): string[] {
  return readdirSync(dir).flatMap((name) => {
    const path = join(dir, name);
    if (statSync(path).isDirectory()) return files(path);
    if (!/\.(tsx|css)$/.test(name)) return [];
    if (name === "changelog.ts" || /^(Mobile|mobile)/.test(name)) return [];
    return [path];
  });
}

describe("page frame", () => {
  const sources = files(SRC).map((path) => ({ path, rel: relative(SRC, path).replace(/\\/g, "/"), text: readFileSync(path, "utf8") }));

  it("scans the app's components and styles", () => {
    expect(sources.some((s) => s.rel === "App.tsx")).toBe(true);
    expect(sources.some((s) => s.rel === "AppShell.css")).toBe(true);
  });

  it("has no top bar left anywhere", () => {
    const hits = sources.filter((s) => s.text.includes('className="topbar"') || s.text.includes(".topbar")).map((s) => s.rel);
    expect(hits).toEqual([]);
  });

  it("never sends people to the removed top bar ('the header's' button or toggle)", () => {
    const hits = sources
      .filter((s) => !/\.test\.tsx$/.test(s.rel))
      .filter((s) => /the header's|in the header\b/i.test(s.text))
      .map((s) => s.rel);
    expect(hits).toEqual([]);
  });

  it("points Settings > Privacy at Hide amounts at the bottom of the sidebar", () => {
    const settings = sources.find((s) => s.rel === "SettingsView.tsx")!.text;
    expect(settings).toContain("The Hide amounts button at the bottom of the sidebar covers every dollar figure");
  });

  it("keeps the tagline only in the welcome dialog and About", () => {
    const hits = sources
      .filter((s) => s.text.includes("Own your Data, Own your Money!"))
      .map((s) => s.rel)
      .filter((rel) => !ALLOWED_TAGLINE.has(rel));
    expect(hits).toEqual([]);
  });

  it("shows the tagline in Settings > About", () => {
    const settings = sources.find((s) => s.rel === "SettingsView.tsx")!.text;
    expect(settings).toContain('<p className="modal-message-secondary">Own your Data, Own your Money!</p>');
  });
});
