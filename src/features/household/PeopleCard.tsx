import { useState } from "react";
import type { FamilyMember } from "../../shared/lib/types";
import { useAutoCancelDelete } from "../../shared/hooks/useAutoCancelDelete";

/** Uses the same callbacks and delete confirmation as the family-members dialog. */
export function PeopleCard({ members, onRename, onRemove }: {
  members: FamilyMember[];
  onRename: (id: number, name: string) => void;
  onRemove: (id: number) => void;
}) {
  const [editing, setEditing] = useState<number | null>(null);
  const [draft, setDraft] = useState("");
  const [removing, setRemoving] = useState<number | null>(null);
  useAutoCancelDelete(removing, () => setRemoving(null));
  return <section className="card household-people">
    <h2 className="reports-section-title">People</h2>
    {members.length === 0 && <p className="modal-message-secondary">Add a family member to see spending and budgets broken down by person.</p>}
    <ul className="household-people-list">
      {members.map(member => <li key={member.id}>
        {editing === member.id ? <form onSubmit={e => {
          e.preventDefault();
          const name = draft.trim();
          if (name && name !== member.name) onRename(member.id, name);
          setEditing(null);
        }}>
          <input autoFocus aria-label={`Name for ${member.name}`} value={draft} onChange={e => setDraft(e.target.value)} onKeyDown={e => { if (e.key === "Escape") setEditing(null); }} />
          <button type="submit" disabled={!draft.trim()}>Save</button>
          <button type="button" className="modal-secondary" onClick={() => setEditing(null)}>Cancel</button>
        </form> : <>
          <span>{member.name}</span>
          {removing === member.id ? <span className="household-remove-confirm">
            <span>Remove? Anything attributed to {member.name} becomes unassigned.</span>
            <button type="button" className="modal-secondary" autoFocus onClick={() => setRemoving(null)}>Cancel</button>
            <button type="button" className="btn-danger" onClick={() => { onRemove(member.id); setRemoving(null); }}>Remove person</button>
          </span> : <span className="household-person-actions">
            <button type="button" className="modal-secondary" aria-label={`Rename ${member.name}`} onClick={() => { setRemoving(null); setDraft(member.name); setEditing(member.id); }}>Rename</button>
            <button type="button" className="modal-secondary" aria-label={`Remove ${member.name}`} onClick={() => { setEditing(null); setRemoving(member.id); }}>Remove</button>
          </span>}
        </>}
      </li>)}
    </ul>
  </section>;
}
