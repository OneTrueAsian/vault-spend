/** One line above the Transactions table, in place of the old four count tiles: how many
 * transactions still need a category, with a button that shows only those (and back). The other
 * counts moved into the page's subtitle. Renders nothing when there is nothing to sort. */
export function LedgerNeedsCategory({ count, active, onToggle }: { count: number; active: boolean; onToggle: () => void }) {
  if (count === 0 && !active) return null;
  const sentence = active
    ? count === 0
      ? "Nothing left that needs a category."
      : `Showing the ${count} that need${count === 1 ? "s" : ""} a category.`
    : `${count} transaction${count === 1 ? " needs" : "s need"} a category.`;
  return (
    <p className="ledger-needs-category" data-needs-category="">
      <span>{sentence}</span>
      <button type="button" className="modal-secondary btn-sm" onClick={onToggle}>
        {active ? "Show all" : "Review"}
      </button>
    </p>
  );
}
