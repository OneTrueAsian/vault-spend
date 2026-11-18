import { describe, expect, it } from "vitest";
import { ledgerSignature } from "./ledgerSignature";

const base = { id: 1, date: "2026-10-01", description: "Costco", amount: "-10.00", category: "Groceries", account_id: 1, split_count: 0, transfer_counterpart_id: null };

describe("ledgerSignature", () => {
  it("is the same for a reloaded copy of the same ledger", () => {
    expect(ledgerSignature([base, { ...base, id: 2 }])).toBe(ledgerSignature([{ ...base }, { ...base, id: 2 }]));
  });

  it("changes when a purchase is added, removed or edited in a way that affects answers", () => {
    const before = ledgerSignature([base]);
    expect(ledgerSignature([base, { ...base, id: 2 }])).not.toBe(before);
    expect(ledgerSignature([])).not.toBe(before);
    for (const edit of [{ amount: "-11.00" }, { category: "Dining Out" }, { date: "2026-10-02" }, { description: "Target" }, { account_id: 2 }, { split_count: 2 }, { transfer_counterpart_id: 9 }]) {
      expect(ledgerSignature([{ ...base, ...edit }])).not.toBe(before);
    }
  });

  it("ignores changes that cannot change an answer", () => {
    expect(ledgerSignature([{ ...base, ...({ notes: "hi", tags: ["a"], member_id: 3 } as object) }])).toBe(ledgerSignature([base]));
  });
});
