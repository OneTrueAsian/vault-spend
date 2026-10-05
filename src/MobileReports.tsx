import { useState } from "react";
import type { ComparisonResult, MobileSnapshotV1, MonthTotals } from "./mobileSnapshotTypes";
import { MenuSelect } from "./MenuSelect";
import { Amount, Card, Line, Percent } from "./MobileShared";
import { addMoney, aggregateBreakdown, monthLabel, selectedMonths, subtract, averageMoney, units, money as moneyLabel } from "./mobileViewModel";
import { buildSankeyData, layoutSankey, sankeyRibbonPath } from "./sankey";
import { buildHeatmapWeeks, heatmapBucket, heatmapScaleMax } from "./heatmap";
import { monthEndDate, presetRange, type RangePreset } from "./reportRange";
import { forecast } from "./mobileCalculators";
function MonthlyChart({ months, hidden }: {
    months: MonthTotals[];
    hidden: boolean;
}) {
    const [chosen, setChosen] = useState("");
    const selected = months.find(m => m.month === chosen);
    const max = Math.max(1, ...months.flatMap(m => [Number(m.income), Number(m.spending)]));
    return <><div className="mobile-chart" style={{ gridTemplateColumns: `repeat(${Math.max(1, months.length)},minmax(0,1fr))` }} aria-label="Income and spending by month">{months.map(m => <button key={m.month} type="button" aria-label={`${monthLabel(m.month)}: income ${hidden ? "••••" : moneyLabel(m.income)}, spending ${hidden ? "••••" : moneyLabel(m.spending)}`} aria-pressed={chosen === m.month} onClick={() => setChosen(m.month)}><span className="mobile-bars" aria-hidden="true">{hidden ? <span>••</span> : <><i style={{ height: `${Number(m.income) / max * 100}%` }}/><i style={{ height: `${Number(m.spending) / max * 100}%` }}/></>}</span><span>{m.month.slice(5)}</span><small>{m.month.slice(2, 4)}</small></button>)}</div><p className="mobile-legend">● Income <span>● Spending</span></p><MenuSelect ariaLabel="View a month" value={chosen} placeholder="Tap a bar or choose a month" onChange={setChosen} options={months.map(m => ({ value: m.month, label: monthLabel(m.month) }))}/><div className="mobile-month-detail" role="status">{selected ? <><h3>{monthLabel(selected.month)}</h3><Line label="Income" value={selected.income} hidden={hidden}/><Line label="Spending" value={selected.spending} hidden={hidden}/><Line label="Net" value={subtract(selected.income, selected.spending)} hidden={hidden}/><p>Savings rate <Percent value={selected.savingsRatePct} hidden={hidden}/></p></> : <p>Tap either bar to see that month’s data.</p>}</div></>;
}

