import { readdirSync, readFileSync, statSync } from "node:fs";
import { join, relative } from "node:path";
import { describe, expect, it } from "vitest";

// Bug (21 October 2026): on Reports and Investments, scrolling past the end of the page scrolled the whole app window up and showed an empty band under it.
// Cause: visually hidden (position: absolute) elements inside the page. Where `.main` is not a containing block (Futuristic and Retro) their static position,
// far down the page, extends the WINDOW's scrollable area. A hidden <table> ignores width/height/overflow, so its full height (a year of daily totals) also
// extended `.main`'s own scroll area in every style. The compiled proof is e2e/feature311_page_scroll_contained.mjs; these checks pin the two causes in source.
const SRC = __dirname;
const files = (dir: string): string[] =>
  readdirSync(dir).flatMap((name) => {
    const path = join(dir, name);
    if (statSync(path).isDirectory()) return files(path);
    return /\.(tsx|css)$/.test(name) && !/\.test\./.test(name) ? [path] : [];
  });
const sources = files(SRC).map((path) => ({ rel: relative(SRC, path).replace(/\\/g, "/"), text: readFileSync(path, "utf8") }));

describe("page scrolling stays inside the page", () => {
  it("`.main` is a containing block in every style, so hidden positioned content cannot lengthen the window", () => {
    const shell = sources.find((s) => s.rel === "AppShell.css")!.text;
    const rule = /(^|\n)\.main\s*\{([^}]*)\}/.exec(shell);
    expect(rule, "AppShell.css has a base .main rule").not.toBeNull();
    expect(rule![2]).toMatch(/position:\s*relative/);
  });

  it("no table is hidden by putting sr-only on the <table> itself (a table ignores its 1px size and keeps its full height)", () => {
    const offenders = sources.filter((s) => s.rel.endsWith(".tsx") && /<table[^>]*className="[^"]*\bsr-only\b/.test(s.text)).map((s) => s.rel);
    expect(offenders).toEqual([]);
  });

  it("the Reports exact-figures tables sit inside a hidden block, which clips them", () => {
    const reports = sources.find((s) => s.rel === "ReportsOverview.tsx")!.text;
    expect(reports.match(/<div className="sr-only">\s*<table>/g)?.length).toBe(2);
  });
});
