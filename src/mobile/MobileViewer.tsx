import "./MobileControls.css";
import { useEffect, useState, type ReactNode } from "react";
import { ArrowDownLeft, ArrowRight, ArrowUpRight, Calculator, ChartNoAxesCombined, Clock3, CloudDownload, Eye, EyeOff, House, ListChecks, Palette, Settings, Wallet } from "lucide-react";
import type { MobileSnapshotV1 } from "./mobileSnapshotTypes";
import { MenuSelect } from "../shared/ui/MenuSelect";
import { formatDisplayDate, formatEpochDateTime } from "../shared/lib/format";
import { readThemeStyle } from "../shared/lib/themeBootstrap";
import { Amount, Card, Line, Progress } from "./MobileShared";
import { budgetSpendingPlan, currentBudget, monthLabel, subtract, units } from "./mobileViewModel";
import { MobileReports } from "./MobileReports";
import { MobileTools } from "./MobileTools";
import { defaultOverviewAccountIds, MobileAccountPreview, MobileAccounts, OVERVIEW_ACCOUNT_LIMIT } from "./MobileAccounts";
import { MobileBudget } from "./MobileBudget";
import "../shared/ui/App.css";
import "../themes/futuristic.css";
import "../themes/retro.css";
import "./MobileViewer.css";
type Tab = "Overview" | "Accounts" | "Budget" | "Reports" | "Calculators" | "Settings";
const tabs = [{ label: "Overview", icon: House }, { label: "Accounts", icon: Wallet }, { label: "Budget", icon: ListChecks }, { label: "Reports", icon: ChartNoAxesCombined }, { label: "Calculators", icon: Calculator }, { label: "Settings", icon: Settings }] as const;
function stored(key: string): string | null { try {
    return localStorage.getItem(key);
}
catch {
    return null;
} }
function save(key: string, value: string) { try {
    localStorage.setItem(key, value);
}
catch { /* Preferences remain usable in this session when storage is denied. */ } }
function readOverviewAccounts(key: string, snapshot: MobileSnapshotV1): string[] {
    const value = stored(key);
    if (value !== null) {
        try {
            const ids: unknown = JSON.parse(value);
            if (Array.isArray(ids) && ids.every((id): id is string => typeof id === "string"))
                return [...new Set(ids)].slice(0, OVERVIEW_ACCOUNT_LIMIT);
        } catch { /* Fall back to the default preview. */ }
    }
    return defaultOverviewAccountIds(snapshot.accounts);
}
/** Receives only authorized, ingress-validated snapshots from the repository (Task 4).
 * All scenario state is discarded on profile, epoch, or snapshot replacement. No IPC or fetch. */
