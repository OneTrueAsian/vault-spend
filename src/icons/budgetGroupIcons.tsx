import { CalendarClock, ShoppingBag, Receipt, Wallet, type LucideIcon } from "lucide-react";

/** Keyed by `budget_group` (income/fixed/flexible/nonmonthly) — the same
 * four values both DashboardView.tsx and BudgetView.tsx already key their
 * own separately-declared `GROUP_LABELS` off of. */
const BUDGET_GROUP_ICONS: Record<string, LucideIcon> = {
  income: Wallet,
  fixed: Receipt,
  flexible: ShoppingBag,
  nonmonthly: CalendarClock,
};

export function iconForBudgetGroup(group: string): LucideIcon {
  return BUDGET_GROUP_ICONS[group] ?? Receipt;
}

export function BudgetGroupIcon({ group, className }: { group: string; className?: string }) {
  const Icon = iconForBudgetGroup(group);
  return <Icon className={className} aria-hidden="true" />;
}
