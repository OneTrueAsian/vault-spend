import type { FamilyMember } from "./types";
import { usePopover } from "./usePopover";

/** `"all"` means no filter is applied (every member shown, including
 * unassigned rows) — kept as a distinct sentinel rather than always
 * expanding it to a concrete set of every member id, so the filter doesn't
 * need updating every time a member is added or removed. Same shape as
 * `AccountFilterValue`. A set naming every member is NOT the same thing: it
 * is a filter, so rows with no member stay out (only "all" includes them). */
export type MemberFilterValue = Set<number> | "all";

function isSelected(value: MemberFilterValue, memberId: number): boolean {
  return value === "all" || value.has(memberId);
}

/** A button that opens a checkbox list of every family member — same
 * toggle-button/panel shape as `AccountFilterDropdown`, minus the grouping
 * layer: members are an open-ended, user-defined list rather than a fixed
 * taxonomy, so there's no natural group to sort them into. */
export function MemberFilterDropdown({
  members,
  value,
  onChange,
}: {
  members: FamilyMember[];
  value: MemberFilterValue;
  onChange: (next: MemberFilterValue) => void;
}) {
  const { open, setOpen, rootRef, triggerRef } = usePopover();

  function toggleMember(memberId: number) {
    const next = new Set(value === "all" ? members.map((m) => m.id) : value);
    if (next.has(memberId)) next.delete(memberId);
    else next.add(memberId);
    // Never collapse to "all" here: ticking every member is a filter that leaves unassigned rows out,
    // while "all" (the Select all button) shows everything. With one member, choosing them must isolate them.
    onChange(next);
  }

  const chosen = value === "all" ? members : members.filter((m) => value.has(m.id));
  const label =
    value === "all"
      ? "All members"
      : chosen.length === 0
        ? "No members"
        : chosen.length === 1
          ? chosen[0].name
          : chosen.length === members.length
            ? "All named members"
            : `${chosen.length} members`;

  if (members.length === 0) return null;

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
          <div className="account-filter-panel-actions">
            <button type="button" className="modal-secondary" onClick={() => onChange("all")}>
              Select all
            </button>
            <button type="button" className="modal-secondary" onClick={() => onChange(new Set())}>
              Clear all
            </button>
          </div>
          <div className="account-filter-group">
            {members.map((m) => (
              <label key={m.id} className="account-filter-option">
                <input type="checkbox" checked={isSelected(value, m.id)} onChange={() => toggleMember(m.id)} />
                {m.name}
              </label>
            ))}
          </div>
        </div>
      )}
    </div>
  );
}
