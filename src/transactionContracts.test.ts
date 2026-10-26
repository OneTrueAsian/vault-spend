import { expect, it, vi } from "vitest";
import { invoke } from "@tauri-apps/api/core";
import { transactionReads } from "./transactionReads";
import sharedFixture from "../core/tests/fixtures/desktop_transaction.json";
vi.mock("@tauri-apps/api/core", () => ({ invoke: vi.fn() }));

const row = { id: 1, transfer_counterpart_id: null, date: "2026-10-01", description: "Fixture", amount: "9007199254740992.01",
  category: null, category_source: null, confidence: null, account_id: 1, account_name: "Checking",
  applied_to_debt: null, principal_amount: null, split_count: 0, tags: [], member_id: null, member_name: null, notes: null };

it("keeps decimal-string money and required nullable fields unchanged", async () => {
  vi.mocked(invoke).mockResolvedValue([sharedFixture]);
  expect(await transactionReads.list()).toEqual([sharedFixture]);
});

it("rejects numeric money, missing nullable fields, unsafe identifiers and invalid calendar dates", async () => {
  for (const change of [{ amount: 12.34 }, { notes: undefined }, { id: Number.MAX_SAFE_INTEGER + 1 }, { date: "2026-02-30" }, { tags: [null] }]) {
    vi.mocked(invoke).mockResolvedValue([{ ...row, ...change }]);
    await expect(transactionReads.list()).rejects.toMatchObject({ code: "invalid_response" });
  }
});

it("retains machine-readable refusals when user-facing wording changes", async () => {
  for (const message of ["Profile changed.", "Please reopen your profile."]) {
    vi.mocked(invoke).mockRejectedValue({ code: "stale_profile", message });
    await expect(transactionReads.list()).rejects.toMatchObject({ code: "stale_profile", message });
  }
  vi.mocked(invoke).mockRejectedValue("PROFILE_LOCKED: Unlock to continue.");
  await expect(transactionReads.list()).rejects.toMatchObject({ code: "profile_locked", message: "Unlock to continue." });
});
