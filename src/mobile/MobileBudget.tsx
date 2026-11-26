import { useState } from "react";
import { CalendarDays, House, ShoppingBasket, Wallet } from "lucide-react";
import { formatDisplayDate } from "../shared/lib/format";
import { MenuSelect } from "../shared/ui/MenuSelect";
import { Amount, Card, Line, MobileMetric, Progress } from "./MobileShared";
import type { BudgetLine, BudgetMonth, MobileSnapshotV1 } from "./mobileSnapshotTypes";
import { addMoney, budgetSpendingPlan, currentBudget, monthLabel, subtract, units } from "./mobileViewModel";

const BUDGET_GROUPS = [
    { id: "income", title: "Income", icon: Wallet },
    { id: "fixed", title: "Fixed expenses", icon: House },
    { id: "flexible", title: "Flexible expenses", icon: ShoppingBasket },
    { id: "nonmonthly", title: "Non-monthly expenses", icon: CalendarDays },
] as const;

export function MobileBudget({ snapshot, hidden }: { snapshot: MobileSnapshotV1; hidden: boolean }) {
    const [month, setMonth] = useState(currentBudget(snapshot)?.month ?? snapshot.budgets.at(-1)?.month ?? "");
    const budget = snapshot.budgets.find(item => item.month === month);
    if (!budget) return <p>No budget saved in this snapshot.</p>;

    const plan = budgetSpendingPlan(budget);
    const actuals = Boolean(budget.actualThrough);
    const over = plan !== null && units(plan.remaining) < 0n;
    return <>
        <MenuSelect ariaLabel="Budget month" value={month} onChange={setMonth} options={snapshot.budgets.map(item => ({ value: item.month, label: monthLabel(item.month) }))}/>
        <Card title={monthLabel(month)} className="mobile-budget-month" icon={<CalendarDays size={19} aria-hidden="true"/>}>
            <p className="mobile-muted">{budget.actualThrough ? `Activity through ${formatDisplayDate(budget.actualThrough)}` : "Plan only. Activity for this month hasn’t started."}</p>
            {budget.sourceMonth && budget.sourceMonth !== month && <p className="mobile-muted">Plan from {monthLabel(budget.sourceMonth)}</p>}
            {plan && <div className="mobile-budget-pace" data-over={!hidden && actuals && over ? "" : undefined}>
                <MobileMetric label={!actuals ? "Spending plan" : !hidden && over ? "Over the spending plan" : "Left in the spending plan"} value={!actuals ? plan.planned : over ? subtract("0", plan.remaining) : plan.remaining} hidden={hidden}/>
                {actuals && <>
                    {units(plan.planned) > 0n && <Progress actual={plan.actual} planned={plan.planned} hidden={hidden}/>}
                    <Line label="Category spending" value={plan.actual} hidden={hidden}/>
                    <Line label="Spending plan, including rollover" value={plan.planned} hidden={hidden}/>
                </>}
            </div>}
            {actuals && <div className="mobile-budget-metrics">
                <MobileMetric label="Income recorded" value={budget.actualIncome} hidden={hidden}/>
                <MobileMetric label="Spending recorded" value={budget.actualSpending} hidden={hidden}/>
            </div>}
            {actuals && <Line label="Unbudgeted spending" value={budget.unbudgetedSpending} hidden={hidden}/>}
            {actuals && <details className="mobile-budget-disclosure">
                <summary>Budget details</summary>
                <p className="mobile-muted">Category spending subtracts refunds and can include transfers. Spending recorded and unbudgeted spending follow the report rules and show spending before refunds.</p>
            </details>}
        </Card>
        {budget.lines.length === 0 && <p>No categories in this month’s plan.</p>}
        {BUDGET_GROUPS.map(({ id, title, icon: Icon }) => {
            const lines = budget.lines.filter(line => line.group === id).sort((a, b) => a.order - b.order);
            if (!lines.length) return null;
            return <Card title={title} key={id} icon={<Icon size={18} aria-hidden="true"/>} className="mobile-budget-group">
                <Line label={id === "income" ? "Planned income" : "Group plan, including rollover"} value={addMoney(lines.map(line => line.effectiveBudget))} hidden={hidden}/>
                {actuals && <Line label={id === "income" ? "Income received" : "Group category spending"} value={addMoney(lines.map(line => line.actual))} hidden={hidden}/>}
                {lines.map(line => <BudgetCategory key={line.category} line={line} budget={budget} snapshot={snapshot} hidden={hidden}/>)}
            </Card>;
        })}
    </>;
}

function BudgetCategory({ line, budget, snapshot, hidden }: {
    line: BudgetLine; budget: BudgetMonth; snapshot: MobileSnapshotV1; hidden: boolean;
}) {
    const income = line.group === "income";
    const actuals = Boolean(budget.actualThrough);
    const alert = !hidden && actuals && (line.alert === "over" ? "Over plan" : line.alert === "warning" ? "Near limit" : null);
    const history = snapshot.history.budgetCategoryNet.filter(item => item.category === line.category);
    return <details className="mobile-budget-row">
        <summary>
            <span>{line.category}{alert && <small className="mobile-budget-alert">{alert}</small>}</span>
            <strong>{actuals && <><Amount value={line.actual} hidden={hidden}/> / </>}<Amount value={line.effectiveBudget} hidden={hidden}/></strong>
        </summary>
        {!income && actuals && units(line.effectiveBudget) > 0n && <Progress actual={line.actual} planned={line.effectiveBudget} hidden={hidden}/>}
        <Line label="Planned" value={line.planned} hidden={hidden}/>
        <Line label="Rollover" value={line.rollover} hidden={hidden}/>
        {actuals && <Line label={income ? "Income above / below plan" : "Remaining"} value={line.remaining} hidden={hidden}/>}
        {line.capEnabled && budget.capFeatureEnabled && <p className="mobile-muted">Spending cap on</p>}
        {line.rolloverEnabled && budget.rolloverFeatureEnabled && <p className="mobile-muted">Unused amounts roll over</p>}
        {history.length > 0 && <details className="mobile-budget-disclosure">
            <summary>Category history</summary>
            {history.map(item => <Line key={item.month} label={monthLabel(item.month)} value={income ? item.signedAmount : subtract("0", item.signedAmount)} hidden={hidden}/>)}
        </details>}
    </details>;
}
