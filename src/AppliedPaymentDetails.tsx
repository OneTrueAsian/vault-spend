import "./AppliedPaymentDetails.css";
import type { Transaction } from "./types";
import { formatAmount, formatDisplayDate } from "./format";

/** Always visible, even when creating new debt applications is disabled. */
export function AppliedPaymentDetails({ transaction }: { transaction: Transaction }) {
  const payment = transaction.applied_to_debt;
  if (!payment) return null;
  return (
    <div className="applied-payment-details">
      <span>{transaction.account_name} → {payment.debt_account_name}</span>
      <span>Applied {formatAmount(payment.amount)}{payment.date !== transaction.date ? ` on ${formatDisplayDate(payment.date)}` : ""}</span>
    </div>
  );
}
