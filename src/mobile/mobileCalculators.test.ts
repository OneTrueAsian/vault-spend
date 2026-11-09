import { describe, expect, it } from "vitest";
import { debtPayoff, forecast, loanPayment } from "./mobileCalculators";
import { addMoney, money, aggregateBreakdown, averageMoney } from "./mobileViewModel";
describe("mobile financial calculations", () => {
    it("adds decimals before rounding, including amounts above floating point cent precision", () => {
        expect(money(addMoney(["999999999999999.99", "0.01"]))).toBe("$1,000,000,000,000,000.00");
        expect(money("-1.005")).toBe("-$1.01");
        expect(addMoney(["0.1", "0.2"])).toBe("0.3");
        expect(money(averageMoney(["999999999999999.98","999999999999999.99"]))).toBe("$999,999,999,999,999.99");
    });
    it("aggregates the selected range before ranking merchants", () => {
        const rows = [{ month: "2026-01", id: null, label: "A", income: "0", spending: "5" }, { month: "2026-02", id: null, label: "A", income: "0", spending: "6" }, { month: "2026-03", id: null, label: "B", income: "0", spending: "999" }];
        expect(aggregateBreakdown(rows, ["2026-01", "2026-02"])).toEqual([{ label: "A", income: "0", spending: "11" }]);
    });
    it("handles a zero-interest loan and rejects invalid scenarios", () => {
        expect(loanPayment(1200, 0, 1)).toEqual({ monthly: 100, interest: 0, total: 1200 });
        expect(() => loanPayment(1200, NaN, 1)).toThrow();
        expect(() => loanPayment(-1, 2, 1)).toThrow();
        expect(() => loanPayment(100, 2, 0)).toThrow();
        expect(loanPayment(10000, 6, 5).monthly).toBeCloseTo(193.328015, 5);
        expect(loanPayment(1200, 1e-12, 1).monthly).toBeCloseTo(100, 8);
    });
    it("matches the desktop interest ordering and avalanche priority on APR-bearing debts",()=>{
        const plan=debtPayoff([{id:"card",owed:1200,apr:24,minimum:110}],0,"snowball","2026-08-20");
        expect(plan.months).toBe(13);
        // Independently evaluated decimal recurrence: interest first, then min(owed,110).
        expect(plan.interest).toBeCloseTo(167.4914890486762339,9);
        const avalanche=debtPayoff([{id:"high",owed:1000,apr:25,minimum:10},{id:"low",owed:1000,apr:5,minimum:10}],200,"avalanche","2026-08-20");
        expect(avalanche.debts.find(d=>d.id==="high")!.month!).toBeLessThan(avalanche.debts.find(d=>d.id==="low")!.month!);
    });
    it("matches desktop zero-interest payoff, incomplete cap and freed minimum timing", () => {
        expect(debtPayoff([{ id: "a", owed: 1200, apr: 0, minimum: 100 }], 0, "snowball", "2026-01-31").months).toBe(12);
        expect(debtPayoff([{ id: "a", owed: 1200, apr: 0, minimum: 0 }], 0, "snowball", "2026-01-31").months).toBeNull();
        const result = debtPayoff([{ id: "a", owed: 100, apr: 0, minimum: 100 }, { id: "b", owed: 300, apr: 0, minimum: 100 }], 0, "snowball", "2026-01-31");
        expect(result.months).toBe(2);
        expect(result.interest).toBe(0);
        expect(result.debts.find(d => d.id === "b")?.date).toBe("2026-03-28");
        expect(() => debtPayoff([{ id: "a", owed: 10, apr: 0, minimum: -1 }], 0, "snowball", "2026-01-01")).toThrow();
    });
    it("keeps day zero, includes dated events, and refuses uncovered horizons", () => {
        const input = { throughDate: "2026-01-03", startBalance: "1000", trendDailyNet: "-10", everydayDailyNet: "-10", usesRecurring: true, schedule: [{ date: "2026-01-03", moneyIn: "0", moneyOut: "100" }] };
        expect(forecast(input, "2026-01-01", 2, true).map(p => p.balance)).toEqual(["1000", "990", "880"]);
        expect(() => forecast(input, "2026-01-01", 3, true)).toThrow(/coverage/);
        expect(forecast({ ...input, schedule: [{ date: "2026-01-01", moneyIn: "0", moneyOut: "100" }] }, "2026-01-01", 2, true)[0].balance).toBe("900");
        expect(forecast({ ...input, schedule: [{ date: "2026-01-01", moneyIn: "0", moneyOut: "100" }] }, "2026-01-01", 2, false)[0].balance).toBe("1000");
        expect(forecast({...input,usesRecurring:false,everydayDailyNet:"0",schedule:[]},"2026-01-01",2,true).map(p=>p.balance)).toEqual(["1000","990","980"]);
    });
});
