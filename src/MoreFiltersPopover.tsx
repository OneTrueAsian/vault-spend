import { usePopover } from "./usePopover";

/** Collapses the Transactions tab's less-frequently-used filters (date range, tag)
 * behind one toggle — same toggle-button/click-outside/panel shape as
 * `AccountFilterDropdown`, reusing its `.account-filter*` CSS classes
 * outright rather than inventing new ones. Search/Category/Account/Member
 * stay immediately visible in the Transactions toolbar; this just keeps the
 * occasional ones a click away instead of permanent visual weight. */
export function MoreFiltersPopover({
  filterFrom,
  onSetFrom,
  filterTo,
  onSetTo,
  filterTag,
  allTags,
  onSetTag,
}: {
  filterFrom: string;
  onSetFrom: (v: string) => void;
  filterTo: string;
  onSetTo: (v: string) => void;
  filterTag: string;
  allTags: string[];
  onSetTag: (v: string) => void;
}) {
  const { open, setOpen, rootRef, triggerRef } = usePopover();

  const activeCount = [filterFrom !== "", filterTo !== "", filterTag !== "all"].filter(Boolean).length;
  const label = activeCount === 0 ? "More filters" : `${activeCount} filter${activeCount === 1 ? "" : "s"} active`;

  function clearAll() {
    onSetFrom("");
    onSetTo("");
    onSetTag("all");
  }

  return (
    <div className="account-filter" ref={rootRef}>
      <button
        ref={triggerRef}
        type="button"
        className="account-filter-toggle"
        onClick={() => setOpen((v) => !v)}
        aria-haspopup="true"
        aria-expanded={open}
      >
        {label}
        <span className="account-filter-caret">▾</span>
      </button>
      {open && (
        <div className="account-filter-panel">
          {activeCount > 0 && (
            <div className="account-filter-panel-actions">
              <button type="button" className="modal-secondary" onClick={clearAll}>
                Clear all
              </button>
            </div>
          )}
          <label className="labeled-field" style={{ marginBottom: 8 }}>
            <span className="labeled-field-label">From date</span>
            <input type="date" value={filterFrom} onChange={(e) => onSetFrom(e.target.value)} />
          </label>
          <label className="labeled-field" style={{ marginBottom: 8 }}>
            <span className="labeled-field-label">To date</span>
            <input type="date" value={filterTo} onChange={(e) => onSetTo(e.target.value)} />
          </label>
          <label className="labeled-field">
            <span className="labeled-field-label">Tag</span>
            <select value={filterTag} onChange={(e) => onSetTag(e.target.value)}>
              <option value="all">All tags</option>
              {allTags.map((tag) => (
                <option key={tag} value={tag}>
                  {tag}
                </option>
              ))}
            </select>
          </label>
        </div>
      )}
    </div>
  );
}
