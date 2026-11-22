import { useState } from "react";
import { MenuSelect } from "../../shared/ui/MenuSelect";
import { type WidgetId, WIDGET_CATALOG, accountWidgetId, bucketWidgetId, investmentWidgetId, watchWidgetId } from "../../shared/lib/dashboardLayout";
import { type Account, type Bucket, type Holding } from "../../shared/lib/types";
import type { SavedTransactionFilter } from "../../shared/native/appTypes";
import { ModalShell } from "../../shared/ui/Modal";

/** One "pick a specific account/bucket/investment account, then Add" row
 * inside the "Pin a specific item" group below — a `<select>` since the
 * options are open-ended (however many accounts/buckets the user has),
 * unlike the fixed catalog rows above which are just a static "Add"
 * button per row. */
function PinItemRow<T>({
  label,
  options,
  getKey,
  getLabel,
  onAdd,
}: {
  label: string;
  options: T[];
  getKey: (item: T) => string;
  getLabel: (item: T) => string;
  onAdd: (item: T) => void;
}) {
  const [selectedKey, setSelectedKey] = useState("");
  const [touched, setTouched] = useState(false);
  const selectedItem = options.find((o) => getKey(o) === selectedKey);

  // VS-68: once the row is in use, say what the greyed-out Add is waiting for (three idle rows stay quiet).
  return (
    <li className="category-manage-row" onFocus={() => setTouched(true)}>
      <span className="category-manage-name">{label}</span>
      {options.length === 0 ? (
        <span className="modal-message-secondary">None available</span>
      ) : (
        <>
          <MenuSelect
            ariaLabel={`Choose ${label}`}
            placeholder="Choose…"
            value={selectedKey}
            onChange={setSelectedKey}
            options={options.map((o) => ({ value: getKey(o), label: getLabel(o) }))}
          />
          <button
            type="button"
            className="modal-secondary"
            disabled={!selectedItem}
            onClick={() => {
              if (!selectedItem) return;
              onAdd(selectedItem);
              setSelectedKey("");
            }}
          >
            Add
          </button>
          {touched && !selectedItem && (
            <small className="field-problem" role="status" data-pin-missing>Choose one to pin.</small>
          )}
        </>
      )}
    </li>
  );
}

/** A watch on a store (VS-46): typed, since descriptions are raw bank text with store numbers, and matched the way
 * the Transactions search box matches, so "See this month's transactions" shows the same rows. */
function StoreWatchRow({ onAdd }: { onAdd: (name: string) => void }) {
  const [name, setName] = useState("");
  const [touched, setTouched] = useState(false);
  const trimmed = name.trim();
  return (
    <li className="category-manage-row" onFocus={() => setTouched(true)}>
      <span className="category-manage-name">Store</span>
      <input type="text" aria-label="Store name to watch" placeholder="Like Amazon" value={name} onChange={(e) => setName(e.target.value)} />
      <button
        type="button"
        className="modal-secondary"
        disabled={!trimmed}
        onClick={() => {
          onAdd(trimmed);
          setName("");
        }}
      >
        Add
      </button>
      {touched && !trimmed && (
        <small className="field-problem" role="status" data-watch-store-missing>Type a store name, as it appears in your transactions.</small>
      )}
    </li>
  );
}

/** Two catalog groups — the 9 always-available core widgets, and the 4
 * report sections that can also be pinned here from their home tab (Cash
 * Flow, Investments, Reports) — plus a "Pin a specific item" picker for
 * one particular account/bucket/investment account, or a watch on a
 * category, tag, store or saved filter (VS-46), since those aren't a
 * bounded catalog. Adding a catalog widget here is the exact same action
 * as clicking "Pin to Dashboard" on its home tab — both just add the id to
 * the layout — so a widget already on the Dashboard shows "Added" instead
 * of a duplicate Add button, and clicking Add doesn't close the dialog,
 * so more than one can be added in a row. */
