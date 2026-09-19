import { useId, useMemo, useState } from "react";
import { ModalShell } from "./Modal";
import { filterPalette, type PaletteEntry, type PaletteKind } from "./paletteSearch";

const KIND_LABELS: Record<PaletteKind, string> = {
  tab: "Screen",
  action: "Action",
  account: "Account",
  goal: "Goal",
  transaction: "Transaction",
};

/** Ctrl+K: type a few letters to jump to a screen, run an action, or find an
 * account, goal or transaction. ↑/↓ choose, Enter runs, Esc closes. */
export function CommandPalette({
  entries,
  onRun,
  onClose,
}: {
  entries: PaletteEntry[];
  onRun: (entry: PaletteEntry) => void;
  onClose: () => void;
}) {
  const [query, setQuery] = useState("");
  const [active, setActive] = useState(0);
  const listId = useId();
  const results = useMemo(() => filterPalette(entries, query), [entries, query]);
  const current = Math.min(active, Math.max(0, results.length - 1));

  function handleKeyDown(e: React.KeyboardEvent<HTMLInputElement>) {
    if (e.key === "ArrowDown") {
      e.preventDefault();
      setActive(Math.min(results.length - 1, current + 1));
    } else if (e.key === "ArrowUp") {
      e.preventDefault();
      setActive(Math.max(0, current - 1));
    } else if (e.key === "Enter" && results[current]) {
      e.preventDefault();
      onRun(results[current]);
    }
  }

  return (
    <ModalShell title="Go to or do anything" onCancel={onClose} wide>
      <input
        autoFocus
        className="text-input palette-input"
        role="combobox"
        aria-expanded="true"
        aria-controls={listId}
        aria-activedescendant={results[current] ? `${listId}-${current}` : undefined}
        aria-label="Search screens, actions, accounts, goals and transactions"
        placeholder="Type a screen, action, account, goal or transaction…"
        value={query}
        onChange={(e) => {
          setQuery(e.target.value);
          setActive(0);
        }}
        onKeyDown={handleKeyDown}
        data-palette-input
      />
      {results.length === 0 ? (
        <p className="modal-message modal-message-secondary" data-palette-empty>
          Nothing matches “{query.trim()}”.
        </p>
      ) : (
        <ul className="palette-list" role="listbox" id={listId}>
          {results.map((entry, i) => (
            <li
              key={entry.id}
              id={`${listId}-${i}`}
              role="option"
              aria-selected={i === current}
              className={i === current ? "palette-option palette-option-active" : "palette-option"}
              data-palette-option={entry.id}
              onMouseMove={() => setActive(i)}
              onClick={() => onRun(entry)}
            >
              <span className={`palette-kind palette-kind-${entry.kind}`}>{KIND_LABELS[entry.kind]}</span>
              <span className="palette-label">{entry.label}</span>
              {entry.hint && <span className="palette-hint">{entry.hint}</span>}
            </li>
          ))}
        </ul>
      )}
      <p className="palette-foot">↑↓ choose · Enter open · Esc close</p>
    </ModalShell>
  );
}

const SHORTCUTS: { keys: string; what: string }[] = [
  { keys: "Ctrl+K", what: "Open the command palette — go anywhere, run anything" },
  { keys: "N", what: "Add a transaction" },
  { keys: "/", what: "Search transactions" },
  { keys: "?", what: "Show this list" },
  { keys: "Esc", what: "Close a dialog or the palette" },
];

export function ShortcutsDialog({ onClose }: { onClose: () => void }) {
  return (
    <ModalShell title="Keyboard shortcuts" onCancel={onClose}>
      <dl className="shortcut-list" data-shortcuts>
        {SHORTCUTS.map((s) => (
          <div key={s.keys}>
            <dt>
              <kbd>{s.keys}</kbd>
            </dt>
            <dd>{s.what}</dd>
          </div>
        ))}
      </dl>
      <p className="modal-message modal-message-secondary">Single-key shortcuts only work when you aren't typing in a field.</p>
      <div className="modal-actions">
        <button type="button" onClick={onClose}>
          Close
        </button>
      </div>
    </ModalShell>
  );
}
