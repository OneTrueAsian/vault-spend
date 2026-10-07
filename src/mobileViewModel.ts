import type { MonthBreakdown, MobileSnapshotV1 } from "./mobileSnapshotTypes";
const SCALE = 1000000000000n;
/** Snapshot decimals are exact through twelve places. Never sum monetary strings as doubles. */
export function units(value: string): bigint {
    if (!/^-?\d+(\.\d{1,12})?$/.test(value))
        throw new Error("Invalid decimal");
    const [whole, fraction = ""] = value.replace("-", "").split(".");
    return (BigInt(whole) * SCALE + BigInt(fraction.padEnd(12, "0"))) * (value.startsWith("-") ? -1n : 1n);
}
export function decimal(value: bigint): string {
    const n = value < 0n ? -value : value;
    const fraction = (n % SCALE).toString().padStart(12, "0").replace(/0+$/, "");
    return `${value < 0n ? "-" : ""}${n / SCALE}${fraction ? "." + fraction : ""}`;
}
export function addMoney(values: string[]): string { return decimal(values.reduce((sum, v) => sum + units(v), 0n)); }
export function subtract(a: string, b: string): string { return decimal(units(a) - units(b)); }
export function averageMoney(values:string[]):string|null {
    if(values.length===0)return null;
    const sum=values.reduce((s,v)=>s+units(v),0n),count=BigInt(values.length);
    return decimal((sum<0n?-1n:1n)*((sum<0n?-sum:sum)+count/2n)/count);
}
export function money(value: string | number | null, hidden = false): string {
    if (hidden)
        return "••••";
    if (value === null)
        return "Unavailable";
    if (typeof value === "number") {
        if (!Number.isFinite(value) || Math.abs(value) >= 1e21)
            return "Unavailable";
        value = value.toFixed(12);
    }
    const n = units(value);
    const cents = ((n < 0n ? -n : n) + 5000000000n) / 10000000000n;
    return `${n < 0n && cents !== 0n ? "-" : ""}$${(cents / 100n).toLocaleString("en-US")}.${(cents % 100n).toString().padStart(2, "0")}`;
}
export function aggregateBreakdown(rows: MonthBreakdown[], months: string[]) {
    const keys = new Set(months), totals = new Map<string, {
        income: string;
        spending: string;
    }>();
    for (const row of rows)
        if (keys.has(row.month)) {
            const old = totals.get(row.label) ?? { income: "0", spending: "0" };
            totals.set(row.label, { income: addMoney([old.income, row.income]), spending: addMoney([old.spending, row.spending]) });
        }
    return [...totals].map(([label, v]) => ({ label, ...v })).sort((a, b) => units(a.spending) > units(b.spending) ? -1 : units(a.spending) < units(b.spending) ? 1 : a.label.localeCompare(b.label));
}
export function currentBudget(snapshot: MobileSnapshotV1) {
    return snapshot.budgets.find(b => b.month === snapshot.asOfDate.slice(0, 7));
}
export function monthLabel(month: string): string {
    return new Intl.DateTimeFormat("en-US", { month: "long", year: "numeric", timeZone: "UTC" }).format(new Date(month + "-01T00:00:00Z"));
}
export function selectedMonths(snapshot: MobileSnapshotV1, from: string, to: string) {
    return snapshot.history.months.filter(m => m.month >= from && m.month <= to);
}
