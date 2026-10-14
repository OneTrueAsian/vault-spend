import type { AccountKind } from "./statementContracts";

const SCALE = 4;
const UNIT = 10n ** BigInt(SCALE);

/** An amount string as an exact integer of 1/10,000ths. */
export function toUnits(s: string): bigint {
  const m = /^(-?)(\d*)(?:\.(\d+))?$/.exec(s.trim());
  if (!m || (m[2] === "" && m[3] === undefined) || (m[3] ?? "").length > SCALE) throw new Error(`Not an amount: ${s}`);
  const value = BigInt(m[2] || "0") * UNIT + BigInt((m[3] ?? "").padEnd(SCALE, "0") || "0");
  return m[1] ? -value : value;
}

/** Back to a string with at least two decimals. */
export function fromUnits(u: bigint): string {
  const negative = u < 0n;
  const a = negative ? -u : u;
  let frac = (a % UNIT).toString().padStart(SCALE, "0").replace(/0+$/, "");
  if (frac.length < 2) frac = frac.padEnd(2, "0");
  return `${negative && a !== 0n ? "-" : ""}${a / UNIT}.${frac}`;
}

export const addAmounts = (values: string[]) => fromUnits(values.reduce((sum, v) => sum + toUnits(v), 0n));

/** How a transaction moves the statement's balance (mirrors `balance_change` in Rust). A loan payment
 * lowers the loan by its principal part when it has one, otherwise by the whole amount. */
export function changeFor(kind: AccountKind, amount: string, principal?: string | null): string {
  if (kind === "loan") return fromUnits(-toUnits(principal ?? amount));
  return kind === "credit" ? fromUnits(-toUnits(amount)) : fromUnits(toUnits(amount));
}

/** end − (start + Σ changes). */
export const statementDifference = (end: string, start: string, changes: string[]) =>
  fromUnits(toUnits(end) - (toUnits(start) + changes.reduce((sum, c) => sum + toUnits(c), 0n)));

export const isZero = (s: string) => toUnits(s) === 0n;
