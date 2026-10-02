import { describe, expect, it } from "vitest";
import raw from "../docs/LEGAL-NOTICE.md?raw";
import { parseLegalNotice, parseInline } from "./legalNotice";

const sample = [
  "# Vault Spend Legal Notice and Disclaimer",
  "",
  "**Version:** 2030-01-02  ",
  "**What changed:** Added a thing.",
  "",
  "---",
  "",
  "## SUMMARY",
  "",
  "A short line.",
  "",
  "- first point",
  "- second **bold** point",
  "",
  "---",
  "",
  "# FULL NOTICE",
  "",
  "## 1. About",
  "",
  "Some text with `code`.",
  "",
  "### a. Fonts",
  "",
  "More text.",
].join("\n");

describe("parseLegalNotice", () => {
  it("reads the version and the what-changed line from the header", () => {
    const parsed = parseLegalNotice(sample);

    expect(parsed.version).toBe("2030-01-02");
    expect(parsed.whatChanged).toBe("Added a thing.");
  });

  it("splits the summary from the full notice at the FULL NOTICE heading", () => {
    const parsed = parseLegalNotice(sample);

    expect(parsed.summary).toEqual([
      { kind: "paragraph", text: "A short line." },
      { kind: "list", items: ["first point", "second **bold** point"] },
    ]);
    expect(parsed.full[0]).toEqual({ kind: "heading", level: 2, text: "1. About" });
    expect(parsed.full).toContainEqual({ kind: "heading", level: 3, text: "a. Fonts" });
    expect(parsed.full).toContainEqual({ kind: "paragraph", text: "More text." });
  });

  it("drops the horizontal rules and keeps the summary heading out of both parts", () => {
    const parsed = parseLegalNotice(sample);

    const everything = JSON.stringify([parsed.summary, parsed.full]);
    expect(everything).not.toContain("---");
    expect(everything).not.toContain("SUMMARY");
  });

  it("refuses a notice with no version", () => {
    expect(() => parseLegalNotice(sample.replace("**Version:** 2030-01-02", ""))).toThrow(/Version/);
  });

  it("refuses a notice with no what-changed line", () => {
    expect(() => parseLegalNotice(sample.replace("**What changed:** Added a thing.", ""))).toThrow(/What changed/);
  });

  it("refuses a notice with no summary", () => {
    expect(() => parseLegalNotice(sample.replace("## SUMMARY", "## INTRO"))).toThrow(/SUMMARY/);
  });

  it("refuses a notice with no full section", () => {
    expect(() => parseLegalNotice(sample.replace("# FULL NOTICE", "# THE REST"))).toThrow(/FULL NOTICE/);
  });

  it("copes with Windows line endings", () => {
    const parsed = parseLegalNotice(sample.replace(/\n/g, "\r\n"));

    expect(parsed.version).toBe("2030-01-02");
    expect(parsed.summary).toHaveLength(2);
  });

  it("parses the real legal notice shipped in docs/", () => {
    const parsed = parseLegalNotice(raw);

    expect(parsed.version).toMatch(/^\d{4}-\d{2}-\d{2}$/);
    expect(parsed.whatChanged.length).toBeGreaterThan(0);
    expect(parsed.summary.length).toBeGreaterThan(0);
    expect(parsed.full.filter((b) => b.kind === "heading" && b.level === 2)).toHaveLength(22);
  });

  it("keeps the real notice truthful about the three network requests the app makes", () => {
    for (const host of ["fonts.googleapis.com", "fonts.gstatic.com", "api.github.com"]) {
      expect(raw).toContain(host);
    }
  });
});

describe("parseInline", () => {
  it("splits bold and code spans from plain text", () => {
    expect(parseInline("a **b** c `d` e")).toEqual([
      { kind: "text", text: "a " },
      { kind: "bold", text: "b" },
      { kind: "text", text: " c " },
      { kind: "code", text: "d" },
      { kind: "text", text: " e" },
    ]);
  });

  it("returns plain text as one piece", () => {
    expect(parseInline("just words")).toEqual([{ kind: "text", text: "just words" }]);
  });
});
