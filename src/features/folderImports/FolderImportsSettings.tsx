import { useCallback, useEffect, useMemo, useState } from "react";
import { invoke } from "@tauri-apps/api/core";
import { open } from "@tauri-apps/plugin-dialog";
import "./FolderImports.css";
import { cardAttr, SettingStar } from "../../shared/ui/SettingStar";
import { MoreInfo } from "../../shared/ui/MoreInfo";
import { MenuSelect } from "../../shared/ui/MenuSelect";
import { DateField } from "../../shared/ui/DateField";
import { CopyablePath } from "../../shared/ui/CopyablePath";
import { errorMessage } from "../../shared/lib/errorMessage";
import { formatDisplayDate } from "../../shared/lib/format";
import { pickableAccounts } from "../../shared/lib/hiddenAccounts";
import type { Account } from "../../shared/lib/types";
import { folderImportsClient, type FolderImports, type FolderMapping, type FolderMatch } from "./folderImportsApi";

type Call = <T>(command: string, args?: Record<string, unknown>) => Promise<T>;
type PickFolder = () => Promise<string | null>;

const defaultPickFolder: PickFolder = async () => {
  const picked = await open({ directory: true, multiple: false, title: "Choose the folder your bank exports are saved in" });
  return typeof picked === "string" ? picked : null;
};

/** One export name being edited. `id` is null until it is saved. */
type Draft = {
  key: string;
  id: number | null;
  accountId: string;
  stem: string;
  csv: boolean;
  xlsx: boolean;
  invert: boolean;
  includeExisting: boolean;
  cutoff: string;
  /** Changed here and not saved yet: kept when the card reads its settings again. */
  dirty: boolean;
};

