import { useState } from "react";
import { ArrowRight, ChartNoAxesCombined, ChevronDown, CreditCard, Landmark, PiggyBank, Wallet } from "lucide-react";
import { formatDisplayDate, formatEpochDateTime } from "../shared/lib/format";
import { Amount, Card, Line, MobileMetric } from "./MobileShared";
import type { Account, MobileSnapshotV1, QuoteCoverage } from "./mobileSnapshotTypes";
import { subtract } from "./mobileViewModel";

const ACCOUNT_TYPES = {
    checking: { label: "Checking", icon: Wallet },
    savings: { label: "Savings", icon: PiggyBank },
    credit: { label: "Credit card", icon: CreditCard },
    loan: { label: "Loan", icon: Landmark },
    investment: { label: "Investment", icon: ChartNoAxesCombined },
    other: { label: "Other account", icon: Wallet },
};

const ACCOUNT_GROUPS = [
    { title: "Cash & savings", types: ["checking", "savings"] },
    { title: "Credit cards & loans", types: ["credit", "loan"] },
    { title: "Investment accounts", types: ["investment"] },
    { title: "Other accounts", types: ["other"] },
];

function AccountSummary({ account, hidden }: { account: Account; hidden: boolean }) {
    const { label, icon: Icon } = ACCOUNT_TYPES[account.accountType];
    const credit = account.accountType === "credit";
    const loan = account.accountType === "loan";
    // The snapshot's credit balance is available credit; the amount owed comes from its debt contribution.
    const amount = credit ? account.owed ?? subtract(account.startingBalance, account.balance) : loan ? account.owed ?? account.balance : account.balance;
    const balanceLabel = credit ? "Credit card balance" : loan ? "Loan balance" : account.balanceBasis === "holdings" ? "Holdings value" : "Account balance";
    return <>
        <span className="mobile-account-icon" data-kind={account.accountType}><Icon size={20} aria-hidden="true"/></span>
        <span className="mobile-account-name"><strong>{account.name}</strong><small>{label}</small></span>
        <span className="mobile-account-value"><strong><Amount value={amount} hidden={hidden}/></strong><small>{balanceLabel}</small></span>
    </>;
}

export const OVERVIEW_ACCOUNT_LIMIT = 3;

export function defaultOverviewAccountIds(accounts: Account[]): string[] {
    const preferred = ["checking", "savings", "credit"].flatMap(type => {
        const match = accounts.find(account => account.accountType === type);
        return match ? [match.id] : [];
    });
    return [...new Set([...preferred, ...accounts.map(account => account.id)])].slice(0, OVERVIEW_ACCOUNT_LIMIT);
}

export function MobileAccountPreview({ accounts, selectedIds, onSelect, hidden, onViewAll }: {
    accounts: Account[];
    selectedIds: string[];
    onSelect: (ids: string[]) => void;
    hidden: boolean;
    onViewAll: () => void;
}) {
    const [pickerOpen, setPickerOpen] = useState(false);
    if (!accounts.length) return <p>No accounts in this snapshot.</p>;
    const byId = new Map(accounts.map(account => [account.id, account]));
    const visible = selectedIds.map(id => byId.get(id)).filter(account => account !== undefined);
    const visibleIds = visible.map(account => account.id);
    return <>
        {visible.length ? <ul className="mobile-account-preview">
            {visible.map(account => <li className="mobile-account-summary" key={account.id}><AccountSummary account={account} hidden={hidden}/></li>)}
        </ul> : <p>No accounts selected for Overview.</p>}
        <button type="button" className="mobile-link" onClick={onViewAll}>See all accounts <ArrowRight size={16} aria-hidden="true"/></button>
        <details className="mobile-account-picker" onToggle={event => setPickerOpen(event.currentTarget.open)}>
            <summary>Choose accounts</summary>
            {pickerOpen && <>
                <p role="status">{visible.length} of {OVERVIEW_ACCOUNT_LIMIT} selected. {visible.length === OVERVIEW_ACCOUNT_LIMIT ? "Uncheck one to add another." : "Choose which accounts appear on Overview."}</p>
                <div className="mobile-account-options" role="group" aria-label="Accounts to show on Overview">
                    {accounts.map(account => {
                        const checked = visibleIds.includes(account.id);
                        return <label key={account.id} className="mobile-check">
                            <input type="checkbox" checked={checked} disabled={!checked && visible.length >= OVERVIEW_ACCOUNT_LIMIT}
                                onChange={event => onSelect(event.currentTarget.checked ? [...visibleIds, account.id] : selectedIds.filter(id => id !== account.id))}/>
                            <span><strong>{account.name}</strong><small>{ACCOUNT_TYPES[account.accountType].label}</small></span>
                        </label>;
                    })}
                </div>
            </>}
        </details>
    </>;
}

