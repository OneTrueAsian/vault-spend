import { describe, expect, it } from "vitest";
import fixture from "../core/tests/fixtures/desktop_transaction.json";
import { validateTransactionWireSnapshot } from "./compactTransactionContracts";
const strings = [
  fixture.date,
  fixture.description,
  fixture.amount,
  fixture.account_name,
  "duplicate",
  "Synthetic detail",
];
const wire = () => ({
  contractVersion: 2,
  context: { contractVersion: 1, generation: 4, sessionRevision: 7 },
  revision: { local: 1, external: 1 },
  requestedIds: null,
  strings: [...strings],
  rows: [
    [fixture.id, null, 0, 1, 2, null, null, null, fixture.account_id, 3, null, null, 0, [], null, null, null],
  ] as unknown[][],
  stats: { total: 1, auto_categorized: 0, user_confirmed: 0, uncategorized: 1 },
  accounts: [],
  categories: [],
  categoryIcons: [],
  flags: [[fixture.id, 4, 5]],
  tags: [],
  members: [],
});
describe("compact full-model wire contract", () => {
  it("decodes the independent Rust precision fixture without retaining packed arrays", () => {
    const result = validateTransactionWireSnapshot(wire());
    expect(result.transactions).toEqual([fixture]);
    expect(result.flags).toEqual([{ transaction_id: fixture.id, kind: "duplicate", detail: "Synthetic detail" }]);
    expect(result).not.toHaveProperty("strings");
    expect(result).not.toHaveProperty("rows");
  });
  it("refuses bad references, tuple shapes, versions, calendar/money and identity", () => {
    for (const change of [
      (w: ReturnType<typeof wire>) => {
        w.rows[0][2] = 999;
      },
      (w) => {
        w.rows[0].pop();
      },
      (w) => {
        w.contractVersion = 3;
      },
      (w) => {
        w.strings[0] = "2026-02-30";
      },
      (w) => {
        w.strings[2] = "Infinity";
      },
      (w) => {
        w.context.generation = Number.MAX_SAFE_INTEGER + 1;
      },
      (w) => {
        w.flags[0][2] = -1;
      },
    ] as ((w: ReturnType<typeof wire>) => void)[]) {
      const value = wire();
      change(value);
      expect(() => validateTransactionWireSnapshot(value)).toThrow();
    }
  });
  it("preserves nested payment, tags, principal, member and multiline notes", () => {
    const value = wire();
    value.strings.push("2026-10-02", "Loan", "12.30", "tag", "Person", "line one\n=literal");
    value.rows[0] = [
      1,
      2,
      0,
      1,
      2,
      null,
      null,
      0.5,
      1,
      3,
      [6, 3, 7, 8],
      8,
      2,
      [9],
      4,
      10,
      11,
    ] as (typeof value.rows)[number];
    const row = validateTransactionWireSnapshot(value).transactions[0];
    expect(row.applied_to_debt).toEqual({
      date: "2026-10-02",
      debt_account_id: 3,
      debt_account_name: "Loan",
      amount: "12.30",
    });
    expect(row.tags).toEqual(["tag"]);
    expect(row.principal_amount).toBe("12.30");
    expect(row.notes).toBe("line one\n=literal");
    expect(row.transfer_counterpart_id).toBe(2);
  });
});