/** The date `daysAgo` days before today, as YYYY-MM-DD. */
function isoDaysAgo(daysAgo: number): string {
  const d = new Date();
  d.setDate(d.getDate() - daysAgo);
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`;
}

function draftOf(m: FolderMapping): Draft {
  return {
    key: `m${m.id}`,
    id: m.id,
    accountId: String(m.account_id),
    stem: m.stem,
    csv: m.extensions.includes("csv"),
    xlsx: m.extensions.includes("xlsx"),
    invert: m.invert_amounts,
    includeExisting: m.initial_cutoff === null,
    cutoff: m.initial_cutoff ?? isoDaysAgo(NEW_NAME_DAYS_BACK),
    dirty: false,
  };
}

/** A new name starts this many days back, so an export downloaded in the last few days (named with
 * the day before) isn't skipped as older. */
const NEW_NAME_DAYS_BACK = 7;

const AMOUNT_OPTIONS = [
  { value: "as-written", label: "Spending is negative in the file (use as written)" },
  { value: "flip", label: "Spending is positive in the file (flip the signs)" },
];

/** Settings → Data → Folder imports (VS-102): turn watching on or off, choose the folder, and say
 * which file names belong to which account, how their amounts read and from which date on. */
export function FolderImportsSettings({
  accounts,
  onChanged,
  call = invoke,
  pickFolder = defaultPickFolder,
}: {
  accounts: Account[];
  /** Something changed here (watching, folder or names): the Transactions page reads the queue again. */
  onChanged?: () => void;
  call?: Call;
  pickFolder?: PickFolder;
}) {
  const client = useMemo(() => folderImportsClient(call), [call]);
  const [data, setData] = useState<FolderImports | null>(null);
  const [drafts, setDrafts] = useState<Draft[]>([]);
  const [message, setMessage] = useState<{ text: string; kind: "info" | "error" } | null>(null);
  const [matches, setMatches] = useState<FolderMatch[] | null>(null);
  const [working, setWorking] = useState(false);
  // Which removal is waiting for "Yes": "stop" for the folder, or a draft's key.
  const [confirming, setConfirming] = useState<string | null>(null);

  /** Reads the settings again. Names being edited or not saved yet are kept, except `justSaved`. */
  const load = useCallback(
    async (justSaved: string | null = null) => {
      const next = await client.get();
      setData(next);
      setDrafts((current) => {
        const editing = new Map(current.filter((d) => d.dirty && d.id !== null && d.key !== justSaved).map((d) => [d.id, d]));
        const unsaved = current.filter((d) => d.id === null && d.key !== justSaved);
        return [...next.mappings.map((m) => editing.get(m.id) ?? draftOf(m)), ...unsaved];
      });
    },
    [client],
  );

  useEffect(() => {
    load().catch((e) => setMessage({ text: errorMessage(e), kind: "error" }));
  }, [load]);

  async function run(action: () => Promise<string | null | void>, justSaved: string | null = null) {
    setWorking(true);
    setMessage(null);
    setConfirming(null);
    try {
      const text = await action();
      await load(justSaved);
      onChanged?.();
      if (text) setMessage({ text, kind: "info" });
    } catch (e) {
      setMessage({ text: errorMessage(e), kind: "error" });
    } finally {
      setWorking(false);
    }
  }

  const accountOptions = (keep: string) =>
    pickableAccounts(accounts, keep).map((a) => ({ value: String(a.id), label: a.name }));

  function update(key: string, change: Partial<Draft>) {
    setDrafts((all) => all.map((d) => (d.key === key ? { ...d, ...change, dirty: true } : d)));
  }

  function addDraft() {
    // No account is chosen for the person: exports landing in the wrong account is worse than one more pick.
    setDrafts((all) => [
      ...all,
      { key: `new${Date.now()}`, id: null, accountId: "", stem: "", csv: true, xlsx: true, invert: false, includeExisting: false, cutoff: isoDaysAgo(NEW_NAME_DAYS_BACK), dirty: true },
    ]);
  }

  async function save(d: Draft) {
    await run(async () => {
      await client.saveMapping({
        id: d.id,
        account_id: Number(d.accountId),
        stem: d.stem,
        extensions: [...(d.csv ? ["csv"] : []), ...(d.xlsx ? ["xlsx"] : [])],
        invert_amounts: d.invert,
        initial_cutoff: d.includeExisting ? null : d.cutoff,
      });
      return "Saved. Exports with this name go to the account you chose.";
    }, d.key);
  }

  async function remove(d: Draft) {
    if (d.id === null) {
      setDrafts((all) => all.filter((x) => x.key !== d.key));
      return;
    }
    await run(async () => {
      await client.deleteMapping(d.id!);
      return "Removed. Exports already waiting stay in Folder activity.";
    });
  }

  async function chooseFolder() {
    const dir = await pickFolder();
    if (!dir) return;
    await run(async () => {
      const kept = await client.setFolder(dir);
      if (!kept) return null;
      return enabled ? `Watching ${kept}.` : `Folder chosen: ${kept}. Turn on watching in step 3 when you're ready.`;
    });
  }

  async function checkNames() {
    setWorking(true);
    setMessage(null);
    try {
      setMatches(await client.testNames());
    } catch (e) {
      setMessage({ text: errorMessage(e), kind: "error" });
    } finally {
      setWorking(false);
    }
  }

  const enabled = data?.enabled ?? false;
  const canEnable = !!data?.folder && (data?.mappings.length ?? 0) > 0;

  return (
    <div className="card" data-folder-imports-settings {...cardAttr("folder-imports")}>
      <div className="card-head">
        <h2 className="reports-section-title">Folder imports</h2>
        <SettingStar id="folder-imports" />
      </div>
      <p className="modal-message-secondary">
        Save your bank's exports into one folder and Vault Spend picks them up for you to review in Transactions. Nothing is added
        until you approve it, and Import transactions still works as before.{" "}
        <MoreInfo>
          Files are picked up while this profile is open and unlocked. Exports saved while Vault Spend is closed are found the next
          time you open it. Your files stay in your folder untouched; Vault Spend keeps its own copy for review in this profile's data,
          protected the same way as the rest of it. The folder is remembered on this computer only.
        </MoreInfo>
      </p>

      <h3 className="folder-activity-heading" data-folder-step>
        1. Choose the folder
      </h3>
      <div className="settings-action">
        <button type="button" className="modal-secondary" onClick={() => void chooseFolder()} disabled={working} data-folder-choose>
          {data?.folder ? "Change folder" : "Choose folder"}
        </button>
        {data?.folder ? <CopyablePath path={data.folder} /> : <p className="modal-message-secondary">No folder chosen on this computer yet.</p>}
        {data?.folder &&
          (confirming === "stop" ? (
            <button
              type="button"
              className="btn-danger"
              onClick={() => void run(async () => { await client.setFolder(null); return "Stopped watching that folder."; })}
              disabled={working}
              data-folder-confirm-stop
            >
              Yes, stop using it
            </button>
          ) : (
            <button type="button" className="modal-secondary" onClick={() => setConfirming("stop")} disabled={working} data-folder-stop>
              Stop using this folder
            </button>
          ))}
      </div>
      {data?.folder_missing && (
        <p role="alert" className="import-review-notice">This folder can't be found right now. Connect its drive, or choose the folder again.</p>
      )}

      <h3 className="folder-activity-heading" data-folder-step>
        2. Name your exports
      </h3>
      <p className="modal-message-secondary">
        An export name is the start of the file name your bank uses, before the date. For example, the export name Bank Max Checking
        matches files named:
      </p>
      <ul className="modal-message-secondary folder-settings-examples">
        <li><code>Bank Max Checking_2026-11-18.csv</code></li>
        <li><code>Bank Max Checking_2026-11-11_to_2026-11-18.csv</code></li>
        <li><code>Bank Max Checking - 2026-11-11 to 2026-11-18.csv</code></li>
        <li><code>Bank Max Checking - Nov 11 to Nov 18, 2026.csv</code></li>
      </ul>
      <p className="modal-message-secondary">
        The date in the name only says how new the export is; each transaction keeps its own date.
      </p>
      {drafts.map((d) => {
        const saved = d.id !== null ? data?.mappings.find((m) => m.id === d.id) : undefined;
        const which = d.stem.trim() ? `${d.stem.trim()} exports` : "these exports";
        return (
          <div key={d.key} className="folder-settings-mapping" data-folder-mapping={d.id ?? "new"}>
            <label className="folder-settings-field folder-settings-stem">
              <span>File name starts with</span>
              <input type="text" value={d.stem} onChange={(e) => update(d.key, { stem: e.target.value })} disabled={working} data-folder-stem />
            </label>
            <div className="folder-settings-field">
              <span>Account</span>
              <MenuSelect
                ariaLabel={`Account for ${which}`}
                placeholder="Choose an account"
                value={d.accountId}
                onChange={(v) => update(d.key, { accountId: v })}
                options={accountOptions(d.accountId)}
                disabled={working}
                fill
              />
              {saved && !saved.account_usable && (
                <span role="alert" className="import-review-notice">The account for this name was deleted or hidden. Choose another and save.</span>
              )}
            </div>
            <div className="folder-settings-field">
              <span>Amounts</span>
              <MenuSelect
                ariaLabel={`How amounts read in ${which}`}
                value={d.invert ? "flip" : "as-written"}
                onChange={(v) => update(d.key, { invert: v === "flip" })}
                options={AMOUNT_OPTIONS}
                disabled={working}
                fill
              />
              <span className="modal-message-secondary">
                Most checking and savings exports show money you spend with a minus sign. Many credit card exports don't. Choose “flip the signs” for those.
              </span>
            </div>
            <fieldset className="folder-settings-field">
              <legend>File types</legend>
              <div className="folder-settings-checks">
                <label>
                  <input type="checkbox" checked={d.csv} onChange={(e) => update(d.key, { csv: e.target.checked })} disabled={working} /> CSV
                </label>
                <label>
                  <input type="checkbox" checked={d.xlsx} onChange={(e) => update(d.key, { xlsx: e.target.checked })} disabled={working} /> Excel workbook (.xlsx)
                </label>
              </div>
            </fieldset>
            <fieldset className="folder-settings-field folder-settings-which">
              <legend>Which exports</legend>
              <label>
                <input type="radio" name={`which-${d.key}`} checked={!d.includeExisting} onChange={() => update(d.key, { includeExisting: false })} disabled={working} /> Only exports dated on or after
              </label>
              <DateField value={d.cutoff} onChange={(iso) => update(d.key, { cutoff: iso })} ariaLabel={`Only ${which} dated on or after`} disabled={working || d.includeExisting} data-folder-cutoff />
              {!d.includeExisting && (
                <span className="modal-message-secondary">
                  Exports dated before this are skipped.
                  {d.id === null && " A new name starts a week back, so exports you saved in the last few days are included."}
                </span>
              )}
              <label>
                <input type="radio" name={`which-${d.key}`} checked={d.includeExisting} onChange={() => update(d.key, { includeExisting: true })} disabled={working} data-folder-include-existing /> Also exports already in the folder
              </label>
              {saved?.watermark && (
                <span className="folder-settings-watermark">
                  The newest export imported so far is dated {formatDisplayDate(saved.watermark)}. Older exports are skipped so files you've been through aren't picked up again.{" "}
                  <button
                    type="button"
                    className="modal-secondary"
                    onClick={() =>
                      void run(async () => {
                        await client.clearWatermark(saved.id);
                        return "Done. Exports skipped as older are picked up again, except ones already imported or dismissed.";
                      })
                    }
                    disabled={working}
                    data-folder-clear-watermark={saved.id}
                  >
                    Pick up older exports again
                  </button>
                </span>
              )}
            </fieldset>
            <div className="folder-settings-row-actions">
              <button type="button" onClick={() => void save(d)} disabled={working || !d.accountId || (!d.csv && !d.xlsx)} data-folder-save-mapping>
                {d.id === null ? "Add" : "Save"}
              </button>
              {d.id !== null && confirming === d.key ? (
                <button type="button" className="btn-danger" onClick={() => void remove(d)} disabled={working} data-folder-confirm-remove-mapping={d.id}>
                  Yes, remove it
                </button>
              ) : (
                <button
                  type="button"
                  className="modal-secondary"
                  onClick={() => (d.id === null ? void remove(d) : setConfirming(d.key))}
                  disabled={working}
                  data-folder-remove-mapping={d.id ?? "new"}
                >
                  Remove
                </button>
              )}
            </div>
          </div>
        );
      })}
      <div className="settings-actions">
        <button type="button" className="modal-secondary" onClick={addDraft} disabled={working || pickableAccounts(accounts).length === 0} data-folder-add-mapping>
          Add an export name
        </button>
        <button type="button" className="modal-secondary" onClick={() => void checkNames()} disabled={working || !data?.folder} data-folder-check-names>
          Check the folder
        </button>
      </div>
      {matches && (
        matches.length === 0 ? (
          <p className="modal-message-secondary" role="status">There are no CSV or Excel files in this folder yet.</p>
        ) : (
          <ul className="folder-settings-matches" data-folder-matches>
            {matches.map((m) => (
              <li key={m.file_name}>
                <strong>{m.file_name}</strong>
                {m.account_name ? ` → ${m.account_name}` : ""}: {m.reason}
              </li>
            ))}
          </ul>
        )
      )}
      <h3 className="folder-activity-heading" data-folder-step>
        3. Turn it on
      </h3>
      <label className="feature-toggle-row" data-folder-imports-toggle>
        <input
          type="checkbox"
          checked={enabled}
          disabled={working || !data || (!enabled && !canEnable)}
          onChange={(e) => {
            const on = e.target.checked;
            void run(async () => {
              await client.setEnabled(on);
              return on ? "Watching the folder for new exports." : "Stopped watching. Exports already waiting are kept.";
            });
          }}
        />
        <span>Watch a folder for bank exports</span>
      </label>
      {!enabled && !canEnable && data && (
        <p className="modal-message-secondary">
          {data.folder ? "Add and save at least one export name first." : "Choose a folder and add at least one export name first."}
        </p>
      )}
      {message && (
        <p role={message.kind === "error" ? "alert" : "status"} className={message.kind === "error" ? "import-review-notice" : "modal-message-secondary"}>
          {message.text}
        </p>
      )}
    </div>
  );
}
