import { describe, expect, it } from "vitest";
import { hiddenAccountCount, pickableAccounts } from "./hiddenAccounts";

// QA-GAP-001: hidden accounts are left out of the pickers that choose where something new goes, but a picker
// already set to a hidden account keeps showing it, and nothing else about the account changes.
const acct = (id: number, name: string, hidden = false) => ({ id, name, hidden });
const list = [acct(1, "Checking"), acct(2, "Old Savings", true), acct(3, "Card"), acct(4, "Old Card", true)];

describe("pickableAccounts", () => {
  it("leaves hidden accounts out", () => {
    expect(pickableAccounts(list).map((a) => a.name)).toEqual(["Checking", "Card"]);
  });

  it("keeps a hidden account that is already chosen", () => {
    expect(pickableAccounts(list, 2).map((a) => a.name)).toEqual(["Checking", "Old Savings", "Card"]);
    expect(pickableAccounts(list, "4").map((a) => a.name)).toEqual(["Checking", "Card", "Old Card"]);
  });

  it("ignores an empty or unknown choice", () => {
    expect(pickableAccounts(list, "", null, undefined, 99).map((a) => a.id)).toEqual([1, 3]);
  });

  it("keeps the original order and returns everything when nothing is hidden", () => {
    const visible = [acct(3, "B"), acct(1, "A")];
    expect(pickableAccounts(visible)).toEqual(visible);
  });
});

describe("hiddenAccountCount", () => {
  it("counts only hidden accounts", () => {
    expect(hiddenAccountCount(list)).toBe(2);
    expect(hiddenAccountCount([])).toBe(0);
  });
});
