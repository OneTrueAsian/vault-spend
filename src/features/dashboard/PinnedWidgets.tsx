/** The pinned widgets for one account, one goal, one investment account, or one watch. Each is a plain card of the data it is given;
 * DashboardView looks the target up and renders nothing when it has been deleted since it was pinned. */
import { AccountTypeIcon, BucketIcon } from "../../shared/ui/icons";
import { Eye, LineChart as LineChartIcon } from "lucide-react";
import { WATCH_KIND_LABEL, type WatchTarget, type WatchTotals } from "./watchlist";
import { formatAmount } from "../../shared/lib/format";
import { groupOf, netWorthContribution, owedAmount } from "../../shared/lib/accountGroups";
import { sumMoney } from "../../shared/lib/money";
import { daysLeft } from "../budgets/BucketsView";
import type { Account, Bucket, Holding } from "../../shared/lib/types";

export function AccountWidget({ account, onOpenAccounts }: { account: Account; onOpenAccounts: () => void }) {
  const group = groupOf(account.account_type);
  const isDebt = group === "credit" || group === "loan";
  const amount = isDebt ? owedAmount(account) : netWorthContribution(account);
  // A debt account is not by itself a problem (s4), so its tile and badge stay neutral.
  const tint = isDebt ? "tint-neutral" : group === "investment" ? "tint-purple" : "tint-blue";
  const badgeColor = isDebt ? "neutral" : group === "investment" ? "purple" : "blue";
  return (
    <div className={`stat stat-hero ${tint}`}>
      <div className="stat-top">
        <span className={`mini-ico ${badgeColor}`}>
          <AccountTypeIcon accountType={account.account_type} iconKey={account.icon_key} />
        </span>
        <span className="stat-label">{account.name}</span>
      </div>
      <span className="stat-value">{formatAmount(amount)}</span>
      <span className="stat-delta">
        {isDebt ? "Owed" : "Balance"}
        {(account.institution || account.mask) &&
          ` · ${[account.institution, account.mask ? `••${account.mask}` : null].filter(Boolean).join(" ")}`}
      </span>
      <div className="clickable-row" onClick={onOpenAccounts} title="Go to the Accounts tab">
        <span className="category-link">View in Accounts →</span>
      </div>
    </div>
  );}

export function BucketWidget({ bucket, onOpenBuckets }: { bucket: Bucket; onOpenBuckets: () => void }) {
  const saved = parseFloat(bucket.saved_amount);
  const target = bucket.target_amount ? parseFloat(bucket.target_amount) : null;
  const pct = target && target > 0 ? Math.min(100, Math.max(0, (saved / target) * 100)) : null;
  // A goal's own picked color (BucketsView's color picker) takes over the
  // badge/card tint when set, same way it already colors that goal's
  // border and progress bar on the Goals page — falls back to the
  // standard purple tint used everywhere else on the Dashboard.
  const badgeStyle = bucket.color
    ? { background: `linear-gradient(135deg, color-mix(in srgb, ${bucket.color} 65%, black), ${bucket.color})` }
    : undefined;
  const cardStyle = bucket.color
    ? { background: `linear-gradient(180deg, var(--surface) 0%, color-mix(in srgb, ${bucket.color} 8%, var(--surface)) 100%)` }
    : undefined;
  return (
    <div className="stat stat-hero tint-purple" style={cardStyle}>
      <div className="stat-top">
        <span className="mini-ico purple" style={badgeStyle}>
          <BucketIcon name={bucket.name} iconKey={bucket.icon_key} />
        </span>
        <span className="stat-label">{bucket.name}</span>
      </div>
      <span className="stat-value">{formatAmount(bucket.saved_amount)}</span>
      <span className="stat-delta">
        {bucket.target_amount
          ? `of ${formatAmount(bucket.target_amount)}${pct !== null ? ` (${Math.round(pct)}%)` : ""}`
          : "No target set"}
        {bucket.target_date && ` · ${daysLeft(bucket.target_date)}d left`}
      </span>
      <div className="clickable-row" onClick={onOpenBuckets} title="Go to the Goals tab">
        <span className="category-link">View in Goals →</span>
      </div>
    </div>
  );}

/** A watch tile (VS-46): spending this month so far on one category, tag, store or saved filter, against a usual
 * month. When the watched category, tag or saved filter is gone it says so and offers to remove itself. */
export function WatchWidget({ target, totals, usual, splitNote, missing, onOpen, onRemove }: {
  target: WatchTarget;
  /** `null` while a category's earlier months are still loading. */
  totals: WatchTotals | null;
  usual: number | null;
  splitNote: boolean;
  missing: boolean;
  onOpen: () => void;
  onRemove: () => void;
}) {
  const kind = WATCH_KIND_LABEL[target.kind];
  return (
    <div className="stat stat-hero tint-neutral" data-watch-tile>
      <div className="stat-top">
        <span className="mini-ico neutral">
          <Eye aria-hidden="true" />
        </span>
        <span className="stat-label">{target.name}</span>
      </div>
      {missing ? (
        <>
          <span className="stat-delta" data-watch-missing>
            This {kind.toLowerCase()} no longer exists.{target.kind === "category" ? " It may have been renamed or deleted." : ""}
          </span>
          <div>
            <button type="button" className="modal-secondary" onClick={onRemove}>Remove tile</button>
          </div>
        </>
      ) : (
        <>
          <span className="stat-value">{totals ? formatAmount(totals.thisMonth.toFixed(2)) : "…"}</span>
          <span className="stat-delta">{kind} · spent this month so far</span>
          <span className="stat-delta" data-watch-usual>
            {!totals ? "Working out a usual month…" : usual === null ? "No usual month yet. It needs a full month of history." : `Usual month: ${formatAmount(usual.toFixed(2))}`}
          </span>
          {splitNote && (
            <span className="stat-delta" data-watch-split-note>Split lines count by their own category, like Budget, so the list may not add up to this.</span>
          )}
          <div className="clickable-row" onClick={onOpen} title="Go to the Transactions tab">
            <span className="category-link">See this month's transactions →</span>
          </div>
        </>
      )}
    </div>
  );
}

export function InvestmentWidget({ accountName, accountHoldings, onOpenInvestments }: { accountName: string; accountHoldings: Holding[]; onOpenInvestments: () => void }) {
  const totalValue = sumMoney(accountHoldings.map((h) => h.value));
  const totalGain = sumMoney(accountHoldings.map((h) => h.gain_loss));
  return (
    <div className="stat stat-hero tint-purple">
      <div className="stat-top">
        <span className="mini-ico purple">
          <LineChartIcon aria-hidden="true" />
        </span>
        <span className="stat-label">{accountName}</span>
      </div>
      <span className="stat-value">{formatAmount(totalValue.toFixed(2))}</span>
      <span className={totalGain < 0 ? "stat-delta down" : "stat-delta up"}>
        {totalGain > 0 ? "+" : ""}
        {formatAmount(totalGain.toFixed(2))} gain/loss
      </span>
      <div className="clickable-row" onClick={onOpenInvestments} title="Go to the Investments tab">
        <span className="category-link">View in Investments →</span>
      </div>
    </div>
  );}
