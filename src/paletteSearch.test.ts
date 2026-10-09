import { describe, expect, it } from "vitest";
import { filterPalette, type PaletteEntry } from "./paletteSearch";

const tab = (id: string, label: string): PaletteEntry => ({ id: `tab:${id}`, kind: "tab", label });
const action = (id: string, label: string, keywords?: string): PaletteEntry => ({ id: `action:${id}`, kind: "action", label, keywords });
const txn = (id: number, label: string): PaletteEntry => ({ id: `txn:${id}`, kind: "transaction", label });

describe("filterPalette match quality with equal-kind entries", () => {
  it("ranks exact, then prefix, then word start, then substring, then scattered letters", () => {
    const candidates = [tab("scattered", "B u d g e t"), tab("substring", "Rebudgeted"), tab("word", "Go to Budget"), tab("prefix", "Budgeting"), tab("exact", "Budget")];
    expect(filterPalette(candidates, "budget").map(e => e.id)).toEqual(["tab:exact", "tab:prefix", "tab:word", "tab:substring", "tab:scattered"]);
  });

  it("is zero when the letters aren't there in order", () => {
    expect(filterPalette([tab("budget", "Budget")], "xyz")).toEqual([]);
    expect(filterPalette([tab("budget", "Budget")], "tgb")).toEqual([]);
  });

  it("ignores case", () => {
    const candidates = [tab("lower", "budget"), tab("upper", "BUDGET"), tab("prefix", "Budgeting")];
    expect(filterPalette(candidates, "BUD").map(e => e.id)).toEqual(["tab:lower", "tab:upper", "tab:prefix"]);
    expect(filterPalette(candidates, "BUD")).toEqual(filterPalette(candidates, "bud"));
  });
});

describe("filterPalette", () => {
  const entries = [
    tab("dashboard", "Dashboard"),
    tab("budget", "Budget"),
    tab("cashflow", "Cash Flow"),
    action("add", "Add transaction…", "new create"),
    action("privacy", "Hide amounts", "privacy mask"),
    txn(1, "Budget Rent-A-Car"),
    txn(2, "Kroger"),
  ];

  it("with no query offers the tabs and actions, not individual transactions", () => {
    const shown = filterPalette(entries, "");

    expect(shown.map((e) => e.kind)).toEqual(["tab", "tab", "tab", "action", "action"]);
  });

  it("filters and ranks by the query", () => {
    const shown = filterPalette(entries, "bud");

    expect(shown[0].label).toBe("Budget");
    expect(shown.map((e) => e.label)).toContain("Budget Rent-A-Car");
    expect(shown.map((e) => e.label)).not.toContain("Kroger");
  });

  it("matches an entry's keywords as well as its label", () => {
    expect(filterPalette(entries, "privacy").map((e) => e.label)).toEqual(["Hide amounts"]);
    expect(filterPalette(entries, "create").map((e) => e.label)).toEqual(["Add transaction…"]);
  });

  it("finds a tab from scattered letters", () => {
    expect(filterPalette(entries, "cf")[0].label).toBe("Cash Flow");
  });

  it("only searches transactions once there are two characters to go on", () => {
    expect(filterPalette(entries, "k").filter((e) => e.kind === "transaction")).toEqual([]);
    expect(filterPalette(entries, "kr").map((e) => e.label)).toEqual(["Kroger"]);
  });

  it("caps how many transactions crowd the list", () => {
    const many = [tab("budget", "Budget"), ...Array.from({ length: 20 }, (_, i) => txn(i, `Budget item ${i}`))];

    const shown = filterPalette(many, "budget", { limit: 12, transactionCap: 4 });

    expect(shown.filter((e) => e.kind === "transaction")).toHaveLength(4);
    expect(shown[0].kind).toBe("tab");
  });

  it("returns nothing for a query that matches nothing", () => {
    expect(filterPalette(entries, "qqqq")).toEqual([]);
  });

  it("keeps the given order among equally good matches", () => {
    const tied = [tab("a", "Alpha One"), tab("b", "Alpha Two")];

    expect(filterPalette(tied, "alpha").map((e) => e.label)).toEqual(["Alpha One", "Alpha Two"]);
  });
});
