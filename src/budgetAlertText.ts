import type { BudgetAlert } from "./types";

type AlertForText = Pick<BudgetAlert, "category" | "level"> & Partial<Pick<BudgetAlert, "budgeted" | "actual">>;

/** "A", "A and B", or "A, B and N more": at most two names, then a count. */
function nameList(names: string[]): string {
  if (names.length <= 1) return names[0] ?? "";
  if (names.length === 2) return `${names[0]} and ${names[1]}`;
  return `${names[0]}, ${names[1]} and ${names.length - 2} more`;
}

/** A warning sitting exactly at its budget: it's used in full, not "close" (the Budget row's badge
 * says "Used in full" for the same case). Compared in cents so float noise can't matter. */
export function isUsedInFull(a: AlertForText): boolean {
  if (a.level !== "warning" || a.budgeted === undefined || a.actual === undefined) return false;
  return Math.round(parseFloat(a.budgeted) * 100) === Math.round(parseFloat(a.actual) * 100);
}

/** The Dashboard's budget alert banner, naming the categories instead of counting them:
 * "Dining is over its budget; Groceries, Fuel and 2 more are close to theirs". Over budget comes
 * first, then close, then used exactly in full. Empty when there's nothing to say. */
export function describeBudgetAlerts(alerts: AlertForText[]): string {
  const over = alerts.filter((a) => a.level === "over").map((a) => a.category);
  const close = alerts.filter((a) => a.level === "warning" && !isUsedInFull(a)).map((a) => a.category);
  const used = alerts.filter(isUsedInFull).map((a) => a.category);
  const parts: string[] = [];
  if (over.length > 0) {
    parts.push(`${nameList(over)} ${over.length === 1 ? "is over its budget" : "are over their budgets"}`);
  }
  if (close.length > 0) {
    if (close.length === 1) parts.push(`${nameList(close)} is close to its budget`);
    else parts.push(`${nameList(close)} are close to ${parts.length > 0 ? "theirs" : "their budgets"}`);
  }
  if (used.length > 0) {
    if (used.length === 1) parts.push(`${nameList(used)} has used its whole budget`);
    else parts.push(`${nameList(used)} have used ${parts.length > 0 ? "all of theirs" : "their whole budgets"}`);
  }
  return parts.join("; ");
}
