import { useRef } from "react";
import { formatAmount } from "./format";
import { useDelayedVisibility } from "./useDelayedVisibility";

/** Shared "what makes up this number" breakdown panel — a list of named
 * amounts, largest-magnitude first, shown below whichever clickable stat
 * card triggered it. Used by the Dashboard's KPI cards and the Reports/
 * Accounts pages' own stat totals.
 *
 * `changeRows` is an optional second section ("what changed") used only by
 * the Dashboard's four stat cards, showing which account(s) moved between
 * the same two dates the card's own sparkline/delta covers — omitted
 * entirely (not just empty) by every other caller. Its `delta` sign is
 * whatever the caller considers "increased"; `changeGoodDirection` says
 * which direction (an increase, or a decrease) counts as good news for
 * this particular number, since that's inverted for Debt versus Cash/Net
 * Worth/Investments.
 *
 * A row's amount is red when it needs you (s4): when the row's `flag` says so, or, without a
 * flag, when it is negative (a budget alert's negative amount is over budget).
 *
 * Always mounted by its caller (not `{expandedStat && <StatDetailPanel/>}`)
 * so it can play a real close transition instead of vanishing the instant
 * `isOpen` flips false — `title`/`rows` go `null` on close, but the panel
 * keeps rendering its *last* content through the closing animation rather
 * than going blank first. */
export function StatDetailPanel({
  title,
  rows,
  changeRows,
  changeLabel,
  changeGoodDirection = "up",
  emptyMessage,
  isOpen,
  onClose,
}: {
  title: string | null;
  rows: { name: string; amount: number; flag?: boolean }[] | null;
  changeRows?: { name: string; delta: number }[] | null;
  changeLabel?: string;
  changeGoodDirection?: "up" | "down";
  emptyMessage?: string;
  isOpen: boolean;
  onClose: () => void;
}) {
  const { shouldRender, closing } = useDelayedVisibility(isOpen);
  const lastContent = useRef<{
    title: string;
    rows: { name: string; amount: number; flag?: boolean }[];
    changeRows: { name: string; delta: number }[] | null;
    changeLabel?: string;
    changeGoodDirection: "up" | "down";
  } | null>(null);
  if (title !== null && rows !== null) {
    lastContent.current = { title, rows, changeRows: changeRows ?? null, changeLabel, changeGoodDirection };
  }

  if (!shouldRender || !lastContent.current) return null;
  const {
    title: shownTitle,
    rows: shownRows,
    changeRows: shownChangeRows,
    changeLabel: shownChangeLabel,
    changeGoodDirection: shownChangeGoodDirection,
  } = lastContent.current;

  return (
    <div className={closing ? "card stat-detail-panel stat-detail-panel-closing" : "card stat-detail-panel"}>
      <div className="card-head">
        <span className="reports-section-title">What makes up {shownTitle}</span>
        <button type="button" className="modal-secondary" onClick={onClose}>
          Close
        </button>
      </div>
      {shownRows.length > 0 ? (
        shownRows
          .slice()
          .sort((a, b) => Math.abs(b.amount) - Math.abs(a.amount))
          .map((row) => (
            <div
              key={row.name}
              style={{ display: "flex", justifyContent: "space-between", padding: "6px 0", fontSize: "13px" }}
            >
              <span>{row.name}</span>
              <span className={(row.flag ?? row.amount < 0) ? "amount-col report-over-budget" : "amount-col"}>
                {formatAmount(row.amount)}
              </span>
            </div>
          ))
      ) : (
        <p className="empty-state">{emptyMessage ?? "Nothing contributes to this yet."}</p>
      )}
      {shownChangeRows && shownChangeRows.length > 0 && (
        <>
          <div className="stat-detail-divider" />
          <span className="reports-section-title">What changed{shownChangeLabel ? ` ${shownChangeLabel}` : ""}</span>
          {shownChangeRows.map((row) => {
            const increased = row.delta > 0;
            const good = shownChangeGoodDirection === "up" ? increased : !increased;
            return (
              <div
                key={row.name}
                style={{ display: "flex", justifyContent: "space-between", padding: "6px 0", fontSize: "13px" }}
              >
                <span>{row.name}</span>
                <span className={good ? "stat-delta up" : "stat-delta down"}>
                  {increased ? "▲" : "▼"} {formatAmount(Math.abs(row.delta))}
                </span>
              </div>
            );
          })}
        </>
      )}
    </div>
  );
}
