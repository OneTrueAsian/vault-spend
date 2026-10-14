/** Exact arithmetic and display on decimal strings. No floating point is ever used for money here. */

const NON_NEGATIVE = /^\d+(?:\.\d+)?$/;
const ANY = /^-?\d+(?:\.\d+)?$/;

/** A plain non-negative decimal string, the shape the native read returns. */
export function isMoney(value: unknown): value is string {
  return typeof value === "string" && NON_NEGATIVE.test(value);
}

function parse(value: string): { units: bigint; scale: number } {
  if (!ANY.test(value)) throw new Error("Not a decimal amount.");
  const negative = value.startsWith("-");
  const [whole, fraction = ""] = (negative ? value.slice(1) : value).split(".");
  const units = BigInt(whole + fraction);
  return { units: negative ? -units : units, scale: fraction.length };
}

function align(a: string, b: string): [bigint, bigint, number] {
  const x = parse(a);
  const y = parse(b);
  const scale = Math.max(x.scale, y.scale);
  return [x.units * 10n ** BigInt(scale - x.scale), y.units * 10n ** BigInt(scale - y.scale), scale];
}

function render(units: bigint, scale: number): string {
  const negative = units < 0n;
  let digits = (negative ? -units : units).toString().padStart(scale + 1, "0");
  let text = scale === 0 ? digits : `${digits.slice(0, digits.length - scale)}.${digits.slice(digits.length - scale)}`;
  if (text.includes(".")) text = text.replace(/0+$/, "").replace(/\.$/, "");
  digits = text;
  return negative && text !== "0" ? `-${digits}` : digits;
}

/** `a + b`, exact, trailing zeros trimmed. */
export function addMoney(a: string, b: string): string {
  const [x, y, scale] = align(a, b);
  return render(x + y, scale);
}

/** `a - b`, exact, trailing zeros trimmed. */
export function subtractMoney(a: string, b: string): string {
  const [x, y, scale] = align(a, b);
  return render(x - y, scale);
}

/** -1, 0 or 1 by value. */
export function compareMoney(a: string, b: string): -1 | 0 | 1 {
  const [x, y] = align(a, b);
  return x < y ? -1 : x > y ? 1 : 0;
}

/** "$1,234.50". Always two decimals; extra decimals round half away from zero for display only. */
export function formatMoney(value: string): string {
  const { units, scale } = parse(value);
  const negative = units < 0n;
  let abs = negative ? -units : units;
  if (scale > 2) {
    const divisor = 10n ** BigInt(scale - 2);
    const quotient = abs / divisor;
    abs = abs % divisor * 2n >= divisor ? quotient + 1n : quotient;
  } else {
    abs *= 10n ** BigInt(2 - scale);
  }
  const text = abs.toString().padStart(3, "0");
  const whole = text.slice(0, -2).replace(/\B(?=(\d{3})+(?!\d))/g, ",");
  const cents = text.slice(-2);
  return `${negative && abs !== 0n ? "-" : ""}$${whole}.${cents}`;
}