export function AddWidgetDialog({
  currentWidgets,
  accounts,
  buckets,
  holdings,
  safeToSpendEnabled,
  categories = [],
  tags = [],
  savedFilters = [],
  onAdd,
  onCancel,
}: {
  currentWidgets: WidgetId[];
  accounts: Account[];
  buckets: Bucket[];
  holdings: Holding[];
  safeToSpendEnabled: boolean;
  /** For the watch rows (VS-46): categories, tags in use, and saved Transactions filters. */
  categories?: string[];
  tags?: string[];
  savedFilters?: SavedTransactionFilter[];
  onAdd: (id: WidgetId) => void;
  onCancel: () => void;
}) {
  const groups: { title: string; items: typeof WIDGET_CATALOG }[] = [
    { title: "Core widgets", items: WIDGET_CATALOG.filter((w) => w.group === "core" && (safeToSpendEnabled || w.id !== "safe_to_spend")) },
    { title: "Pinned reports", items: WIDGET_CATALOG.filter((w) => w.group === "report") },
  ];

  const pinnableAccounts = accounts.filter((a) => !currentWidgets.includes(accountWidgetId(a.id)));
  const pinnableBuckets = buckets.filter((b) => !currentWidgets.includes(bucketWidgetId(b.id)));
  const investmentAccountNames = Array.from(new Set(holdings.map((h) => h.account_name))).sort();
  const pinnableInvestmentAccounts = investmentAccountNames.filter((name) => !currentWidgets.includes(investmentWidgetId(name)));
  const unwatched = (kind: "category" | "tag" | "filter", names: string[]) => names.filter((n) => !currentWidgets.includes(watchWidgetId(kind, n)));

  return (
    <ModalShell title="Add widget" onCancel={onCancel} wide>
      {groups.map((g) => (
        <div key={g.title}>
          <p className="modal-message-secondary widget-group-title">{g.title}</p>
          <ul className="category-manage-list widget-catalog-list">
            {g.items.map((w) => {
              const added = currentWidgets.includes(w.id);
              return (
                <li key={w.id} className="category-manage-row">
                  <span className="category-manage-name">{w.label}</span>
                  <button type="button" className="modal-secondary" disabled={added} onClick={() => onAdd(w.id)}>
                    {added ? "Added" : "Add"}
                  </button>
                </li>
              );
            })}
          </ul>
        </div>
      ))}
      <div>
        <p className="modal-message-secondary widget-group-title">Pin a specific item</p>
        <ul className="category-manage-list">
          <PinItemRow
            label="Account"
            options={pinnableAccounts}
            getKey={(a) => String(a.id)}
            getLabel={(a) => a.name}
            onAdd={(a) => onAdd(accountWidgetId(a.id))}
          />
          <PinItemRow
            label="Goal"
            options={pinnableBuckets}
            getKey={(b) => String(b.id)}
            getLabel={(b) => b.name}
            onAdd={(b) => onAdd(bucketWidgetId(b.id))}
          />
          <PinItemRow
            label="Investment account"
            options={pinnableInvestmentAccounts}
            getKey={(name) => name}
            getLabel={(name) => name}
            onAdd={(name) => onAdd(investmentWidgetId(name))}
          />
          <PinItemRow
            label="Category"
            options={unwatched("category", categories)}
            getKey={(name) => name}
            getLabel={(name) => name}
            onAdd={(name) => onAdd(watchWidgetId("category", name))}
          />
          <PinItemRow
            label="Tag"
            options={unwatched("tag", tags)}
            getKey={(name) => name}
            getLabel={(name) => name}
            onAdd={(name) => onAdd(watchWidgetId("tag", name))}
          />
          <StoreWatchRow onAdd={(name) => onAdd(watchWidgetId("store", name))} />
          <PinItemRow
            label="Saved filter"
            options={unwatched("filter", savedFilters.map((f) => f.name))}
            getKey={(name) => name}
            getLabel={(name) => name}
            onAdd={(name) => onAdd(watchWidgetId("filter", name))}
          />
        </ul>
      </div>
      <div className="modal-actions">
        <button type="button" onClick={onCancel}>
          Done
        </button>
      </div>
    </ModalShell>
  );
}
