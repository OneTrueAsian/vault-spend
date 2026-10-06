import type { Forecast } from "./mobileSnapshotTypes";
import { addMoney, subtract } from "./mobileViewModel";
function valid(n: number, max = 1e12): boolean { return Number.isFinite(n) && n >= 0 && n <= max; }
export function scenarioNumber(text: string, max = 1e12): number {
    if (!/^\d+(\.\d+)?$/.test(text.trim()) || !valid(Number(text), max))
        throw new Error(`Enter a number between 0 and ${max.toLocaleString("en-US")}.`);
    return Number(text);
}
export function loanPayment(principal: number, apr: number, years: number) {
    if (!valid(principal) || !valid(apr, 100) || !Number.isInteger(years) || years < 1 || years > 50)
        throw new Error("Use a positive term of 1 to 50 whole years and an APR from 0 to 100%.");
    const count = years * 12, rate = apr / 1200;
    const monthly = rate === 0 ? principal / count : principal * rate / -Math.expm1(-count * Math.log1p(rate));
    return { monthly, total: monthly * count, interest: Math.max(0, monthly * count - principal) };
}
export interface DebtScenario {
    id: string;
    owed: number;
    apr: number;
    minimum: number;
}
/** Same interest → minimums → ordered extras → freed minimums order and 600-month cap as Store. */
export function debtPayoff(debts: DebtScenario[], extra: number, strategy: "snowball" | "avalanche", today: string) {
    if (!valid(extra) || debts.some(d => !valid(d.owed) || !valid(d.apr, 100) || !valid(d.minimum)))
        throw new Error("Debt balances and payments must be nonnegative; APR must be from 0 to 100%.");
    const scale = 10n ** 28n, fixed = (n: number) => BigInt(n.toFixed(12).replace(".", "")) * 10n ** 16n;
    const numeric = (n: bigint) => Number(n) / 1e28;
    const rows = debts.filter(d => d.owed > 0).map(d => ({ id: d.id, owed: fixed(d.owed), apr: fixed(d.apr), minimum: fixed(d.minimum), paidMonth: null as number | null }));
    let freed = 0n, interest = 0n;
    const points = [{ month: 0, balance: numeric(rows.reduce((s, d) => s + d.owed, 0n)) }];
    for (let m = 1; m <= 600 && rows.some(d => d.paidMonth === null); m++) {
        for (const d of rows)
            if (d.paidMonth === null) {
                const accrued = d.owed * d.apr / (1200n * scale);
                d.owed += accrued;
                interest += accrued;
            }
        const compare = (a: bigint, b: bigint) => a < b ? -1 : a > b ? 1 : 0;
        rows.sort((a, b) => strategy === "avalanche" ? compare(b.apr, a.apr) || compare(a.owed, b.owed) : compare(a.owed, b.owed));
        for (const d of rows)
            if (d.paidMonth === null)
                d.owed = d.owed > d.minimum ? d.owed - d.minimum : 0n;
        let pool = fixed(extra) + freed;
        for (const d of rows) {
            const payment = d.owed < pool ? d.owed : pool;
            d.owed -= payment;
            pool -= payment;
        }
        for (const d of rows)
            if (d.paidMonth === null && d.owed === 0n) {
                d.paidMonth = m;
                freed += d.minimum;
            }
        points.push({ month: m, balance: numeric(rows.reduce((s, d) => s + d.owed, 0n)) });
    }
    const months = rows.some(d => d.paidMonth === null) ? null : Math.max(0, ...rows.map(d => d.paidMonth!));
    const payoffDate = (months: number) => { let date = today; for (let i = 0; i < months; i++)
        date = addCalendarMonths(date, 1); return date; };
    return { months, interest: numeric(interest), points, debts: rows.map(d => ({ id: d.id, month: d.paidMonth, date: d.paidMonth === null ? null : payoffDate(d.paidMonth) })) };
}
export function addCalendarMonths(iso: string, months: number): string {
    const [year, month, day] = iso.split("-").map(Number);
    const target = year * 12 + month - 1 + months, y = Math.floor(target / 12), m = target % 12;
    return `${y}-${String(m + 1).padStart(2, "0")}-${String(Math.min(day, new Date(Date.UTC(y, m + 1, 0)).getUTCDate())).padStart(2, "0")}`;
}
export function forecast(input: Forecast, asOf: string, days: number, recurring: boolean) {
    recurring = recurring && input.usesRecurring;
    if (!Number.isInteger(days) || days < 1 || days > 90)
        throw new Error("Choose 1 to 90 days.");
    const start = Date.parse(asOf + "T00:00:00Z"), end = new Date(start + days * 86400000).toISOString().slice(0, 10);
    if (end > input.throughDate)
        throw new Error("This horizon exceeds the snapshot's forecast coverage. Refresh on your local network.");
    let balance = input.startBalance;
    if (recurring)
        for (const flow of input.schedule)
            if (flow.date === asOf)
                balance = addMoney([balance, subtract(flow.moneyIn, flow.moneyOut)]);
    const points = [{ date: asOf, balance }];
    for (let i = 1; i <= days; i++) {
        const date = new Date(start + i * 86400000).toISOString().slice(0, 10);
        balance = addMoney([balance, recurring ? input.everydayDailyNet : input.trendDailyNet]);
        if (recurring)
            for (const flow of input.schedule)
                if (flow.date === date)
                    balance = addMoney([balance, subtract(flow.moneyIn, flow.moneyOut)]);
        points.push({ date, balance });
    }
    return points;
}
