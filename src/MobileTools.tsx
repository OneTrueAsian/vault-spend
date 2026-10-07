import { useState } from "react";
import type { Accumulation, MobileSnapshotV1 } from "./mobileSnapshotTypes";
import { MenuSelect } from "./MenuSelect";
import { Card, Line, MobileMonthField } from "./MobileShared";
import { projectGoal } from "./projections";
import { combineProjections, monthsUntil, summarizeAccumulation, validatePlanForm, type AccountSummary } from "./accumulation";
import { goalPlan } from "./goalPlan";
import { addCalendarMonths, debtPayoff, forecast, loanPayment, scenarioNumber } from "./mobileCalculators";
import { units } from "./mobileViewModel";
function Field({ label, value, onChange, kind = "text" }: {
    label: string;
    value: string;
    onChange: (v: string) => void;
    kind?: string;
}) { return <label className="mobile-field"><span>{label}</span><input type={kind} inputMode={kind === "text" ? "decimal" : undefined} value={value} onChange={e => onChange(e.target.value)}/></label>; }
function Failure({ error }: {
    error: unknown;
}) { return <p className="mobile-notice" role="status">{error instanceof Error ? error.message : "Scenario unavailable"}</p>; }
function summary(s: MobileSnapshotV1, a: Accumulation, todaysDollars: boolean): AccountSummary {
    if (a.plan.withdrawMonth !== null && monthsUntil(s.asOfDate, a.plan.withdrawMonth) > 1200)
        throw new Error("Saved withdrawal horizon exceeds the mobile 100-year limit.");
    return summarizeAccumulation({ worthNow: Number(s.accounts.find(x => x.id === a.accountId)?.balance ?? 0), months: a.months.map(m => ({ month: m.month, moneyIn: Number(m.moneyIn), moneyOut: Number(m.moneyOut) })), totalIn: Number(a.totalIn), totalOut: Number(a.totalOut), plan: { monthlyContribution: a.plan.monthlyContribution === null ? null : Number(a.plan.monthlyContribution), annualReturnPct: Number(a.plan.annualReturnPct), withdrawMonth: a.plan.withdrawMonth, withdrawYears: a.plan.withdrawYears }, today: s.asOfDate, inflationPct: Number(s.calculators.inflationPct), todaysDollars });
}
export function MobileTools({ snapshot: s, hidden }: {
    snapshot: MobileSnapshotV1;
    hidden: boolean;
}) {
    const [tool, setTool] = useState("savings");
    return <><p>What-if scenarios stay in this view and are discarded when you switch profiles or receive a new snapshot. They never change your desktop data.</p><MenuSelect ariaLabel="Calculator" value={tool} onChange={setTool} options={[{ value: "savings", label: "Savings & investment growth" }, { value: "accumulation", label: "Account accumulation & withdrawals" }, { value: "combined", label: "Combined accumulation" }, { value: "debt", label: "Debt payoff" }, { value: "forecast", label: "Cash flow forecast" }, { value: "goals", label: "Goals & savings plans" }, { value: "loan", label: "Loan payment" }]}/>{tool === "savings" ? <Savings hidden={hidden}/> : tool === "loan" ? <Loan hidden={hidden}/> : tool === "debt" ? <Debt snapshot={s} hidden={hidden}/> : tool === "forecast" ? <CashForecast snapshot={s} hidden={hidden}/> : tool === "goals" ? <Goals snapshot={s} hidden={hidden}/> : tool === "accumulation" ? <>{s.calculators.accumulation.map(a => <AccountPlan key={a.accountId} snapshot={s} data={a} hidden={hidden}/>)}{s.calculators.accumulation.length === 0 && <p>No accumulation accounts saved.</p>}</> : <Combined snapshot={s} hidden={hidden}/>}<Card title="Saved recurring totals"><Line label="Monthly income" value={s.calculators.recurring.monthlyIncome} hidden={hidden}/><Line label="Monthly expense" value={s.calculators.recurring.monthlyExpense} hidden={hidden}/><Line label="Annual income" value={s.calculators.recurring.annualIncome} hidden={hidden}/><Line label="Annual expense" value={s.calculators.recurring.annualExpense} hidden={hidden}/><p>Saved recurring totals may include canceled items. Forecasts use the active dated schedule.</p></Card></>;
}
function Savings({ hidden }: {
    hidden: boolean;
}) {
    const [start, setStart] = useState("1000"), [monthly, setMonthly] = useState("100"), [rate, setRate] = useState("0"), [years, setYears] = useState("10");
    let points: ReturnType<typeof projectGoal> = [], error: unknown = null;
    try {
        const y = scenarioNumber(years, 50);
        if (y < 1 || !Number.isInteger(y))
            throw new Error("Choose 1 to 50 whole years.");
        points = projectGoal(scenarioNumber(start), scenarioNumber(monthly), scenarioNumber(rate, 100), y);
    }
    catch (e) {
        error = e;
    }
    return <Card title="Savings & investment growth">{!hidden && <div className="mobile-form"><Field label="Starting balance" value={start} onChange={setStart}/><Field label="Monthly contribution" value={monthly} onChange={setMonthly}/><Field label="Annual return (%)" value={rate} onChange={setRate}/><Field label="Years" value={years} onChange={setYears}/></div>}{error ? <Failure error={error}/> : <><Line label="Projected balance" value={points[points.length - 1]?.balance ?? null} hidden={hidden}/><details><summary>Yearly projection</summary>{points.map(p => <Line key={p.year} label={`Year ${p.year}`} value={p.balance} hidden={hidden}/>)}</details></>}<p>Monthly compounding with contributions at month end. Returns are assumptions, before fees and taxes.</p></Card>;
}
function Loan({ hidden }: {
    hidden: boolean;
}) {
    const [principal, setPrincipal] = useState("1200"), [rate, setRate] = useState("0"), [years, setYears] = useState("1");
    let result: ReturnType<typeof loanPayment> | null = null, error: unknown = null;
    try {
        result = loanPayment(scenarioNumber(principal), scenarioNumber(rate, 100), scenarioNumber(years, 50));
    }
    catch (e) {
        error = e;
    }
    return <Card title="Loan payment">{!hidden && <div className="mobile-form"><Field label="Principal" value={principal} onChange={setPrincipal}/><Field label="APR (%)" value={rate} onChange={setRate}/><Field label="Term (whole years)" value={years} onChange={setYears}/></div>}{error ? <Failure error={error}/> : result && <><Line label="Monthly payment" value={result.monthly} hidden={hidden}/><Line label="Total interest" value={result.interest} hidden={hidden}/><Line label="Total paid" value={result.total} hidden={hidden}/></>}<p>Fixed-rate monthly amortization. Fees, taxes and insurance are excluded. Display rounds to cents; actual lender rounding can vary.</p></Card>;
}
function Debt({ snapshot: s, hidden }: {
    snapshot: MobileSnapshotV1;
    hidden: boolean;
}) {
    const [strategy, setStrategy] = useState("snowball"), [extra, setExtra] = useState("0");
    const [minimums, setMinimums] = useState<Record<string, string>>({}), [included, setIncluded] = useState<Record<string, boolean>>({}), [rates, setRates] = useState<Record<string, string>>({});
    let result: ReturnType<typeof debtPayoff> | null = null, error: unknown = null;
    try {
        result = debtPayoff(s.calculators.debts.filter(d => included[d.accountId] ?? !d.excluded).map(d => ({ id: d.accountId, owed: Number(d.owed), apr: scenarioNumber(rates[d.accountId] ?? d.annualRatePct ?? "0", 100), minimum: scenarioNumber(minimums[d.accountId] ?? "0") })), scenarioNumber(extra), strategy as "snowball" | "avalanche", s.asOfDate);
    }
    catch (e) {
        error = e;
    }
    return <Card title="Debt payoff"><MenuSelect ariaLabel="Payoff strategy" value={strategy} onChange={setStrategy} options={[{ value: "snowball", label: "Snowball (smallest balance first)" }, { value: "avalanche", label: "Avalanche (highest APR first)" }]}/>{!hidden && <><Field label="Extra monthly payment" value={extra} onChange={setExtra}/>{s.calculators.debts.map(d => <fieldset key={d.accountId}><legend>{s.accounts.find(a => a.id === d.accountId)?.name ?? "Debt"}</legend><label className="mobile-check"><input type="checkbox" checked={included[d.accountId] ?? !d.excluded} onChange={e => setIncluded({ ...included, [d.accountId]: e.target.checked })}/> Include in scenario</label><Line label="Saved balance owed" value={d.owed} hidden={false}/><Field label="Minimum monthly payment" value={minimums[d.accountId] ?? "0"} onChange={v => setMinimums({ ...minimums, [d.accountId]: v })}/><Field label="APR (%)" value={rates[d.accountId] ?? d.annualRatePct ?? "0"} onChange={v => setRates({ ...rates, [d.accountId]: v })}/>{d.annualRatePct === null && <p>Saved APR is unknown; this scenario assumes 0% until you enter an APR.</p>}</fieldset>)}</>}{error ? <Failure error={error}/> : result && <><p>{hidden ? "••••" : result.months === null ? "Not paid off within the 600-month limit" : `Paid off in ${result.months} months`}</p><Line label="Interest through simulation horizon" value={result.interest} hidden={hidden}/>{result.debts.map(d => <p key={d.id}>{s.accounts.find(a => a.id === d.id)?.name}: {hidden ? "••••" : d.date ?? "Not paid off"}</p>)}</>}<p>Interest is added before minimum payments and ordered extras. Freed minimum payments apply the following month. Minimums are unsaved inputs; none are inferred.</p></Card>;
}
function CashForecast({ snapshot: s, hidden }: {
    snapshot: MobileSnapshotV1;
    hidden: boolean;
}) {
    const [days, setDays] = useState("30"), [mode, setMode] = useState(s.calculators.forecast.usesRecurring ? "recurring" : "trend");
    let points: ReturnType<typeof forecast> = [], error: unknown = null;
    try {
        points = forecast(s.calculators.forecast, s.asOfDate, Number(days), mode === "recurring");
    }
    catch (e) {
        error = e;
    }
    const lowest = points.reduce((a, b) => units(a.balance) < units(b.balance) ? a : b, points[0]);
    return <Card title="Cash flow forecast"><MenuSelect ariaLabel="Forecast horizon" value={days} onChange={setDays} options={[30, 60, 90].map(n => ({ value: String(n), label: `${n} days` }))}/><MenuSelect ariaLabel="Forecast method" value={mode} onChange={setMode} options={[{ value: "recurring", label: "Bill-aware (dated schedule)" }, { value: "trend", label: "Recent cash trend" }]}/><p>Starts {s.asOfDate}; schedule covered through {s.calculators.forecast.throughDate}.</p>{mode === "recurring" && !s.calculators.forecast.usesRecurring && <p>No recurring schedule saved; using the cash trend.</p>}{error ? <Failure error={error}/> : <><Line label="Ending balance" value={points[points.length - 1]?.balance ?? null} hidden={hidden}/><Line label={hidden ? "Lowest balance" : `Lowest balance · ${lowest?.date}`} value={lowest?.balance ?? null} hidden={hidden}/><details><summary>Daily projection</summary>{points.map(p => <Line key={p.date} label={p.date} value={p.balance} hidden={hidden}/>)}</details></>}<p>Projection from saved assumptions; it is not a current account balance.</p></Card>;
}
function AccountPlan({ snapshot: s, data: a, hidden }: {
    snapshot: MobileSnapshotV1;
    data: Accumulation;
    hidden: boolean;
}) {
    const [monthly, setMonthly] = useState(a.plan.monthlyContribution ?? ""), [rate, setRate] = useState(a.plan.annualReturnPct), [date, setDate] = useState(a.plan.withdrawMonth ?? ""), [years, setYears] = useState(a.plan.withdrawYears === null ? "" : String(a.plan.withdrawYears)), [inflation, setInflation] = useState(s.calculators.inflationPct), [real, setReal] = useState(false);
    const error = validatePlanForm({ monthly, returnPct: rate, withdrawMonth: date, withdrawYears: years, inflation }, s.asOfDate, a.plan.withdrawMonth);
    let result: AccountSummary | null = null, problem: unknown = error ? new Error(error) : null;
    try {
        if (date && !/^\d{4}-(0[1-9]|1[0-2])$/.test(date))
            throw new Error("Choose a valid withdrawal month.");
        if (monthly !== "")
            scenarioNumber(monthly);
        if (date && Number(date.slice(0, 4)) - Number(s.asOfDate.slice(0, 4)) > 100)
            throw new Error("Choose a withdrawal month within 100 years of the snapshot.");
        if (!problem)
            result = summary({ ...s, calculators: { ...s.calculators, inflationPct: inflation } }, { ...a, plan: { monthlyContribution: monthly === "" ? null : monthly, annualReturnPct: rate, withdrawMonth: date || null, withdrawYears: years === "" ? null : Number(years) } }, real);
    }
    catch (e) {
        problem = e;
    }
    return <Card title={s.accounts.find(x => x.id === a.accountId)?.name ?? "Accumulation account"}>{!hidden && <><Field label="Monthly contribution (blank uses recent average)" value={monthly} onChange={setMonthly}/><Field label="Annual return (%)" value={rate} onChange={setRate}/><MobileMonthField label="Withdraw month" value={date} onChange={setDate} anchorYear={Number(s.asOfDate.slice(0,4))}/><Field label="Withdrawal years (blank means lump sum)" value={years} onChange={setYears}/><Field label="Inflation (%)" value={inflation} onChange={setInflation}/></>}<label className="mobile-check"><input type="checkbox" checked={real} onChange={e => setReal(e.target.checked)}/> Show projections in today’s dollars</label>{problem ? <Failure error={problem}/> : result && <><Line label="Saved account value" value={result.worthNow} hidden={hidden}/><Line label="Total contributions" value={a.totalIn} hidden={hidden}/><Line label="Total withdrawals" value={a.totalOut} hidden={hidden}/><Line label="Net invested" value={result.netInvested} hidden={hidden}/><Line label="Growth to date" value={result.growth} hidden={hidden}/><Line label={`Monthly amount (${result.monthlySource})`} value={result.monthly} hidden={hidden}/>{result.status !== "ok" ? <p>{result.status === "passed" ? "The saved withdrawal month has passed." : "Choose a withdrawal month for a projection."}</p> : <><Line label="Projected balance at withdrawal" value={result.projectedFinal} hidden={hidden}/><details><summary>Withdrawal schedule</summary>{result.withdrawals.map(w => <Line key={w.year} label={addCalendarMonths(s.asOfDate, w.month).slice(0, 7)} value={w.amount} hidden={hidden}/>)}</details></>}<details><summary>Saved contributions & value history</summary>{a.months.map(m => <div key={m.month}><Line label={`${m.month} · Money in`} value={m.moneyIn} hidden={hidden}/><Line label="Money out" value={m.moneyOut} hidden={hidden}/></div>)}{a.valueHistory.map(v => <Line key={v.date} label={v.date} value={v.value} hidden={hidden}/>)}</details></>}<p>Snapshot date {s.asOfDate}. Recent average uses six complete months, including gaps. Assumed returns exclude fees and taxes.</p></Card>;
}
function Combined({ snapshot: s, hidden }: {
    snapshot: MobileSnapshotV1;
    hidden: boolean;
}) {
    const [real, setReal] = useState(false);
    const summaries = s.calculators.accumulation.flatMap(a => { try {
        return [{ a, result: summary(s, a, false) }];
    }
    catch {
        return [];
    } });
    const projections = summaries.flatMap(x => x.result.projection ? [x.result.projection] : []);
    const points = combineProjections(projections);
    return <Card title="Combined accumulation"><p>Uses saved account plans. A total at each future date includes only balances still present on that date.</p>{summaries.length < s.calculators.accumulation.length && <p className="mobile-notice">Some saved plans exceed the mobile 100-year projection limit and are excluded.</p>}<label className="mobile-check"><input type="checkbox" checked={real} onChange={e => setReal(e.target.checked)}/> Today’s dollars</label>{summaries.filter(x => x.result.status !== "ok").map(x => <p key={x.a.accountId}>{s.accounts.find(a => a.id === x.a.accountId)?.name}: {x.result.status === "passed" ? "saved withdrawal month has passed" : "no withdrawal month saved"}; excluded from combined projection.</p>)}{points.map(p => <Line key={p.month} label={addCalendarMonths(s.asOfDate, p.month).slice(0, 7)} value={real ? p.balance / Math.pow(1 + Number(s.calculators.inflationPct) / 100, p.month / 12) : p.balance} hidden={hidden}/>)}{projections.length === 0 && <p>No saved plans with a usable withdrawal date.</p>}</Card>;
}
function Goals({ snapshot: s, hidden }: {
    snapshot: MobileSnapshotV1;
    hidden: boolean;
}) { return <>{s.calculators.goals.length === 0 && <p>No goals saved in this snapshot.</p>}{s.calculators.goals.map(g => { const result = goalPlan({ saved_amount: g.saved, target_amount: g.target, target_date: g.targetDate, monthly_pace: g.monthlyPace }, new Date(s.asOfDate + "T00:00:00")); return <Card key={g.id} title={g.name}><p>{result.status.replace(/_/g, " ")}{g.targetDate && g.targetDate < s.asOfDate ? " · Saved deadline has passed" : ""}</p><Line label="Target" value={g.target} hidden={hidden}/><Line label="Saved" value={g.saved} hidden={hidden}/><Line label="Remaining" value={result.remaining} hidden={hidden}/><Line label="Observed monthly pace" value={g.monthlyPace} hidden={hidden}/><Line label="Scheduled savings contribution" value={g.monthlyContribution} hidden={hidden}/><Line label="Monthly saving needed for deadline" value={result.needsPerMonth} hidden={hidden}/><p>{hidden ? "••••" : `Projected finish: ${result.projectedFinish ?? "Unavailable"}`} · Target date {g.targetDate ?? "None"}</p>{g.tracksAccount && <p>Tracks {s.accounts.find(a => a.id === g.linkedAccountId)?.name ?? "a saved account"}</p>}<p>Calculated from snapshot date {s.asOfDate} and observed pace, not the phone’s current date.</p></Card>; })}</>; }
