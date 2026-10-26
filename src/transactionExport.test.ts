import { beforeEach, expect, it, vi } from "vitest";
import { save } from "./nativeDialog";
import { createTransactionExporter } from "./transactionExport";
import type { Transaction } from "./types";
import fixture from "../core/tests/fixtures/desktop_transaction.json";
vi.mock("./nativeDialog", () => ({ save: vi.fn() }));
const call=vi.fn(); const status=vi.fn(); const confirmPlaintext=vi.fn();
beforeEach(() => { vi.resetAllMocks(); vi.mocked(save).mockResolvedValue("fixture.csv"); call.mockResolvedValue(null); });
it("exports every matching transfer leg with decimal strings, tags and notes intact", async () => {
  const rows: Transaction[] = [{ ...fixture,transfer_counterpart_id: 2,tags:["work"],notes:"Fixture note" },{ ...fixture,id: 2,transfer_counterpart_id: 1,amount:"-9007199254740992.01" }];
  await createTransactionExporter({ rows,isProtected:false,confirmPlaintext,call,onStatus:status })();
  const content=call.mock.calls[0][1].content;
  expect(content).toContain("9007199254740992.01"); expect(content).toContain("-9007199254740992.01"); expect(content).toContain("Fixture note"); expect(content).toContain("work");
  expect(status).toHaveBeenCalledWith("Exported 2 transaction(s) to fixture.csv.","success");
});
it("cancelling the protected-profile disclosure never opens a picker or writes a file", async () => {
  confirmPlaintext.mockResolvedValue(false);
  await createTransactionExporter({ rows:[],isProtected:true,confirmPlaintext,call,onStatus:status })();
  expect(save).not.toHaveBeenCalled(); expect(call).not.toHaveBeenCalled();
});
