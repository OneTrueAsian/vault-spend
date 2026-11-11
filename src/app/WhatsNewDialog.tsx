import { type ChangelogEntry, changelogSections } from "../shared/lib/changelog";
import { ModalShell } from "../shared/ui/Modal";

export function WhatsNewDialog({
  version,
  notes,
  onClose,
}: {
  version: string;
  notes: ChangelogEntry;
  onClose: () => void;
}) {
  return (
    <ModalShell title={`What's new in ${version}`} onCancel={onClose} wide>
      {changelogSections(notes).map(({ heading, notes: items }) => (
        <section key={heading ?? ""}>
          {heading && <h3 className="modal-changelog-heading">{heading}</h3>}
          <ul className="modal-changelog-list">
            {items.map((note, i) => (
              <li key={i}>{note}</li>
            ))}
          </ul>
        </section>
      ))}
      <div className="modal-actions">
        <button type="button" onClick={onClose}>
          Got it
        </button>
      </div>
    </ModalShell>
  );
}