export function MobileViewer({ snapshots, onRefresh, refreshing = false, refreshMessage = null,selectedProfile,onProfileChange,availableProfiles,connectionControls,statusSummary,initialSettingsOpen = false }: {
    snapshots: readonly MobileSnapshotV1[];
    connectionControls?: ReactNode;
    statusSummary?: string;
    initialSettingsOpen?: boolean;
    onRefresh?: (snapshot: MobileSnapshotV1) => void;
    refreshing?: boolean;
    refreshMessage?: string | null;
    selectedProfile?:string;
    onProfileChange?:(id:string)=>void;
    availableProfiles?:{value:string;label:string}[];
}) {
    const [selected, setSelected] = useState("");
    const snapshot = snapshots.find(s => `${s.installationId}/${s.profile.id}` === (selectedProfile??selected)) ?? (selectedProfile?undefined:snapshots[0]);
    const [hidden, setHidden] = useState(false);
    const [tab, setTab] = useState<Tab>(initialSettingsOpen ? "Settings" : "Overview");
    const identity = snapshot ? snapshot.installationId + "/" + snapshot.profile.id + "/" + snapshot.epoch + "/" + snapshot.sequence : "";
    useEffect(() => { setTab(current => current === "Settings" ? current : "Overview"); }, [identity]);
    const [palette, setPalette] = useState(() => readThemeStyle(stored("vault-mobile-palette")));
    const [mode, setMode] = useState(() => { const s = stored("vault-mobile-mode"); return s === "light" || s === "dark" ? s : "system"; });
    useEffect(() => { document.documentElement.dataset.palette = palette; if (mode === "system")
        document.documentElement.removeAttribute("data-theme");
    else
        document.documentElement.dataset.theme = mode; }, [palette, mode]);
    function navigate(next: Tab) {
        if (tab === next) return;
        setTab(next);
        if (document.scrollingElement) document.scrollingElement.scrollTop = 0;
    }
    const appearance = <div className="mobile-appearance">
        <div><span>Theme</span><MenuSelect ariaLabel="Theme" value={palette} onChange={v => { setPalette(readThemeStyle(v)); save("vault-mobile-palette", v); }} options={[{ value: "transparent", label: "Default" }, { value: "futuristic", label: "Futuristic" }, { value: "retro", label: "Retro" }]}/></div>
        <div><span>Color mode</span><MenuSelect ariaLabel="Color mode" value={mode} onChange={v => { setMode(v); save("vault-mobile-mode", v); }} options={[{ value: "system", label: "System" }, { value: "light", label: "Light" }, { value: "dark", label: "Dark" }]}/></div>
    </div>;
    const profiles = availableProfiles ?? snapshots.map(s => ({ value: s.installationId + "/" + s.profile.id, label: s.profile.name }));
    return <div className="mobile-viewer">
    <header className="mobile-header"><div className="mobile-brand"><span className="mobile-logo" aria-hidden="true">V</span><strong>Vault Spend</strong></div><div className="mobile-actions"><button type="button" aria-label={hidden ? "Show amounts" : "Hide amounts"} onClick={() => setHidden(!hidden)}>{hidden ? <EyeOff size={20} aria-hidden="true"/> : <Eye size={20} aria-hidden="true"/>}</button></div></header>
    {!!profiles.length && <div className="mobile-profile"><MenuSelect ariaLabel="Profile" value={snapshot ? snapshot.installationId + "/" + snapshot.profile.id : selectedProfile ?? profiles[0].value} onChange={id => { setSelected(id); onProfileChange?.(id); }} options={profiles}/><span className="mobile-badge">Read only</span></div>}
    {tab === "Settings" ? <main id="mobile-main" className="mobile-settings-page">
        <h1>Settings</h1>
        {snapshot && <Card title="Saved snapshot" icon={<CloudDownload size={19} aria-hidden="true"/>} className="mobile-snapshot-card">
            <div className="mobile-sync">
                <span>Snapshot as of {formatDisplayDate(snapshot.asOfDate)}<small>Saved {formatEpochDateTime(Date.parse(snapshot.generatedAt) / 1000)}</small></span>
                <button type="button" className="mobile-primary" onClick={() => onRefresh?.(snapshot)} disabled={!onRefresh || refreshing}>{refreshing ? "Refreshing…" : "Refresh"}</button>
            </div>
            {refreshMessage && <p role="status">{refreshMessage}</p>}
            <p className="mobile-muted">Refresh while this profile is open and unlocked on your desktop.</p>
        </Card>}
        <Card title="Appearance" icon={<Palette size={19} aria-hidden="true"/>}>{appearance}</Card>
        {connectionControls}
    </main> : snapshot ? <>
        <p className="mobile-snapshot-status"><Clock3 size={14} aria-hidden="true"/><span>{formatDisplayDate(snapshot.asOfDate)} · {statusSummary ?? "Saved snapshot"}</span></p>
        <ProfilePages key={identity} tab={tab} setTab={navigate} snapshot={snapshot} hidden={hidden}/>
    </> : <main id="mobile-main" className="mobile-empty">
        <span className="mobile-empty-icon"><CloudDownload size={28} aria-hidden="true"/></span>
        <h1>No saved snapshot</h1>
        <p>Connect to Vault Spend on your desktop to save a read-only copy on this phone.</p>
        <button type="button" className="mobile-primary" onClick={() => navigate("Settings")}>Open Settings to pair</button>
    </main>}
    <nav className="mobile-nav" aria-label="Mobile views">
        {tabs.map(({ label, icon: Icon }) => <button type="button" key={label} aria-label={label} aria-current={tab === label ? "page" : undefined} onClick={() => navigate(label)}>
            <span className="mobile-nav-icon"><Icon size={20} aria-hidden="true"/></span><span className="mobile-nav-label">{label}</span>
        </button>)}
    </nav>
  </div>;
}
function ProfilePages({ snapshot: s, hidden, tab, setTab }: {
    snapshot: MobileSnapshotV1;
    hidden: boolean;
    tab: Exclude<Tab, "Settings">;
    setTab: (tab: Tab) => void;
}) {
    const section = tab === "Overview" ? s.sections.overview : tab === "Accounts" ? s.sections.accounts : tab === "Budget" ? s.sections.budgets : tab === "Reports" ? s.sections.reports : s.sections.calculators;
    const accountPreferenceKey = `vault-mobile-overview-accounts:${s.installationId}/${s.profile.id}/${s.epoch}`;
    const [overviewAccounts, setOverviewAccounts] = useState(() => readOverviewAccounts(accountPreferenceKey, s));
    return <main id="mobile-main">
        <h1>{tab === "Overview" ? "Your money at a glance" : tab === "Accounts" ? "Your accounts" : tab === "Budget" ? "Your budget" : tab === "Reports" ? "The bigger picture" : "Plan your next step"}</h1>
        {section.state !== "available" && <p className="mobile-notice" role="status">{section.state === "partial" ? "Partial snapshot: " : "Unavailable: "}{section.reason}</p>}
        {section.state !== "unavailable" && (tab === "Overview" ? <Overview snapshot={s} hidden={hidden} go={setTab}
            overviewAccounts={overviewAccounts} onSelectAccounts={ids => {
                setOverviewAccounts(ids);
                save(accountPreferenceKey, JSON.stringify(ids));
            }}/>
            : tab === "Accounts" ? <MobileAccounts snapshot={s} hidden={hidden}/>
            : tab === "Budget" ? <MobileBudget snapshot={s} hidden={hidden}/>
            : tab === "Reports" ? <MobileReports snapshot={s} hidden={hidden} onBudget={() => setTab("Budget")}/>
            : <MobileTools snapshot={s} hidden={hidden}/>)}
    </main>;
}

