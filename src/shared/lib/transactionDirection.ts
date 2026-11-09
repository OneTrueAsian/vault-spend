import { isValidDecimalString } from "./format";

/** Which way a new transaction moves money: out of the account (a negative amount) or in. */
export type Direction = "out" | "in";

/** What was typed with one leading sign (`-`, `−` or `+`) dropped, because the switch decides the
 * sign: typing `-50` out of habit with "Money out" chosen still means 50 out, never +50. */
function unsigned(typed: string): string {
  const rest = typed.trim();
  return /^[-−+]/.test(rest) ? rest.slice(1).trim() : rest;
}

/** Why a typed amount can't be saved, or `null` when it can. */
export function amountProblem(typed: string): "empty" | "not_a_number" | "zero" | null {
  if (typed.trim() === "") return "empty";
  const rest = unsigned(typed);
  if (rest === "" || /^[-−+]/.test(rest) || !isValidDecimalString(rest)) return "not_a_number";
  if (Number(rest) === 0) return "zero";
  return null;
}

/** The amount to store for what was typed, signed by the Money out / Money in switch, or `null`
 * when `amountProblem` refuses it. The typed digits are kept as written ("12.5" stays "12.5"). */
export function signedAmount(typed: string, direction: Direction): string | null {
  if (amountProblem(typed) !== null) return null;
  const rest = unsigned(typed);
  return direction === "out" ? `-${rest}` : rest;
}

/** The switch's two labels. A card or loan balance is money owed, so "money out" is a charge and
 * "money in" is a payment toward it. */
export function directionLabels(accountType: string | undefined): [outLabel: string, inLabel: string] {
  return accountType === "credit" || accountType === "loan" ? ["Charge", "Payment"] : ["Money out", "Money in"];
}
