import "./MobileControls.css";
import { useEffect, useState, type ReactNode } from "react";
import { Eye, EyeOff, Wallet, House, ChartNoAxesCombined, Calculator, ListChecks, Settings } from "lucide-react";
import type { MobileSnapshotV1 } from "./mobileSnapshotTypes";
import { MenuSelect } from "./MenuSelect";
import { readThemeStyle } from "./themeBootstrap";
import { Amount, Card, Line, Progress } from "./MobileShared";
import { addMoney, currentBudget, monthLabel } from "./mobileViewModel";
import { MobileReports } from "./MobileReports";
import { MobileTools } from "./MobileTools";
import "./App.css";
import "./themes/futuristic.css";
import "./themes/retro.css";
import "./MobileViewer.css";
type Tab = "Overview" | "Accounts" | "Budget" | "Reports" | "Calculators";
const tabs = [{ label: "Overview", icon: House }, { label: "Accounts", icon: Wallet }, { label: "Budget", icon: ListChecks }, { label: "Reports", icon: ChartNoAxesCombined }, { label: "Calculators", icon: Calculator }] as const;
function stored(key: string): string | null { try {
    return localStorage.getItem(key);
}
catch {
    return null;
} }
function save(key: string, value: string) { try {
    localStorage.setItem(key, value);
}
catch { /* Appearance remains usable when storage is denied. */ } }
/** Receives only authorized, ingress-validated snapshots from the repository (Task 4).
 * All scenario state is discarded on profile, epoch, or snapshot replacement. No IPC or fetch. */
