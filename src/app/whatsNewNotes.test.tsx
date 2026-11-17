// @vitest-environment jsdom
import { readFileSync } from "node:fs";
import { afterEach, describe, expect, it } from "vitest";
import { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { CHANGELOG, changelogNotes, changelogSections, versionsNewestFirst } from "../shared/lib/changelog";
import { WhatsNewDialog } from "./WhatsNewDialog";

(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

describe("grouped release notes", () => {
  it("treats an older flat entry as one section with no heading", () => {
    expect(changelogSections(["a", "b"])).toEqual([{ heading: null, notes: ["a", "b"] }]);
    expect(changelogNotes(["a", "b"])).toEqual(["a", "b"]);
  });

  it("keeps the order of the groups and drops an empty one", () => {
    const entry = { "New features": ["n"], Enhancements: [], "Bug fixes": ["f1", "f2"] };
    expect(changelogSections(entry)).toEqual([
      { heading: "New features", notes: ["n"] },
      { heading: "Bug fixes", notes: ["f1", "f2"] },
    ]);
    expect(changelogNotes(entry)).toEqual(["n", "f1", "f2"]);
  });

  it("writes 1.3.1 in the three labelled groups, in that order", () => {
    const entry = CHANGELOG["1.3.1"];
    expect(Array.isArray(entry)).toBe(false);
    expect(changelogSections(entry).map((s) => s.heading)).toEqual(["New features", "Enhancements", "Bug fixes"]);
  });

  it("writes 1.3.3 in the three labelled groups and names the VS-31 layouts in plain words", () => {
    const entry = CHANGELOG["1.3.3"];
    expect(changelogSections(entry).map((s) => s.heading)).toEqual(["New features", "Enhancements", "Bug fixes"]);
    const text = changelogNotes(entry).join("\n");
    for (const part of [/Six months at a glance/, /What your investments are in/, /What you own and owe/, /Spending against the plan/, /Savings goals/, /Tags and people/, /Debt payoff/, /by person/]) expect(text).toMatch(part);
  });

  // Owner review of the 1.3.3 notes: a "(month)" placeholder would be shown to readers word for word.
  it("writes no (month) placeholder in the 1.3.3 notes", () => {
    const text = changelogNotes(CHANGELOG["1.3.3"]).join("\n");
    expect(text).not.toContain("(month)");
    expect(text).toMatch(/Spending this month so far card/);
    expect(text).toMatch(/names in the by person table no longer break/);
  });

  // Owner review of the 1.3.3 notes: the three import-screen enhancements become one note that keeps each point.
  it("describes the import screen in one 1.3.3 enhancement", () => {
    const enhancements = changelogSections(CHANGELOG["1.3.3"]).find((s) => s.heading === "Enhancements")!.notes;
    const imports = enhancements.filter((n) => /import/i.test(n));
    expect(imports).toHaveLength(1);
    for (const part of [/choose Change/, /number of rows under each bank category is now a button/, /Not importing/, /"Let the app guess"/, /The Help page says the same/]) expect(imports[0]).toMatch(part);
  });

  // Owner review of the 1.3.3 notes: the thin "Help names the new cards and tabs" enhancement is folded into new feature 1.
  it("mentions Help in the 1.3.3 layout feature, not as its own enhancement", () => {
    const sections = changelogSections(CHANGELOG["1.3.3"]);
    expect(sections.find((s) => s.heading === "New features")!.notes[0]).toMatch(/Help describes the new cards and tabs on each page\./);
    expect(sections.find((s) => s.heading === "Enhancements")!.notes.some((n) => /^Help names/.test(n))).toBe(false);
  });

  it("puts VS-35 tabs and remembered choices under Enhancements, and deleted-category recovery under Bug fixes", () => {
    const sections = changelogSections(CHANGELOG["1.3.3"]);
    const enhancements = sections.find(s => s.heading === "Enhancements")!.notes.join(" ");
    expect(enhancements).toMatch(/Bank categories, Needs a category and Transactions/);
    expect(enhancements).toMatch(/already matched.*aren't asked again/);
    expect(sections.find(s => s.heading === "Bug fixes")!.notes.join(" ")).toMatch(/import is no longer refused.*remembered category was deleted/);
  });

  it("includes the import account-routing fix in the grouped 1.3.2 release notes", () => {
    const entry = CHANGELOG["1.3.2"];
    expect(changelogSections(entry).map((s) => s.heading)).toEqual(["New features", "Enhancements", "Bug fixes"]);
    const text = changelogNotes(entry).join("\n");
    expect(text).toMatch(/Transaction imports use existing accounts only/);
    expect(text).toMatch(/no longer creates a new account/);
    expect(text).toMatch(/each row keeps the account you choose/);
  });

  it("lists the Quick settings save fix among the 1.3.2 bug fixes", () => {
    const fixes = changelogSections(CHANGELOG["1.3.2"]).find((s) => s.heading === "Bug fixes")!.notes.join("\n");
    expect(fixes).toMatch(/Quick settings shortcuts/);
  });

  it("lists the credit card and loan account page wording and the accented store name fix among the 1.3.2 bug fixes", () => {
    const fixes = changelogSections(CHANGELOG["1.3.2"]).find((s) => s.heading === "Bug fixes")!.notes.join("\n");
    expect(fixes).toMatch(/amount owed and the credit still available/);
    expect(fixes).toMatch(/Store names with accents, such as CAFÉ/);
    expect(fixes).toMatch(/no clue about, such as a store name it has never seen/);
    expect(fixes).toMatch(/Available credit over the last year/);
  });

  it("covers the delivered 1.3.1 scope in plain words", () => {
    const text = changelogNotes(CHANGELOG["1.3.1"]).join("\n");
    for (const part of [/Ask the Vault/, /what-if|cut/i, /savings/i, /retirement/i, /statement/i, /holdings/i, /update/i, /scroll/i]) expect(text).toMatch(part);
    for (const jargon of [/public key/i, /authenticity/i, /Authenticode/i, /notariz/i, /financial-read/i, /\bledger\b/i]) expect(text).not.toMatch(jargon);
  });
});

describe("What's New dialog", () => {
  let root: Root | null = null;
  afterEach(() => { act(() => root?.unmount()); root = null; document.body.innerHTML = ""; });

  it("shows a heading above each group and one bullet per note", () => {
    const host = document.createElement("div");
    document.body.appendChild(host);
    root = createRoot(host);
    act(() => root!.render(<WhatsNewDialog version="9.9.9" notes={{ "New features": ["n"], "Bug fixes": ["f1", "f2"] }} onClose={() => {}} />));
    expect([...document.querySelectorAll(".modal-changelog-heading")].map((h) => h.textContent)).toEqual(["New features", "Bug fixes"]);
    expect([...document.querySelectorAll(".modal-changelog-list li")].map((li) => li.textContent)).toEqual(["n", "f1", "f2"]);
  });

  it("still shows an older flat entry without headings", () => {
    const host = document.createElement("div");
    document.body.appendChild(host);
    root = createRoot(host);
    act(() => root!.render(<WhatsNewDialog version="1.0.0" notes={["only"]} onClose={() => {}} />));
    expect(document.querySelectorAll(".modal-changelog-heading").length).toBe(0);
    expect(document.querySelectorAll(".modal-changelog-list li").length).toBe(1);
  });
});

describe("release notes order", () => {
  it("lists the newest version first however the entries are written in the file", () => {
    const versions = versionsNewestFirst();
    expect(versions[0]).toBe(JSON.parse(readFileSync("package.json", "utf8")).version);
    expect([...versions].sort()).toEqual([...Object.keys(CHANGELOG)].sort());
    const parts = (v: string) => v.split(".").map(Number);
    for (let i = 1; i < versions.length; i++) {
      const [a, b] = [parts(versions[i - 1]), parts(versions[i])];
      const newer = a[0] - b[0] || a[1] - b[1] || a[2] - b[2];
      expect(newer, `${versions[i - 1]} before ${versions[i]}`).toBeGreaterThan(0);
    }
  });
});
