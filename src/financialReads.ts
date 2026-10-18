import { createTransactionClient } from "./transactionReads";
import { TransactionError } from "./transactionContracts";
import {
  validateBudgetSnapshot,
  validateReportSnapshot,
  validateDashboardSnapshot,
  validateReportSummarySnapshot,
} from "./financialContracts";
import { toLocalIsoDate } from "./format";
import { validateAskVaultSnapshot, type AskKnownPeople } from "./askVault/contract";
import type { AskVaultRequest, AskVaultRequestV2 } from "./askVault/types";
import { validateBaselineBatchRequest, validateBaselineBatchSnapshot, type AskBaselineBatchRequest } from "./askVault/cutPreviewBatch";
export function createFinancialClient() {
  const client = createTransactionClient();
  async function read<T extends { context: { generation: number; sessionRevision: number } }>(
    command: string,
    args: Record<string, unknown>,
    validate: (value: unknown) => T,
  ): Promise<T> {
    const origin = await client.context();
    const result = validate(await client.call(command, args, true));
    // Disposal must also reject replies already dispatched before unmount.
    await client.context();
    if (result.context.generation !== origin.generation || result.context.sessionRevision !== origin.sessionRevision)
      throw new TransactionError("stale_profile", "These totals belong to another profile session.");
    return result;
  }
  return {
    askVaultBaselines: async (request: AskBaselineBatchRequest) => {
      const captured = validateBaselineBatchRequest(request);
      const today = toLocalIsoDate();
      const result = await read("get_ask_vault_baselines", { request: captured }, value => validateBaselineBatchSnapshot(value, captured));
      if (result.asOf !== today || toLocalIsoDate() !== today) throw new TransactionError("invalid_response", "The baseline bundle belongs to another date.");
      return result;
    },
    dashboard: async () => {
      const today = toLocalIsoDate();
      const result = await read("get_dashboard_snapshot", {}, validateDashboardSnapshot);
      if (result.asOf !== today)
        throw new TransactionError("invalid_response", "The dashboard response belongs to another date.");
      return result;
    },
    reportSummary: async () => {
      const today = toLocalIsoDate();
      const result = await read("get_report_summary_snapshot", {}, validateReportSummarySnapshot);
      if (result.asOf !== today)
        throw new TransactionError("invalid_response", "The export response belongs to another date.");
      return result;
    },
    budget: async (year: number, month: number) => {
      const result = await read("get_budget_snapshot", { year, month }, validateBudgetSnapshot);
      if (result.year !== year || result.month !== month)
        throw new TransactionError("invalid_response", "The budget response belongs to another month.");
      return result;
    },
    report: async (fromYear: number, fromMonth: number, toYear: number, toMonth: number) => {
      const result = await read(
        "get_report_range_snapshot",
        { fromYear, fromMonth, toYear, toMonth },
        validateReportSnapshot,
      );
      if (
        result.fromYear !== fromYear ||
        result.fromMonth !== fromMonth ||
        result.toYear !== toYear ||
        result.toMonth !== toMonth
      )
        throw new TransactionError("invalid_response", "The report response belongs to another range.");
      return result;
    },
    /** One exact spending read for Ask the Vault. The request is typed data only, never question text. */
    askVault: async (request: AskVaultRequest | AskVaultRequestV2, known?: AskKnownPeople) => {
      const today = toLocalIsoDate();
      // Capture the independent roster before awaiting IPC; a later UI update must not change what this reply is checked against.
      const familyMembers = known?.familyMembers?.map(member => ({ ...member }));
      const version2 = "contractVersion" in request && request.contractVersion === 2;
      if (version2 && (request as AskVaultRequestV2).groupBy === "member" && !familyMembers)
        throw new TransactionError("invalid_response", "The family member list is unavailable. Reload and ask again.");
      const result = version2
        ? await read("get_ask_vault_snapshot", { request }, value => validateAskVaultSnapshot(value, request as AskVaultRequestV2, { familyMembers }))
        : await read("get_ask_vault_snapshot", { request }, value => validateAskVaultSnapshot(value, request));
      if (result.asOf !== today)
        throw new TransactionError("invalid_response", "The answer belongs to another date.");
      return result;
    },
    dispose: client.dispose,
  };
}
