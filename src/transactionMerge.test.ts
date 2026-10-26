import { expect, it } from "vitest";
import type { Transaction } from "./types";
import fixture from "../core/tests/fixtures/desktop_transaction.json";
import { mergeTransactionRows } from "./transactionMerge";
const row=(id:number):Transaction=>({...fixture,id} as Transaction);
it("preserves full-model order and exact money while replacing survivors and removing deletions",()=>{
 const first=row(3),second=row(1),third=row(2),updated={...second,notes:"edited"};
 const result=mergeTransactionRows([first,second,third],[1,2],[updated]);
 expect(result.transactions).toEqual([first,updated]);expect(result.transactions[0]).toBe(first);expect(result.transactions[1].amount).toBe("9007199254740992.01");expect(result.hasNewRows).toBe(false);
});
it("marks inserted rows for a full fallback rather than appending them at an arbitrary position",()=>{
 const result=mergeTransactionRows([row(1)],[2],[row(2)]);expect(result.hasNewRows).toBe(true);expect(result.transactions.map(r=>r.id)).toEqual([1]);
});
it("treats a missing/deleted requested identifier as removal without mutating the input",()=>{
 const previous=[row(1),row(2)];expect(mergeTransactionRows(previous,[1,99],[]).transactions.map(r=>r.id)).toEqual([2]);expect(previous).toHaveLength(2);
});
