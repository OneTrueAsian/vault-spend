import { useState } from "react";
import { type ChangelogEntry, changelogSections } from "../shared/lib/changelog";
import { ModalShell } from "../shared/ui/Modal";

/** The dialog opens on the first few notes of each group; See more shows the rest. Settings → About keeps the full history. */
const NOTES_SHOWN = 3;

export function WhatsNewDialog({
  version,
  notes,
  onClose,
}: {
  version: string;
  notes: ChangelogEntry;
  onClose: () => void;
}) {
  const [expanded, setExpanded] = useState(false);
  const sections = changelogSections(notes);
  const hasMore = sections.some((s) => s.notes.length > NOTES_SHOWN);
  return (
    <ModalShell title={`What's new in ${version}`} onCancel={onClose} wide>
      {sections.map(({ heading, notes: items }) => (
        <section key={heading ?? ""}>
          {heading && <h3 className="modal-changelog-heading">{heading}</h3>}
          <ul className="modal-changelog-list">
            {(expanded ? items : items.slice(0, NOTES_SHOWN)).map((note, i) => (
              <li key={i}>{note}</li>
            ))}
          </ul>
        </section>
      ))}
      <div className="modal-actions">
        {hasMore && (
          <button type="button" className="modal-secondary" aria-expanded={expanded} onClick={() => setExpanded((e) => !e)}>
            {expanded ? "See less" : "See more"}
          </button>
        )}
        <button type="button" onClick={onClose}>
          Got it
        </button>
      </div>
    </ModalShell>
  );
}
