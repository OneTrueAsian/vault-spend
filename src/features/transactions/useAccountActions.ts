import type { TransactionSnapshot } from "../../shared/native/transactionContracts";
import { type StatusKind } from "../../shared/native/appTypes";
import { type Account, type DebtPayoffPlan } from "../../shared/lib/types";
import { errorMessage } from "../../shared/lib/errorMessage";

export function useAccountActions({ invoke, refresh, setStatus, accounts }: {
  invoke: <T>(command: string, args?: Record<string, unknown> | undefined) => Promise<T>;
  refresh: () => Promise<TransactionSnapshot>;
  setStatus: (text: string, kind?: StatusKind) => void;
  accounts: Account[];
}) {
  async function handleSetStartingBalance(accountId: number, balance: string) {
    try {
      await invoke("set_account_starting_balance", { id: accountId, balance });
      await refresh();
    } catch (e) {
      setStatus(errorMessage(e));
    }
  }

  async function handleSetBalanceOverride(accountId: number, balance: string) {
    try {
      await invoke("set_account_balance_override", { id: accountId, balance });
      await refresh();
    } catch (e) {
      setStatus(errorMessage(e));
    }
  }

  async function handleUpdateAccountType(accountId: number, accountType: string) {
    try {
      await invoke("update_account_type", { id: accountId, accountType });
      await refresh();
    } catch (e) {
      setStatus(errorMessage(e));
    }
  }

  async function handleSetAccountIcon(accountId: number, iconKey: string | null) {
    try {
      await invoke("set_account_icon", { id: accountId, iconKey });
      await refresh();
    } catch (e) {
      setStatus(errorMessage(e));
    }
  }

  /** Hides or shows an account. Nothing about its money changes; it only moves between the Accounts list and the Hidden accounts section. */
  async function handleSetAccountHidden(accountId: number, hidden: boolean) {
    try {
      await invoke("set_account_hidden", { id: accountId, hidden });
      await refresh();
      const name = accounts.find((a) => a.id === accountId)?.name ?? "The account";
      setStatus(
        hidden ? `${name} is hidden. It is still counted in your totals. Find it under Hidden accounts.` : `${name} is showing again.`,
        "success",
      );
    } catch (e) {
      setStatus(errorMessage(e));
    }
  }

  async function handleDeleteAccount(accountId: number) {
    try {
      const removed = await invoke<number>("delete_account", { id: accountId });
      await refresh();
      setStatus(`Deleted account and ${removed} transaction${removed === 1 ? "" : "s"}.`, "success");
    } catch (e) {
      setStatus(errorMessage(e));
    }
  }

  async function handleSetAccountDetails(accountId: number, institution: string | null, mask: string | null) {
    try {
      await invoke("set_account_details", { id: accountId, institution, mask });
      await refresh();
    } catch (e) {
      setStatus(errorMessage(e));
    }
  }

  async function handleSetAccountInterestRate(accountId: number, rate: string | null) {
    try {
      await invoke("set_account_interest_rate", { id: accountId, rate });
      await refresh();
    } catch (e) {
      setStatus(errorMessage(e));
    }
  }

  async function handleSetAccountExcludedFromDebtPayoff(accountId: number, excluded: boolean) {
    try {
      await invoke("set_account_excluded_from_debt_payoff", { id: accountId, excluded });
      await refresh();
    } catch (e) {
      setStatus(errorMessage(e));
    }
  }

  async function handleCalculateDebtPayoff(
    strategy: string,
    extraPayment: string,
    minimums: { accountId: number; minimumPayment: string }[],
  ): Promise<DebtPayoffPlan | null> {
    try {
      return await invoke<DebtPayoffPlan>("debt_payoff_projection", {
        strategy,
        extraPayment,
        minimums: minimums.map((m) => ({ account_id: m.accountId, minimum_payment: m.minimumPayment })),
      });
    } catch (e) {
      setStatus(errorMessage(e));
      return null;
    }
  }

  async function handleSetAccountMember(accountId: number, memberId: number | null) {
    try {
      await invoke("set_account_member", { id: accountId, memberId });
      await refresh();
    } catch (e) {
      setStatus(errorMessage(e));
    }
  }

  return { handleSetStartingBalance, handleSetBalanceOverride, handleUpdateAccountType, handleSetAccountIcon, handleSetAccountHidden, handleDeleteAccount, handleSetAccountDetails, handleSetAccountInterestRate, handleSetAccountExcludedFromDebtPayoff, handleCalculateDebtPayoff, handleSetAccountMember };
}
