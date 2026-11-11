import { useState, FormEvent } from "react";
import { type CategoryIconKey, IconPicker, CATEGORY_ICON_OPTIONS, CategoryIcon } from "../../shared/ui/icons";
import { ModalShell } from "../../shared/ui/Modal";

export function NewCategoryDialog({
  onCancel,
  onSubmit,
}: {
  onCancel: () => void;
  onSubmit: (name: string, iconKey: string | null) => void;
}) {
  const [name, setName] = useState("");
  const [iconKey, setIconKey] = useState<CategoryIconKey | null>(null);

  function handleSubmit(e: FormEvent) {
    e.preventDefault();
    if (!name.trim()) return;
    onSubmit(name.trim(), iconKey);
  }

  return (
    <ModalShell title="New category" onCancel={onCancel}>
      <form onSubmit={handleSubmit}>
        <label className="modal-field">
          <span>Category name</span>
          <input
            autoFocus
            value={name}
            onChange={(e) => setName(e.target.value)}
            placeholder='e.g. "Pet Care"'
          />
        </label>
        <label className="modal-field">
          <span>Icon (optional)</span>
          <IconPicker
            options={CATEGORY_ICON_OPTIONS}
            value={iconKey}
            onChange={setIconKey}
            renderIcon={(key) => <CategoryIcon category={name} iconKey={key} />}
          />
        </label>
        <div className="modal-actions">
          <button type="button" className="modal-secondary" onClick={onCancel}>
            Cancel
          </button>
          <button type="submit" disabled={!name.trim()}>
            Add category
          </button>
        </div>
      </form>
    </ModalShell>
  );
}
