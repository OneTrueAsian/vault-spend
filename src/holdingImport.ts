export type HoldingMapping = { symbol: number; name: number | null; shares: number; price: number; cost_basis: number; asset_class: number | null };
export type HoldingSource = { id: string; headers: string[]; samples: string[][]; row_count: number };
export type ImportedHolding = { symbol: string; name: string; shares: string; price: string; cost_basis: string; asset_class: string | null };
export type HoldingImportRow = { row_number: number; holding: ImportedHolding | null; error: string | null; repeated: boolean; already_exists: boolean; value: string | null };
export type HoldingPreview = { rows: HoldingImportRow[]; account_name: string; current_value: string; holdings_value: string; has_holdings: boolean };
export type ImportDirectory = { path: string; parent: string | null; entries: { name: string; path: string; directory: boolean }[] };

export const HOLDING_FIELDS = [
  { key: "symbol", label: "Symbol", aliases: ["symbol", "ticker"] },
  { key: "name", label: "Name (optional)", aliases: ["name", "description", "security name"] },
  { key: "shares", label: "Shares", aliases: ["shares", "quantity", "qty"] },
  { key: "price", label: "Price per share", aliases: ["price", "last price", "price per share", "current price"] },
  { key: "cost_basis", label: "What you paid in total", aliases: ["cost basis", "total cost", "cost basis total"] },
  { key: "asset_class", label: "Asset class (optional)", aliases: ["asset class", "class"] },
] as const;

export function suggestHoldingMapping(headers: string[]): Record<keyof HoldingMapping, string> {
  return Object.fromEntries(HOLDING_FIELDS.map(field => {
    const matches = headers.flatMap((h, i) => (field.aliases as readonly string[]).includes(h.trim().toLowerCase()) ? [String(i)] : []);
    return [field.key, matches.length === 1 ? matches[0] : ""];
  })) as Record<keyof HoldingMapping, string>;
}

export function mappingFromDraft(draft: Record<keyof HoldingMapping, string>): HoldingMapping | null {
  if (["symbol", "shares", "price", "cost_basis"].some(key => draft[key as keyof HoldingMapping] === "")) return null;
  const chosen = Object.values(draft).filter(value => value !== "");
  if (new Set(chosen).size !== chosen.length) return null;
  return Object.fromEntries(Object.entries(draft).map(([key, value]) => [key, value === "" ? null : Number(value)])) as HoldingMapping;
}

/** Preview totals use exact decimal strings; no binary floating point or per-row rounding. */
export function addHoldingValues(values: string[]): string {
  const scale = Math.max(0, ...values.map(value => (value.split(".")[1] ?? "").length));
  const factor = 10n ** BigInt(scale);
  const total = values.reduce((sum, value) => {
    const negative = value.startsWith("-");
    const [whole, fraction = ""] = value.replace(/^-/, "").split(".");
    const amount = BigInt(whole) * factor + BigInt(fraction.padEnd(scale, "0") || "0");
    return sum + (negative ? -amount : amount);
  }, 0n);
  const sign = total < 0n ? "-" : "";
  const digits = (total < 0n ? -total : total).toString().padStart(scale + 1, "0");
  return scale ? `${sign}${digits.slice(0, -scale)}.${digits.slice(-scale)}` : sign + digits;
}

/** Keep every stored digit visible while matching the app's dollar formatting. */
export function formatHoldingAmount(value: string): string {
  const negative = value.startsWith("-");
  const [whole, fraction = ""] = value.replace(/^-/, "").split(".");
  return `${negative ? "-" : ""}$${BigInt(whole).toLocaleString("en-US")}.${fraction.replace(/0+$/, "").padEnd(2, "0")}`;
}

export const HOLDING_SAMPLE = "Symbol,Name,Shares,Price,Cost Basis,Asset Class\nVTI,Total market fund,10.5,250.00,2400.00,Stocks\nBND,Bond fund,20,75.00,1400.00,Bonds\n";
