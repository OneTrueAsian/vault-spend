// Select all on the Transactions tab picks every matching row, at most 250 transactions at a
// time, and the next press picks the next 250 once a change has been applied (owner, 2026-10-04).
import { describe, expect, it } from "vitest";
import { SELECT_ALL_CAP, canSelectMore, isBatchSelected, selectAllNext, selectAllNote, unselectBatch } from "./ledgerSelection";

/** `n` single-transaction rows with ids 1..n, in ledger order. */
const rows = (n: number, from = 1) => Array.from({ length: n }, (_, i) => [from + i]);

describe("selectAllNext", () => {
  it("selects every matching row when there are 250 or fewer", () => {
    const r = selectAllNext(rows(40), new Set(), null);
    expect(r.selected.size).toBe(40);
    expect(r.matching).toBe(40);
    expect(r.remainingAfter).toBe(0);
  });

  it("stops at 250 in ledger order and says how many are left", () => {
    const r = selectAllNext(rows(600), new Set(), null);
    expect(SELECT_ALL_CAP).toBe(250);
    expect(r.selected.size).toBe(250);
    expect([...r.selected].slice(0, 3)).toEqual([1, 2, 3]);
    expect(r.selected.has(251)).toBe(false);
    expect(r.matching).toBe(600);
    expect(r.remainingAfter).toBe(350);
  });

  it("never splits a merged transfer row across batches", () => {
    const transferRows = [...rows(249), [500, 501]];
    const r = selectAllNext(transferRows, new Set(), null);
    expect(r.selected.size).toBe(249);
    expect(r.selected.has(500)).toBe(false);
    expect(r.remainingAfter).toBe(2);
  });

  it("picks the next 250 once a change cleared the selection", () => {
    const first = selectAllNext(rows(600), new Set(), null);
    // the change was applied and the selection cleared
    const second = selectAllNext(rows(600), new Set(), first.batch);
    expect(second.selected.has(251)).toBe(true);
    expect(second.selected.has(1)).toBe(false);
    expect(second.selected.size).toBe(250);
    expect(second.remainingAfter).toBe(100);
    const third = selectAllNext(rows(600), new Set(), second.batch);
    expect(third.selected.size).toBe(100);
    expect(third.remainingAfter).toBe(0);
  });

  it("works when changed rows drop out of the filter", () => {
    const first = selectAllNext(rows(600), new Set(), null);
    const second = selectAllNext(rows(350, 251), new Set(), first.batch);
    expect([...second.selected][0]).toBe(251);
    expect(second.selected.size).toBe(250);
  });

  it("does not count a batch as done when it was unticked without a change", () => {
    const first = selectAllNext(rows(600), new Set(), null);
    const unticked = unselectBatch(first.batch);
    const again = selectAllNext(rows(600), new Set(), unticked);
    expect(again.selected.has(1)).toBe(true);
  });

  it("starts over when given no batch (a filter, search or sort changed)", () => {
    const first = selectAllNext(rows(600), new Set(), null);
    const fresh = selectAllNext(rows(600), new Set(), null);
    expect([...fresh.selected]).toEqual([...first.selected]);
  });
});

describe("isBatchSelected", () => {
  it("is true only while exactly the batch is selected", () => {
    const r = selectAllNext(rows(10), new Set(), null);
    expect(isBatchSelected(r.batch, r.selected)).toBe(true);
    const less = new Set(r.selected);
    less.delete(3);
    expect(isBatchSelected(r.batch, less)).toBe(false);
    expect(isBatchSelected(null, new Set())).toBe(false);
  });
});

describe("canSelectMore", () => {
  it("allows adding up to 250 in total", () => {
    const full = new Set(Array.from({ length: 249 }, (_, i) => i));
    expect(canSelectMore(full, 1)).toBe(true);
    expect(canSelectMore(full, 2)).toBe(false);
  });
});

describe("selectAllNote", () => {
  it("explains a capped batch in plain words", () => {
    expect(selectAllNote(selectAllNext(rows(1200), new Set(), null))).toBe(
      "Selected 250 of the 1,200 matching transactions. A change can apply to at most 250 at a time: apply your change, then press Select all again for the next 250.",
    );
  });

  it("names the size of a smaller next batch", () => {
    const first = selectAllNext(rows(300), new Set(), null);
    expect(selectAllNote(first)).toContain("for the next 50.");
  });

  it("says nothing when every matching row is selected", () => {
    expect(selectAllNote(selectAllNext(rows(12), new Set(), null))).toBeNull();
  });
});
