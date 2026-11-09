import type { WidgetId } from "../lib/dashboardLayout";

/** The same control appears next to 4 report sections (Cash Flow's Top
 * merchants and Debt Payoff Planner, Investments' Allocation, Reports' Net
 * Worth by Member) — adding a widget id to the Dashboard's layout is the
 * exact same action the "+ Add widget" modal performs, just reached from
 * the report's own page. Once pinned, this becomes a static confirmation
 * rather than an unpin control — removing a widget is a Dashboard
 * Customize-mode action, not something the source page exposes. */
export function PinToDashboardButton({
  widgetId,
  layoutWidgets,
  onPin,
}: {
  widgetId: WidgetId;
  layoutWidgets: WidgetId[];
  onPin: (id: WidgetId) => void;
}) {
  const pinned = layoutWidgets.includes(widgetId);
  if (pinned) {
    return <span className="pin-widget-pinned">Pinned ✓</span>;
  }
  return (
    <button type="button" className="modal-secondary" onClick={() => onPin(widgetId)}>
      Pin to Dashboard
    </button>
  );
}
