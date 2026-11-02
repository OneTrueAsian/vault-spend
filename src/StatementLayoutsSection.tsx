import { useCallback, useEffect, useState } from "react";
import { invoke } from "@tauri-apps/api/core";
import { errorMessage } from "./errorMessage";
import { getCurrentGeneration } from "./profileUiState";
import { SettingStar, cardAttr } from "./SettingStar";
import { validateStatementLayouts, type StatementLayoutSummary } from "./statementContracts";

/** Settings: the banks whose statements the app has learned to read on this profile. */
export function StatementLayoutsSection({ onMessage }: { onMessage: (text: string, kind: "success" | "error" | "info") => void }) {
  const [layouts, setLayouts] = useState<StatementLayoutSummary[]>([]);
  const [editing, setEditing] = useState<{ id: number; name: string } | null>(null);
  const [confirming, setConfirming] = useState<number | null>(null);

  const load = useCallback(async () => {
    const generation = await getCurrentGeneration();
    setLayouts(validateStatementLayouts(await invoke("list_statement_layouts", { generation })));
  }, []);
  useEffect(() => {
    load().catch((e) => onMessage(errorMessage(e), "error"));
  }, [load, onMessage]);

  /** Runs one change, then reloads the list. True when it worked. */
  async function change(work: (generation: number) => Promise<unknown>, done: string): Promise<boolean> {
    try {
      await work(await getCurrentGeneration());
      await load();
      onMessage(done, "success");
      return true;
    } catch (e) {
      onMessage(errorMessage(e), "error");
      return false;
    }
  }

  return (
    <div className="card" data-statement-layouts {...cardAttr("statement-layouts")}>
      <div className="card-head">
        <h2 className="reports-section-title">Statements the app knows how to read</h2>
        <SettingStar id="statement-layouts" />
      </div>
      {layouts.length === 0 ? (
        <p className="modal-message-secondary">
          When you upload a statement from a new bank and finish reconciling, the app remembers how to read it. Those banks show up here.
        </p>
      ) : (
        <ul className="feature-toggle-list">
          {layouts.map((l) => (
            <li key={l.id} className="feature-toggle-row" data-layout={l.id}>
              <span className="feature-toggle-text">
                {editing?.id === l.id ? (
                  <input value={editing.name} onChange={(e) => setEditing({ id: l.id, name: e.target.value })} aria-label="Name" data-rename-input />
                ) : (
                  <span className="feature-toggle-label">{l.name}</span>
                )}
                <span className="modal-message-secondary">Recognized by: {l.phrases.map((p) => `“${p}”`).join(", ")}</span>
              </span>
              {editing?.id === l.id ? (
                <button
                  type="button"
                  onClick={() =>
                    void change((generation) => invoke("rename_statement_layout", { id: l.id, name: editing.name, generation }), "Renamed.").then(
                      (ok) => ok && setEditing(null),
                    )
                  }
                  data-save-layout-name={l.id}
                >
                  Save
                </button>
              ) : (
                <button type="button" className="modal-secondary" onClick={() => setEditing({ id: l.id, name: l.name })} data-rename-layout={l.id}>
                  Rename
                </button>
              )}
              {confirming === l.id ? (
                <button
                  type="button"
                  onClick={() =>
                    void change(
                      (generation) => invoke("delete_statement_layout", { id: l.id, generation }),
                      "Removed. The app will ask for help with this bank's next statement.",
                    ).then(() => setConfirming(null))
                  }
                  data-confirm-remove-layout={l.id}
                >
                  Yes, remove it
                </button>
              ) : (
                <button type="button" className="modal-secondary" onClick={() => setConfirming(l.id)} data-remove-layout={l.id}>
                  Remove
                </button>
              )}
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}