export function MobileAccounts({ snapshot, hidden }: { snapshot: MobileSnapshotV1; hidden: boolean }) {
    const { accounts, investments, members, overview, sections } = snapshot;
    const memberNames = new Map(members.map(member => [member.id, member.name]));
    return <>
        {accounts.length === 0 ? <Card title="Accounts"><p>No accounts in this snapshot.</p></Card> : <>
            <div className="mobile-grid mobile-account-totals">
                <Card title="Cash & savings" icon={<PiggyBank size={17} aria-hidden="true"/>} className="mobile-income"><Amount value={overview.cash} hidden={hidden}/></Card>
                <Card title="Card & loan balances" icon={<CreditCard size={17} aria-hidden="true"/>} className="mobile-outflow"><Amount value={subtract("0", overview.debtContribution)} hidden={hidden}/></Card>
            </div>
            {ACCOUNT_GROUPS.map(({ title, types }) => {
                const group = accounts.filter(account => types.includes(account.accountType));
                if (group.length === 0) return null;
                return <section className="mobile-account-group" key={title}>
                    <h2>{title}</h2>
                    {group.map(account => {
                        const member = account.memberId ? memberNames.get(account.memberId) : undefined;
                        const hasDetails = account.accountType === "credit" || member || account.checkpointDate;
                        const heading = <AccountSummary account={account} hidden={hidden}/>;
                        return hasDetails ? <details className="mobile-account-tile" key={account.id}>
                            <summary className="mobile-account-summary">{heading}<ChevronDown className="mobile-account-chevron" size={16} aria-hidden="true"/></summary>
                            <div className="mobile-account-details">
                                {account.accountType === "credit" && <>
                                    <Line label="Available credit" value={account.balance} hidden={hidden}/>
                                    <Line label="Credit limit" value={account.startingBalance} hidden={hidden}/>
                                </>}
                                {member && <p>Belongs to {member}</p>}
                                {account.checkpointDate && <p>Balance last confirmed {formatDisplayDate(account.checkpointDate)}</p>}
                            </div>
                        </details> : <div className="mobile-account-tile mobile-account-summary" key={account.id}>{heading}</div>;
                    })}
                </section>;
            })}
        </>}
        <Card title="Investment totals" icon={<ChartNoAxesCombined size={19} aria-hidden="true"/>} className="mobile-investment-totals">
            {sections.investments.state === "unavailable" ? <p>Investment details aren’t available in this snapshot.</p> : <>
                <MobileMetric label="Saved portfolio value" value={investments.value} hidden={hidden}/>
                <Line label="Cost basis" value={investments.costBasis} hidden={hidden}/>
                <Line label="Gain or loss on current holdings" value={investments.unrealizedGain} hidden={hidden}/>
                <Line label="Day change" value={investments.dayChange} hidden={hidden}/>
                <PriceDetails coverage={investments.coverage}/>
                {investments.accounts.map(account => <details key={account.accountId} className="mobile-investment-detail">
                    <summary><span>{accounts.find(item => item.id === account.accountId)?.name ?? "Investment account"}</span><Amount value={account.value} hidden={hidden}/></summary>
                    <Line label="Cost basis" value={account.costBasis} hidden={hidden}/>
                    <Line label="Gain or loss on current holdings" value={account.unrealizedGain} hidden={hidden}/>
                    <Line label="Day change" value={account.dayChange} hidden={hidden}/>
                    <PriceDetails coverage={account.coverage}/>
                </details>)}
            </>}
        </Card>
    </>;
}

function PriceDetails({ coverage }: { coverage: QuoteCoverage }) {
    return <div className="mobile-price-note">
        <strong>Prices from your saved snapshot</strong>
        <p>{coverage.quoteTimestamp ? `Price update recorded ${formatEpochDateTime(Date.parse(coverage.quoteTimestamp) / 1000)}.` : "Price update times aren’t available in this snapshot."}</p>
        {coverage.state === "partial" && <p>Day change may be missing for some holdings.</p>}
        {coverage.previousCloseDate && <p>Previous close: {formatDisplayDate(coverage.previousCloseDate)}</p>}
    </div>;
}
