// @vitest-environment jsdom
import { afterEach, describe, expect, it } from "vitest";
import { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { CHANGELOG, changelogNotes, changelogSections } from "./changelog";
import { WhatsNewDialog } from "./Modal";

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