export function MobileViewer({ snapshots, onRefresh, refreshing = false, refreshMessage = null,selectedProfile,onProfileChange,availableProfiles,connectionControls }: {
    snapshots: readonly MobileSnapshotV1[];
    connectionControls?: ReactNode;
    onRefresh?: (snapshot: MobileSnapshotV1) => void;
    refreshing?: boolean;
    refreshMessage?: string | null;
    selectedProfile?:string;
    onProfileChange?:(id:string)=>void;
    availableProfiles?:{value:string;label:string}[];
}) {
    const [selected, setSelected] = useState("");
    const snapshot = snapshots.find(s => `${s.installationId}/${s.profile.id}` === (selectedProfile??selected)) ?? (selectedProfile?undefined:snapshots[0]);
    const [hidden, setHidden] = useState(false), [appearance, setAppearance] = useState(false);
    const [palette, setPalette] = useState(() => readThemeStyle(stored("vault-mobile-palette")));
    const [mode, setMode] = useState(() => { const s = stored("vault-mobile-mode"); return s === "light" || s === "dark" ? s : "system"; });
    useEffect(() => { document.documentElement.dataset.palette = palette; if (mode === "system")
        document.documentElement.removeAttribute("data-theme");
    else
        document.documentElement.dataset.theme = mode; }, [palette, mode]);
    return <div className="mobile-viewer">
    <header className="mobile-header"><div className="mobile-brand"><span className="mobile-logo" aria-hidden="true">V</span><div><strong>Vault Spend</strong><small>Your money, with you.</small></div></div><div className="mobile-actions"><button aria-label={hidden ? "Show amounts" : "Hide amounts"} onClick={() => setHidden(!hidden)}>{hidden ? <EyeOff size={20}/> : <Eye size={20}/>}</button><button aria-label="Appearance" aria-expanded={appearance} onClick={() => setAppearance(!appearance)}><Settings size={20}/></button></div></header>
    {appearance && <section className="mobile-appearance" aria-label="Appearance"><MenuSelect ariaLabel="Theme" value={palette} onChange={v => { setPalette(readThemeStyle(v)); save("vault-mobile-palette", v); }} options={[{ value: "transparent", label: "Default" }, { value: "futuristic", label: "Futuristic" }, { value: "retro", label: "Retro" }]}/><MenuSelect ariaLabel="Color mode" value={mode} onChange={v => { setMode(v); save("vault-mobile-mode", v); }} options={[{ value: "system", label: "System" }, { value: "light", label: "Light" }, { value: "dark", label: "Dark" }]}/></section>}
    {connectionControls}
    {!snapshot&&!!availableProfiles?.length&&<div className="mobile-profile"><MenuSelect ariaLabel="Profile" value={selectedProfile??availableProfiles[0].value} onChange={id=>{setSelected(id);onProfileChange?.(id);}} options={availableProfiles}/><span className="mobile-badge">Read only</span></div>}
    {snapshot ? <><div className="mobile-profile"><MenuSelect ariaLabel="Profile" value={`${snapshot.installationId}/${snapshot.profile.id}`} onChange={id=>{setSelected(id);onProfileChange?.(id);}} options={availableProfiles??snapshots.map(s => ({ value: `${s.installationId}/${s.profile.id}`, label: s.profile.name }))}/><span className="mobile-badge">Read only</span></div><div className="mobile-sync"><span>Snapshot as of {snapshot.asOfDate}<small>Saved {snapshot.generatedAt.replace("T", " ").replace("Z", " UTC")}</small></span><button onClick={() => onRefresh?.(snapshot)} disabled={!onRefresh || refreshing}>{refreshing ? "Refreshing…" : "Refresh"}</button></div>{refreshMessage && <p role="status">{refreshMessage}</p>}<ProfilePages key={`${snapshot.installationId}/${snapshot.profile.id}/${snapshot.epoch}/${snapshot.sequence}`} snapshot={snapshot} hidden={hidden}/></> : <main className="mobile-empty"><h1>No saved snapshot</h1><p>Connect to your open Vault Spend desktop instance on your local network to receive a read-only snapshot.</p></main>}
  </div>;
}
function ProfilePages({ snapshot: s, hidden }: {
    snapshot: MobileSnapshotV1;
    hidden: boolean;
}) {
    const [tab, setTab] = useState<Tab>("Overview");
    const section = tab === "Overview" ? s.sections.overview : tab === "Accounts" ? s.sections.accounts : tab === "Budget" ? s.sections.budgets : tab === "Reports" ? s.sections.reports : s.sections.calculators;
    return <><main id="mobile-main"><h1>{tab === "Overview" ? "Your money at a glance" : tab === "Accounts" ? "Your accounts" : tab === "Budget" ? "Your budget" : tab === "Reports" ? "The bigger picture" : "Plan your next step"}</h1><p className="mobile-muted">Saved data. Refresh while your desktop instance is open.</p>{section.state !== "available" && <p className="mobile-notice" role="status">{section.state === "partial" ? "Partial snapshot: " : "Unavailable: "}{section.reason}</p>}{section.state !== "unavailable" && (tab === "Overview" ? <Overview snapshot={s} hidden={hidden} go={setTab}/> : tab === "Accounts" ? <Accounts snapshot={s} hidden={hidden}/> : tab === "Budget" ? <Budget snapshot={s} hidden={hidden}/> : tab === "Reports" ? <MobileReports snapshot={s} hidden={hidden} onBudget={() => setTab("Budget")}/> : <MobileTools snapshot={s} hidden={hidden}/>)}<p className="mobile-footer">This snapshot stays unchanged away from your desktop. Calculators use local, unsaved scenarios.</p></main><nav className="mobile-nav" aria-label="Mobile views">{tabs.map(({ label, icon: Icon }) => <button key={label} aria-current={tab === label ? "page" : undefined} onClick={() => setTab(label)}><Icon size={20}/><span>{label}</span></button>)}</nav></>;
}
function Overview({ snapshot: s, hidden, go }: {
    snapshot: MobileSnapshotV1;
    hidden: boolean;
    go: (t: Tab) => void;
}) {
    const budget = currentBudget(s), expense = budget?.lines.filter(l => l.group !== "income") ?? [];
    return <><section className="mobile-hero"><span className="mobile-eyebrow">WHAT YOU OWN, LESS WHAT YOU OWE</span><div className="mobile-total"><Amount value={s.overview.netWorth} hidden={hidden}/></div><Line label="Cash & savings" value={s.overview.cash} hidden={hidden}/><Line label="Debt contribution" value={s.overview.debtContribution} hidden={hidden}/><Line label="Investments" value={s.overview.investments} hidden={hidden}/><Line label="Property" value={s.overview.propertyValue} hidden={hidden}/><Line label="Other accounts" value={s.overview.otherAccounts} hidden={hidden}/></section>{budget && <Card title={`${monthLabel(budget.month)} budget`}><Line label="Remaining across expense categories" value={addMoney(expense.map(l => l.remaining))} hidden={hidden}/><Progress actual={addMoney(expense.map(l => l.actual))} planned={addMoney(expense.map(l => l.effectiveBudget))} hidden={hidden}/><button className="mobile-link" onClick={() => go("Budget")}>See full budget →</button></Card>}<div className="mobile-grid"><Card title="Income this month"><Amount value={budget?.actualIncome ?? null} hidden={hidden}/></Card><Card title="Spending this month"><Amount value={budget?.actualSpending ?? null} hidden={hidden}/></Card></div>{s.sections.accounts.state !== "unavailable" && <Card title="Your accounts"><AccountRows snapshot={s} hidden={hidden}/><button className="mobile-link" onClick={() => go("Accounts")}>See all accounts →</button></Card>}<Card title="Cash runway"><Line label="Average monthly spending" value={s.overview.averageMonthlySpend} hidden={hidden}/><p>{hidden ? "••••" : s.overview.runwayMonths === null ? "Runway unavailable" : `${Number(s.overview.runwayMonths).toFixed(1)} months at the saved spending pace`}</p></Card></>;
}
function AccountRows({ snapshot: s, hidden }: {
    snapshot: MobileSnapshotV1;
    hidden: boolean;
}) { return <div className="mobile-accounts">{s.accounts.length === 0 ? <p>No accounts in this snapshot.</p> : s.accounts.map(a => <div className="mobile-account" key={a.id}><Wallet size={20} aria-hidden="true"/><div><strong>{a.name}</strong><small>{a.accountType} · {a.balanceBasis === "holdings" ? "Saved holdings" : "Ledger balance"}</small>{a.checkpointDate && <small>Checkpoint {a.checkpointDate}</small>}</div><div><strong><Amount value={a.balance} hidden={hidden}/></strong>{a.owed !== null && <small>Owed <Amount value={a.owed} hidden={hidden}/></small>}</div></div>)}</div>; }
function Accounts({ snapshot: s, hidden }: {
    snapshot: MobileSnapshotV1;
    hidden: boolean;
}) { return <><Card title="All accounts"><AccountRows snapshot={s} hidden={hidden}/></Card><Card title="Investment totals">{s.sections.investments.state !== "available" && <p>{s.sections.investments.reason}</p>}{s.sections.investments.state !== "unavailable" && <><Line label="Saved portfolio value" value={s.investments.value} hidden={hidden}/><Line label="Cost basis" value={s.investments.costBasis} hidden={hidden}/><Line label="Unrealized gain / loss" value={s.investments.unrealizedGain} hidden={hidden}/><Line label="Day change" value={s.investments.dayChange} hidden={hidden}/><p className="mobile-muted">Quote coverage: {s.investments.coverage.state}. Prices {s.investments.coverage.quoteTimestamp ?? "timestamp unavailable"}. Previous close {s.investments.coverage.previousCloseDate ?? "unavailable"}.</p>{s.investments.accounts.map(a => <details key={a.accountId}><summary>{s.accounts.find(x => x.id === a.accountId)?.name ?? "Investment account"}</summary><Line label="Value" value={a.value} hidden={hidden}/><Line label="Unrealized gain / loss" value={a.unrealizedGain} hidden={hidden}/><Line label="Day change" value={a.dayChange} hidden={hidden}/><p>Coverage: {a.coverage.state}</p></details>)}</>}</Card></>; }
function Budget({ snapshot: s, hidden }: {
    snapshot: MobileSnapshotV1;
    hidden: boolean;
}) {
    const [month, setMonth] = useState(currentBudget(s)?.month ?? s.budgets[s.budgets.length - 1]?.month ?? "");
    const b = s.budgets.find(b => b.month === month);
    if (!b)
        return <p>No budget saved in this snapshot.</p>;
    return <><MenuSelect ariaLabel="Budget month" value={month} onChange={setMonth} options={s.budgets.map(b => ({ value: b.month, label: monthLabel(b.month) }))}/><Card title={monthLabel(month)}><p>{b.actualThrough ? `Actuals through ${b.actualThrough}` : "Plan only; no actuals yet"}{b.sourceMonth && b.sourceMonth !== month ? ` · Inherited from ${monthLabel(b.sourceMonth)}` : ""}</p><Line label="Recorded income" value={b.actualIncome} hidden={hidden}/><Line label="Recorded gross spending" value={b.actualSpending} hidden={hidden}/><Line label="Unbudgeted gross spending" value={b.unbudgetedSpending} hidden={hidden}/><p className="mobile-muted">Category actuals are net of refunds and may include transfers. Gross spending totals use report rules.</p></Card>{(["income", "fixed", "flexible", "nonmonthly"] as const).map(group => <Card key={group} title={group === "nonmonthly" ? "Nonmonthly" : group[0].toUpperCase() + group.slice(1)}>{b.lines.filter(l => l.group === group).sort((a, b) => a.order - b.order).map(l => <details className="mobile-budget-row" key={l.category}><summary><span>{l.category}</span><strong><Amount value={l.actual} hidden={hidden}/> / <Amount value={l.effectiveBudget} hidden={hidden}/></strong></summary>{group !== "income" && <Progress actual={l.actual} planned={l.effectiveBudget} hidden={hidden}/>}<Line label="Planned" value={l.planned} hidden={hidden}/><Line label="Rollover" value={l.rollover} hidden={hidden}/><Line label={group === "income" ? "Income above / below plan" : "Remaining"} value={l.remaining} hidden={hidden}/><p>{hidden ? "Amounts hidden" : `Status: ${l.alert}`} · Cap {l.capEnabled && b.capFeatureEnabled ? "on" : "off"} · Rollover {l.rolloverEnabled && b.rolloverFeatureEnabled ? "on" : "off"}</p><h3>Saved category trend</h3>{s.history.budgetCategoryNet.filter(r => r.category === l.category).map(r => <Line key={r.month} label={monthLabel(r.month)} value={group === "income" ? r.signedAmount : addMoney(["0", r.signedAmount.startsWith("-") ? r.signedAmount.slice(1) : `-${r.signedAmount}`])} hidden={hidden}/>)}</details>)}</Card>)}</>;
}
