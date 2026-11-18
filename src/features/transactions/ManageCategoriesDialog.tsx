import { useState, FormEvent } from "react";
import { useAutoCancelDelete } from "../../shared/hooks/useAutoCancelDelete";
import { type CategoryIconKey, IconPicker, CATEGORY_ICON_OPTIONS, CategoryIcon, isCategoryIconKey } from "../../shared/ui/icons";
import { ModalShell } from "../../shared/ui/Modal";

export function ManageCategoriesDialog({
  categories,
  categoryIconMap,
  onCancel,
  onCreate,
  onSetIcon,
  onRename,
  onDelete,
}: {
  categories: string[];
  /** Name → explicit icon override, for the swatch shown on each row — see
   * App.tsx's `categoryIconMap`. */
  categoryIconMap: Record<string, string | null>;
  onCancel: () => void;
  onCreate: (name: string, iconKey: string | null) => void;
  onSetIcon: (name: string, iconKey: string | null) => void;
  onRename: (oldName: string, newName: string) => void;
  onDelete: (name: string) => void;
}) {
  const [editing, setEditing] = useState<string | null>(null);
  const [draftName, setDraftName] = useState("");
  const [confirmingDelete, setConfirmingDelete] = useState<string | null>(null);
  useAutoCancelDelete(confirmingDelete, () => setConfirmingDelete(null));
  const [newCategoryName, setNewCategoryName] = useState("");
  const [newCategoryIcon, setNewCategoryIcon] = useState<CategoryIconKey | null>(null);
  const [editingIcon, setEditingIcon] = useState<string | null>(null);

  function startEditing(name: string) {
    setConfirmingDelete(null);
    setEditing(name);
    setDraftName(name);
  }

  function commitRename(oldName: string) {
    const trimmed = draftName.trim();
    if (trimmed && trimmed !== oldName) {
      onRename(oldName, trimmed);
    }
    setEditing(null);
  }

  function handleCreateSubmit(e: FormEvent) {
    e.preventDefault();
    const trimmed = newCategoryName.trim();
    if (!trimmed) return;
    onCreate(trimmed, newCategoryIcon);
    setNewCategoryName("");
    setNewCategoryIcon(null);
  }

  return (
    <ModalShell title="Manage categories" onCancel={onCancel} wide>
      <p className="modal-message modal-message-secondary">
        Renaming a category to a name that already exists merges the two.
      </p>
      <form className="category-create-form" onSubmit={handleCreateSubmit}>
        <input
          value={newCategoryName}
          onChange={(e) => setNewCategoryName(e.target.value)}
          placeholder='New category, e.g. "Pet Care"'
        />
        <button type="submit" disabled={!newCategoryName.trim()}>
          Add
        </button>
      </form>
      {newCategoryName.trim() !== "" && (
        <IconPicker
          options={CATEGORY_ICON_OPTIONS}
          value={newCategoryIcon}
          onChange={setNewCategoryIcon}
          renderIcon={(key) => <CategoryIcon category={newCategoryName} iconKey={key} />}
        />
      )}
      {categories.length === 0 ? (
        <p className="modal-message">No categories in use yet.</p>
      ) : (
        <ul className="category-manage-list">
          {categories.map((name) => {
            const currentIconKey = categoryIconMap[name] ?? null;
            return (
            <li key={name} className="category-manage-row">
              <span className="icon-toggle-anchor">
                <button
                  type="button"
                  className="icon-picker-swatch"
                  title="Click to change this category's icon"
                  aria-label={`Change ${name}'s icon`}
                  onClick={() => setEditingIcon(editingIcon === name ? null : name)}
                >
                  <CategoryIcon category={name} iconKey={currentIconKey} />
                </button>
                {editingIcon === name && (
                  <div className="icon-picker-popover">
                    <IconPicker
                      options={CATEGORY_ICON_OPTIONS}
                      value={currentIconKey && isCategoryIconKey(currentIconKey) ? currentIconKey : null}
                      onChange={(key) => {
                        onSetIcon(name, key);
                        setEditingIcon(null);
                      }}
                      renderIcon={(key) => <CategoryIcon category={name} iconKey={key} />}
                    />
                  </div>
                )}
              </span>
              {editing === name ? (
                <input
                  autoFocus
                  value={draftName}
                  onChange={(e) => setDraftName(e.target.value)}
                  onBlur={() => commitRename(name)}
                  onKeyDown={(e) => {
                    if (e.key === "Enter") commitRename(name);
                    if (e.key === "Escape") setEditing(null);
                  }}
                />
              ) : (
                <span className="category-manage-name">{name}</span>
              )}
              {confirmingDelete === name ? (
                <span className="category-manage-confirm">
                  <span className="modal-message-secondary">Delete? Its transactions become Uncategorized.</span>
                  <button type="button" className="modal-secondary" onClick={() => setConfirmingDelete(null)}>
                    Cancel
                  </button>
                  <button type="button" className="btn-danger" onClick={() => onDelete(name)}>
                    Delete
                  </button>
                </span>
              ) : (
                <span className="category-manage-actions">
                  <button type="button" className="modal-secondary" onClick={() => startEditing(name)}>
                    Rename
                  </button>
                  <button
                    type="button"
                    className="modal-secondary"
                    onClick={() => {
                      setEditing(null);
                      setConfirmingDelete(name);
                    }}
                  >
                    Delete
                  </button>
                </span>
              )}
            </li>
            );
          })}
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
