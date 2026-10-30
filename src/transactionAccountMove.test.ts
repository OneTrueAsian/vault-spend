import { describe, expect, it } from "vitest";
import { effectLine, effectReason, movedMessage, validateMovePreview, validateMoveResult } from "./transactionAccountMove";
import { previewFixture, resultFixture } from "./transactionAccountMoveFixtures";
import { TransactionError } from "./transactionContracts";

describe("validateMovePreview", () => {
  it("accepts a complete preview", () => {
    expect(validateMovePreview(previewFixture()).preview.token).toBe("abc123");
  });
  const cases: [string, (p: Record<string, unknown>) => void][] = [
    ["a missing blockers list (never read as none)", (p) => delete p.blockers],
    ["a missing warnings list", (p) => delete p.warnings],
    ["a missing token", (p) => { p.token = ""; }],
    ["a money value that is not a decimal string", (p) => { p.total = -9; }],
    ["rows that do not match the counts", (p) => { p.selectedCount = 3; }],
    ["counts that do not add up", (p) => { p.alreadyThereCount = 1; }],
    ["a row with an unknown status", (p) => { (p.rows as { status: string }[])[0].status = "maybe"; }],
    ["a plan that can commit while blockers exist", (p) => { p.blockers = [{ code: "settled", count: 1, summary: "x", items: [{ transactionId: 1, detail: "y" }] }]; }],
    ["a plan that can commit with nothing to move", (p) => { p.effectiveCount = 0; p.alreadyThereCount = 2; (p.rows as { status: string }[]).forEach((r) => { r.status = "already_there"; }); }],
    ["an effect without its balance", (p) => delete (p.effects as Record<string, unknown>[])[0].projected],
  ];
  it.each(cases)("rejects %s", (_name, mutate) => {
    const response = structuredClone(previewFixture()) as unknown as { preview: Record<string, unknown> };
    mutate(response.preview);
    expect(() => validateMovePreview(response)).toThrow(TransactionError);
  });
  it("rejects a wrong contract version and a non-object", () => {
    expect(() => validateMovePreview({ ...previewFixture(), contractVersion: 1 })).toThrow(/incomplete move preview/);
    expect(() => validateMovePreview(null)).toThrow(TransactionError);
  });
});

describe("validateMoveResult", () => {
  it("accepts each status", () => {
    expect(validateMoveResult(resultFixture()).status).toBe("moved");
    expect(validateMoveResult(resultFixture({ status: "nothing_to_move", movedIds: [], movedCount: 0, alreadyThereIds: [3], alreadyThereCount: 1 })).alreadyThereCount).toBe(1);
    expect(validateMoveResult(resultFixture({ status: "stale_preview", movedIds: [], movedCount: 0 })).status).toBe("stale_preview");
  });
  it("rejects results that contradict themselves", () => {
    expect(() => validateMoveResult(resultFixture({ movedCount: 5 }))).toThrow(TransactionError);
    expect(() => validateMoveResult(resultFixture({ movedIds: [], movedCount: 0 }))).toThrow(TransactionError);
    expect(() => validateMoveResult(resultFixture({ status: "blocked", movedIds: [], movedCount: 0 }))).toThrow(TransactionError);
    expect(() => validateMoveResult(resultFixture({ status: "stale_preview" }))).toThrow(TransactionError);
    expect(() => validateMoveResult({ status: "moved" })).toThrow(TransactionError);
  });
});

describe("wording", () => {
  it("says what moved and what was already there, in the right plural", () => {
    expect(movedMessage({ movedCount: 42, alreadyThereCount: 3 }, "Savings")).toBe("Moved 42 transactions to Savings. 3 were already there.");
    expect(movedMessage({ movedCount: 1, alreadyThereCount: 1 }, "Savings")).toBe("Moved 1 transaction to Savings. 1 was already there.");
    expect(movedMessage({ movedCount: 2, alreadyThereCount: 0 }, "Savings")).toBe("Moved 2 transactions to Savings.");
  });
  it("describes balances in each account's own terms", () => {
    const base = previewFixture().preview.effects[0];
    expect(effectLine({ ...base, label: "Owed", current: "125.50", projected: "0.00" })).toBe("Owed $125.50 → $0.00");
    // why a balance goes the way it does, for the ordinary "Balance" case only
    const plain = { ...base, label: "Balance" as const, movedCount: 9 };
    expect(effectReason({ ...plain, role: "source", current: "-6857.38", projected: "-11123.79" })).toBe("Taking them out lowers this balance by $4,266.41, because together they added money to it.");
    expect(effectReason({ ...plain, role: "source", current: "991.00", projected: "1000.00" })).toBe("Taking them out raises this balance by $9.00, because together they took money out of it.");
    expect(effectReason({ ...plain, role: "destination", current: "0.00", projected: "4266.41" })).toBe("Bringing them in raises this balance by $4,266.41, because together they add money to it.");
    expect(effectReason({ ...plain, role: "destination", current: "500.00", projected: "491.00" })).toBe("Bringing them in lowers this balance by $9.00, because together they take money out of it.");
    expect(effectReason({ ...plain, role: "source", current: "5.00", projected: "5.00" })).toBeNull();
    expect(effectReason({ ...plain, label: "Owed", role: "source", current: "125.50", projected: "0.00" })).toBeNull();
    expect(effectLine({ ...base, label: "Holdings value", current: "2500.00", projected: "2500.00", holdingsOverride: true })).toBe("Holdings value $2,500.00, unchanged (it follows your holdings)");
  });
});