function Overview({ snapshot: s, hidden, go, overviewAccounts, onSelectAccounts }: {
    snapshot: MobileSnapshotV1;
    hidden: boolean;
    go: (t: Tab) => void;
    overviewAccounts: string[];
    onSelectAccounts: (ids: string[]) => void;
}) {
    const budget = currentBudget(s);
    const plan = budget ? budgetSpendingPlan(budget) : null;
    const overPlan = plan !== null && units(plan.remaining) < 0n;
    return <>
        <section className="mobile-hero">
            <h2>Net worth</h2>
            <div className="mobile-total"><Amount value={s.overview.netWorth} hidden={hidden}/></div>
            <details className="mobile-net-worth-breakdown">
                <summary>What makes up my net worth?</summary>
                <Line label="Cash & savings" value={s.overview.cash} hidden={hidden}/>
                <Line label="Investments" value={s.overview.investments} hidden={hidden}/>
                <Line label="Property" value={s.overview.propertyValue} hidden={hidden}/>
                <Line label="Other accounts" value={s.overview.otherAccounts} hidden={hidden}/>
                <Line label="Debt contribution" value={s.overview.debtContribution} hidden={hidden}/>
            </details>
        </section>
        <div className="mobile-grid mobile-overview-metrics">
            <Card title="Income received this month" icon={<ArrowDownLeft size={17} aria-hidden="true"/>} className="mobile-income"><Amount value={budget?.actualIncome ?? null} hidden={hidden}/></Card>
            <Card title="Spending this month" icon={<ArrowUpRight size={17} aria-hidden="true"/>} className="mobile-outflow"><Amount value={budget?.actualSpending ?? null} hidden={hidden}/></Card>
        </div>
        {budget && <Card title={`${monthLabel(budget.month)} budget`}>
            {plan ? <>
                <Line label={!hidden && overPlan ? "Over the spending plan" : "Left in the spending plan"} value={overPlan ? subtract("0", plan.remaining) : plan.remaining} hidden={hidden}/>
                {units(plan.planned) > 0n && <Progress actual={plan.actual} planned={plan.planned} hidden={hidden}/>}
            </> : <p>No spending categories in this plan.</p>}
            <button type="button" className="mobile-link" onClick={() => go("Budget")}>See full budget <ArrowRight size={16} aria-hidden="true"/></button>
        </Card>}
        {s.sections.accounts.state !== "unavailable" && <Card title="Your accounts">
            <MobileAccountPreview accounts={s.accounts} selectedIds={overviewAccounts} onSelect={onSelectAccounts}
                hidden={hidden} onViewAll={() => go("Accounts")}/>
        </Card>}
        <Card title="Cash runway">
            <Line label="Average monthly spending" value={s.overview.averageMonthlySpend} hidden={hidden}/>
            <p>{hidden ? "••••" : s.overview.runwayMonths === null ? "Runway unavailable" : `${Number(s.overview.runwayMonths).toFixed(1)} months at the saved spending pace`}</p>
        </Card>
    </>;
}
