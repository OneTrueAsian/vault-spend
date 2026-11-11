import { type FamilyMember } from "../../shared/lib/types";
import { useState, FormEvent } from "react";
import { useAutoCancelDelete } from "../../shared/hooks/useAutoCancelDelete";
import { ModalShell } from "../../shared/ui/Modal";

/** Same interaction pattern as `ManageCategoriesDialog` — a flat named list
 * with inline rename and delete-with-confirm — since a family member is the
 * same shape of thing as a category: a label other data is attributed to,
 * not a container with its own balance or fields. Unlike a category rename,
 * renaming into an existing name is just an error (surfaced by the caller's
 * usual status handling), not a merge — two family members are never the
 * same person. */
export function ManageFamilyMembersDialog({
  members,
  onCancel,
  onCreate,
  onRename,
  onDelete,
}: {
  members: FamilyMember[];
  onCancel: () => void;
  onCreate: (name: string) => void;
  onRename: (id: number, newName: string) => void;
  onDelete: (id: number) => void;
}) {
  const [editing, setEditing] = useState<number | null>(null);
  const [draftName, setDraftName] = useState("");
  const [confirmingDelete, setConfirmingDelete] = useState<number | null>(null);
  useAutoCancelDelete(confirmingDelete, () => setConfirmingDelete(null));
  const [newMemberName, setNewMemberName] = useState("");

  function startEditing(member: FamilyMember) {
    setConfirmingDelete(null);
    setEditing(member.id);
    setDraftName(member.name);
  }

  function commitRename(id: number, oldName: string) {
    const trimmed = draftName.trim();
    if (trimmed && trimmed !== oldName) {
      onRename(id, trimmed);
    }
    setEditing(null);
  }

  function handleCreateSubmit(e: FormEvent) {
    e.preventDefault();
    const trimmed = newMemberName.trim();
    if (!trimmed) return;
    onCreate(trimmed);
    setNewMemberName("");
  }

  return (
    <ModalShell title="Manage family members" onCancel={onCancel} wide>
      <p className="modal-message modal-message-secondary">
        Just a label within this one file — everyone still shares the same data. For a completely separate person's
        own data, use Profiles in Settings instead.
      </p>
      <form className="category-create-form" onSubmit={handleCreateSubmit}>
        <input
          value={newMemberName}
          onChange={(e) => setNewMemberName(e.target.value)}
          placeholder='New family member, e.g. "Alex"'
        />
        <button type="submit" disabled={!newMemberName.trim()}>
          Add
        </button>
      </form>
      {members.length === 0 ? (
        <p className="modal-message">No family members yet.</p>
      ) : (
        <ul className="category-manage-list">
          {members.map((member) => (
            <li key={member.id} className="category-manage-row">
              {editing === member.id ? (
                <input
                  autoFocus
                  value={draftName}
                  onChange={(e) => setDraftName(e.target.value)}
                  onBlur={() => commitRename(member.id, member.name)}
                  onKeyDown={(e) => {
                    if (e.key === "Enter") commitRename(member.id, member.name);
                    if (e.key === "Escape") setEditing(null);
                  }}
                />
              ) : (
                <span className="category-manage-name">{member.name}</span>
              )}
              {confirmingDelete === member.id ? (
                <span className="category-manage-confirm">
                  <span className="modal-message-secondary">
                    Delete? Anything attributed to {member.name} becomes unassigned.
                  </span>
                  <button type="button" className="modal-secondary" onClick={() => setConfirmingDelete(null)}>
                    Cancel
                  </button>
                  <button type="button" className="btn-danger" onClick={() => onDelete(member.id)}>
                    Delete
                  </button>
                </span>
              ) : (
                <span className="category-manage-actions">
                  <button type="button" className="modal-secondary" onClick={() => startEditing(member)}>
                    Rename
                  </button>
                  <button
                    type="button"
                    className="modal-secondary"
                    onClick={() => {
                      setEditing(null);
                      setConfirmingDelete(member.id);
                    }}
                  >
                    Delete
                  </button>
                </span>
              )}
            </li>
          ))}
        </ul>
      )}
      <div className="modal-actions">
        <button type="button" onClick={onCancel}>
          Done
        </button>
      </div>
    </ModalShell>
  );
}