export function MobileReports({ snapshot: s, hidden, onBudget }: {
    snapshot: MobileSnapshotV1;
    hidden: boolean;
    onBudget?: () => void;
}) {
    const all = s.history.months;
    const last = all[all.length - 1]?.month ?? s.asOfDate.slice(0, 7);
    const [period, setPeriod] = useState("12"), [from, setFrom] = useState(all[Math.max(0, all.length - 12)]?.month ?? last), [to, setTo] = useState(last);
    const months = selectedMonths(s, from, to), keys = months.map(m => m.month), keySet = new Set(keys);
    const income = addMoney(months.map(m => m.income)), spending = addMoney(months.map(m => m.spending));
    const categories = new Map<string, string>();
    for (const r of s.history.categories)
        if (keySet.has(r.month))
            categories.set(r.category, addMoney([categories.get(r.category) ?? "0", r.spending]));
    const categoryRows = [...categories].sort((a, b) => units(a[1]) > units(b[1]) ? -1 : units(a[1]) < units(b[1]) ? 1 : a[0].localeCompare(b[0]));
    const chooseRange = (value: string) => { setPeriod(value); if (/^\d+$/.test(value)) {
        setFrom(all[Math.max(0, all.length - Number(value))]?.month ?? last);
        setTo(last);
    }
    else if (value !== "custom") {
        const range = presetRange(value as RangePreset, new Date(s.asOfDate + "T00:00:00"));
        setFrom(`${range.from.year}-${String(range.from.month).padStart(2, "0")}`);
        setTo(`${range.to.year}-${String(range.to.month).padStart(2, "0")}`);
    } };
    const end = to === s.asOfDate.slice(0, 7) ? s.asOfDate : monthEndDate({ year: Number(to.slice(0, 4)), month: Number(to.slice(5)) });
    const daily = s.history.daily.filter(d => d.date >= from + "-01" && d.date <= end);
    const weeks = months.length === 0 ? [] : buildHeatmapWeeks(daily.map(d => ({ date: d.date, amount: Number(d.spending) })), from + "-01", end), max = heatmapScaleMax(daily.map(d => Number(d.spending)));
    const [selectedDay, setSelectedDay] = useState("");
    const yearly = new Map<string, MonthTotals[]>();
    for (const m of months) {
        const k = m.month.slice(0, 4);
        yearly.set(k, [...(yearly.get(k) ?? []), m]);
    }
    const coverage = all.length > 0 && from >= all[0].month && to <= last;
    return <><MenuSelect ariaLabel="Report range" value={period} onChange={chooseRange} options={[{ value: "3", label: "3 months" }, { value: "6", label: "6 months" }, { value: "12", label: "12 months" }, { value: "year_to_date", label: "Year to date" }, { value: "last_month", label: "Last month" }, { value: "current_month", label: "Current month" }, { value: "custom", label: "Custom range" }]}/>{period === "custom" && <div className="mobile-grid"><MenuSelect ariaLabel="From month" value={from} onChange={v => { setFrom(v); if (v > to)
        setTo(v); }} options={all.map(m => ({ value: m.month, label: monthLabel(m.month) }))}/><MenuSelect ariaLabel="Through month" value={to} onChange={v => { setTo(v); if (v < from)
        setFrom(v); }} options={all.map(m => ({ value: m.month, label: monthLabel(m.month) }))}/></div>}<p>{monthLabel(from)} – {monthLabel(to)} · Actuals through {s.history.actualThrough}</p>{!coverage && <p className="mobile-notice">This range is not fully covered by the saved history. Totals below use only saved months.</p>}<Card title="Income & spending">{months.length === 0 ? <p>No months available in this range.</p> : <MonthlyChart key={`${from}/${to}`} months={months.length <= 12 ? months : months.slice(-12)} hidden={hidden}/>} {months.length > 12 && <p>Chart shows the last 12 selected months; range totals include all selected months.</p>}<Line label="Total income" value={income} hidden={hidden}/><Line label="Total spending" value={spending} hidden={hidden}/><Line label="Net" value={subtract(income, spending)} hidden={hidden}/><p>Share of income left <Percent value={Number(income) > 0 ? (Number(income) - Number(spending)) / Number(income) * 100 : null} hidden={hidden}/></p><Line label="Average monthly spending" value={averageMoney(months.map(m=>m.spending))} hidden={hidden}/></Card>
    <Card title="Where it went"><CategoryDonut categories={categoryRows} hidden={hidden}/><details><summary>Income to spending flow</summary><Sankey income={income} categories={categoryRows} hidden={hidden}/></details>{categoryRows.length === 0 && <p>No category spending in this range.</p>}{categoryRows.map(([name, value]) => <details key={name}><summary><span>{name}</span><Amount value={value} hidden={hidden}/></summary><h3>Category by month</h3>{months.map(m => <Line key={m.month} label={monthLabel(m.month)} value={addMoney(s.history.categories.filter(r => r.month === m.month && r.category === name).map(r => r.spending))} hidden={hidden}/>)}</details>)}</Card>
    <Card title="Daily spending heatmap"><MenuSelect ariaLabel="View a day" value={selectedDay} placeholder="Select a day" onChange={setSelectedDay} options={weeks.flat().filter(d=>d.inRange).map(d=>({value:d.date,label:d.date}))}/>{hidden ? <p>Amounts hidden</p> : <div className="mobile-heatmap" aria-label="Select a day to view spending">{weeks.map((week, i) => <div key={i}>{week.map(d => <button key={d.date} disabled={!d.inRange} data-bucket={heatmapBucket(d.amount, max)} aria-label={`${d.date}: ${moneyLabel(d.amount)}`} onClick={() => setSelectedDay(d.date)}>{d.date.slice(8)}</button>)}</div>)}</div>}{selectedDay >= from + "-01" && selectedDay <= end && <Line label={selectedDay} value={daily.find(d => d.date === selectedDay)?.spending ?? "0"} hidden={hidden}/>}</Card>
    <Card title="Year by year">{[...yearly].map(([year, rows]) => { const inc = addMoney(rows.map(r => r.income)), spend = addMoney(rows.map(r => r.spending)); return <details key={year}><summary>{year} · {rows.length} saved months</summary><Line label="Income" value={inc} hidden={hidden}/><Line label="Spending" value={spend} hidden={hidden}/><Line label="Net" value={subtract(inc, spend)} hidden={hidden}/><p>Savings rate <Percent value={Number(inc) > 0 ? Number(subtract(inc, spend)) / Number(inc) * 100 : null} hidden={hidden}/></p></details>; })}</Card>
    <Card title="Savings rate trend">{months.map(m => <div key={m.month} className="mobile-line"><span>{monthLabel(m.month)}</span><strong><Percent value={m.savingsRatePct} hidden={hidden}/></strong></div>)}</Card>
    {(["accounts", "members", "tags", "merchants"] as const).map(kind => <Card key={kind} title={kind === "merchants" ? "Top merchants" : `Spending by ${kind === "members" ? "member" : kind === "tags" ? "tag" : "account"}`}>{kind === "tags" && <p>Tag totals overlap when transactions have multiple tags and include tagged transfers.</p>}{aggregateBreakdown(s.history[kind], keys).slice(0, kind === "merchants" ? 8 : undefined).map(r => <div key={r.label}><Line label={r.label} value={r.spending} hidden={hidden}/>{kind !== "merchants" && kind !== "tags" && <Line label="Income" value={r.income} hidden={hidden}/>}</div>)}{s.history[kind].filter(r => keySet.has(r.month)).length === 0 && <p>No saved aggregates for this range.</p>}</Card>)}
    <Card title="Net worth history">{s.history.netWorth.filter(p => p.date >= from + "-01" && p.date <= end).map(p => <details key={p.date}><summary><span>{p.date}</span><Amount value={p.netWorth} hidden={hidden}/></summary><p>{p.valuationBasis === "current_saved_values" ? "Approximation using current saved property and investment values, not historical market quotes." : "Recorded values"}</p><Line label="Cash" value={p.cash} hidden={hidden}/><Line label="Debt contribution" value={p.debtContribution} hidden={hidden}/><Line label="Investments" value={p.investments} hidden={hidden}/><Line label="Property" value={p.propertyValue} hidden={hidden}/></details>)}{s.history.netWorth.length === 0 && <p>No recorded history.</p>}</Card>
    <Card title="Net worth by member"><p>Snapshot date {s.asOfDate}; independent of the report range.</p>{s.history.memberNetWorth.map((m, i) => <Line key={i} label={m.label} value={m.value} hidden={hidden}/>)}</Card>
    <Card title="Portfolio history">{s.history.portfolio.filter(p => p.date >= from + "-01" && p.date <= end).map(p => <Line key={p.date} label={p.date} value={p.value} hidden={hidden}/>)}{s.history.portfolio.length === 0 && <p>No recorded portfolio history.</p>}</Card>
    <Card title="Cash flow and debt summary"><Line label="Cash" value={s.overview.cash} hidden={hidden}/><Line label="Debt contribution" value={s.overview.debtContribution} hidden={hidden}/>{s.sections.calculators.state === "unavailable" ? <p>{s.sections.calculators.reason}</p> : <ForecastSummary snapshot={s} hidden={hidden}/>}<p>Detailed scenarios are in Calculators.</p>{onBudget && <button className="mobile-link" onClick={onBudget}>View this month’s budget →</button>}</Card>
    <Comparisons snapshot={s} hidden={hidden}/>
  </>;
}
function CategoryDonut({ categories, hidden }: {
    categories: [
        string,
        string
    ][];
    hidden: boolean;
}) {
    if (hidden)
        return <p>Spending shares hidden</p>;
    const total = categories.reduce((sum, [, amount]) => sum + Math.max(0, Number(amount)), 0);
    if (total <= 0)
        return null;
    let offset = 0;
    return <svg className="mobile-donut" viewBox="0 0 120 120" role="img" aria-label="Category share of spending"><title>Category spending shares</title>{categories.map(([label, amount], i) => { const share = Math.max(0, Number(amount)) / total * 100, start = offset; offset += share; return <circle key={label} cx="60" cy="60" r="42" fill="none" stroke={`var(--cat-${i % 6 + 1})`} strokeWidth="16" pathLength="100" strokeDasharray={`${share} ${100 - share}`} strokeDashoffset={-start} transform="rotate(-90 60 60)"><title>{label}: {moneyLabel(amount)}, {share.toFixed(1)}%</title></circle>; })}</svg>;
}
function Sankey({ income, categories, hidden }: {
    income: string;
    categories: [
        string,
        string
    ][];
    hidden: boolean;
}) {
    if (hidden)
        return <p>Flow amounts hidden</p>;
    const data = buildSankeyData(Number(income), categories.map(([label, amount]) => ({ label, amount: Number(amount) })));
    if (!data.nodes.length)
        return null;
    const layout = layoutSankey(data, 300, 220);
    return <><svg viewBox="0 0 300 220" className="mobile-sankey" role="img" aria-label="Income flowing to spending and money left over"><title>Income and spending flow</title>{layout.links.map((l, i) => { const source = layout.nodes.find(n => n.id === l.source)!, target = layout.nodes.find(n => n.id === l.target)!; return <path key={i} d={sankeyRibbonPath(source.x + layout.nodeWidth, l.sy0, l.sy1, target.x, l.ty0, l.ty1)} fill="var(--accent-soft)"/>; })}{layout.nodes.map(n => <rect key={n.id} x={n.x} y={n.y0} width={layout.nodeWidth} height={n.y1 - n.y0} fill="var(--accent)"><title>{n.label}: {moneyLabel(n.value)}</title></rect>)}</svg><details><summary>Flow details</summary>{data.nodes.map(n => <Line key={n.id} label={n.label} value={n.value} hidden={hidden}/>)}</details></>;
}
function ForecastSummary({ snapshot: s, hidden }: {
    snapshot: MobileSnapshotV1;
    hidden: boolean;
}) {
    try {
        const points = forecast(s.calculators.forecast, s.asOfDate, 30, s.calculators.forecast.usesRecurring);
        return <Line label="30-day forecast balance" value={points[points.length - 1].balance} hidden={hidden}/>;
    }
    catch {
        return <p>30-day forecast unavailable in this snapshot.</p>;
    }
}
function Result({ result: r, hidden }: {
    result: ComparisonResult;
    hidden: boolean;
}) {
    return <><p>Status: {r.status.replace(/_/g, " ")} · Completeness: {r.completeness}</p><Line label="Your saved value" value={r.localValue} hidden={hidden}/><Line label="Reference adjusted to saved dollar basis" value={r.reference?.adjustedValue ?? null} hidden={hidden}/><Line label="Difference" value={r.dollarDifference} hidden={hidden}/><p>Difference <Percent value={r.percentDifference} hidden={hidden}/></p>{!hidden && r.reasons.map((x, i) => <p key={i}>{x.code}: {x.detail} {x.options.join(", ")}</p>)}{r.reference && <details><summary>Reference and provenance</summary><Line label="Reference original value" value={r.reference.value} hidden={hidden}/><Line label="Uncertainty" value={r.reference.uncertainty} hidden={hidden}/><p>{r.reference.uncertaintyKind ?? "Uncertainty not supplied"} · {r.reference.statistic} · {r.reference.unit}</p><p>{r.reference.population} · {r.reference.geography} · {r.reference.mode} · {r.reference.universe}</p><p>Age {r.reference.ageMin}–{r.reference.ageMax ?? "and above"} · {r.reference.periodFrom}–{r.reference.periodTo}</p><p>Dollar basis: {r.reference.dollarBasis.kind}, {r.reference.dollarBasis.period}; adjusted {r.reference.adjustedBasisMonth}; CPI factor {hidden ? "••••" : r.reference.cpiFactor}</p><p>{r.reference.sourceId}: {r.reference.sourceLocator}</p><p className="mobile-source">{r.reference.sourceUrl}</p><p>{r.reference.reliability} · {hidden ? "Details hidden" : r.reference.annotation}</p></details>}</>;
}
function Comparisons({ snapshot: s, hidden }: {
    snapshot: MobileSnapshotV1;
    hidden: boolean;
}) { return <Card title="Comparisons"><p>Saved comparison results · Package {s.comparisons.packageVersion ?? "unavailable"}</p>{s.sections.comparisons.state !== "available" && <p>{s.sections.comparisons.reason}</p>}{s.comparisons.problem && <p>{s.comparisons.problem}</p>}{!s.comparisons.configured && <p>Set up Comparisons on your desktop.</p>}{s.sections.comparisons.state !== "unavailable" && s.comparisons.cards.filter(c => c.visible).map((c, i) => <details key={i}><summary>{c.result.metric[0].toUpperCase() + c.result.metric.slice(1)} {c.stale ? "· Saved result is stale" : ""}</summary><Result result={c.result} hidden={hidden}/><p>{c.periodFrom}–{c.periodTo} · {c.periodKind} · {c.metricUnit} · {c.origin} · Measured {c.measuredOn ?? s.asOfDate}</p><p>{hidden ? "Details hidden" : c.explanation}</p><Line label="Saved measured value" value={c.trackedValue} hidden={hidden}/><Line label="Unallocated" value={c.unallocated} hidden={hidden}/>{c.contributors.map((x, j) => <div key={j}><Line label={`${x.label} · Gross`} value={x.gross} hidden={hidden}/><Line label="Counted" value={x.counted} hidden={hidden}/><p>Share <Percent value={x.shareBasisPoints / 100} hidden={hidden}/></p></div>)}{c.classTotals.map((x, j) => <Line key={j} label={x.label} value={x.value} hidden={hidden}/>)}{!hidden && [...c.notes, ...c.excluded].map((x, j) => <p key={j}>{x.code}: {x.detail} {x.options.join(", ")}</p>)}{c.secondary.map((x, j) => <details key={j}><summary>{x.label}</summary><Result result={x.result} hidden={hidden}/></details>)}</details>)}</Card>; }
