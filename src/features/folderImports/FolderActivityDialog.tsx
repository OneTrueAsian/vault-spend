import { Fragment, useState } from "react";
import "./FolderImports.css";
import { ModalShell } from "../../shared/ui/Modal";
import { formatDisplayDate, formatFullDate } from "../../shared/lib/format";
import { errorMessage } from "../../shared/lib/errorMessage";
import type { FolderActivity, FolderBatch } from "./folderImportsApi";
import type { FolderImportsState } from "./useFolderImports";

const count = (n: number, one: string, many: string) => `${n} ${n === 1 ? one : many}`;

/** An outcome's label and its reason, without saying the same words twice. */
function outcomeText(outcome: string, reason: string): { label: string | null; reason: string } {
  // A "queued" entry is history: the export may since have been imported or dismissed.
  if (outcome === "queued") return { label: null, reason: "Queued for review" };
  const label = OUTCOME_LABEL[outcome] ?? "Noted";
  return reason.toLowerCase().startsWith(label.toLowerCase()) ? { label: null, reason } : { label, reason };
}

/** The dates a file name carried, for the list. */
export function exportDates(batch: Pick<FolderBatch, "export_start" | "export_end">): string {
  if (batch.export_start === batch.export_end) return formatDisplayDate(batch.export_end);
  // A range across New Year names both years, so its two ends read alike.
  const format = batch.export_start.slice(0, 4) === batch.export_end.slice(0, 4) ? formatDisplayDate : formatFullDate;
  return `${format(batch.export_start)} to ${format(batch.export_end)}`;
}

/** This many already-dealt-with entries in a row are shown as one line. */
const HANDLED_RUN_MIN = 3;
/** Recent files shows this many rows until more are asked for. */
const RECENT_ROWS_SHOWN = 10;

/** Outcomes that need nothing from the person (finished history), and how the one-line summary words them.
 * Problems (couldn't read, name not recognised, folder problem, ...) are not here, so they always stay visible. */
const HANDLED_WORD: Record<string, string> = {
  imported: "imported",
  already_imported: "imported",
  dismissed: "dismissed",
  already_dismissed: "dismissed",
  queued: "queued",
  requeued: "opened again",
  older: "older, skipped",
};

type Row = { kind: "entry"; entry: FolderActivity } | { kind: "handled"; entries: FolderActivity[] };

/** Runs of HANDLED_RUN_MIN or more consecutive handled entries become one row; everything else stays as it is. */
function groupHandled(entries: FolderActivity[]): Row[] {
  const rows: Row[] = [];
  for (let i = 0; i < entries.length; ) {
    let end = i;
    while (end < entries.length && entries[end].outcome in HANDLED_WORD) end++;
    if (end - i >= HANDLED_RUN_MIN) {
      rows.push({ kind: "handled", entries: entries.slice(i, end) });
      i = end;
    } else {
      rows.push({ kind: "entry", entry: entries[i] });
      i++;
    }
  }
  return rows;
}

/** "Account · rest of the name" for a file whose name starts with one of the export names; null when none does. */
function leadOf(fileName: string, accountName: string | null, stems: string[]): string | null {
  if (!accountName) return null;
  const lower = fileName.toLowerCase();
  const stem = [...stems].sort((a, b) => b.length - a.length).find((s) => s.trim() && lower.startsWith(s.trim().toLowerCase()));
  if (!stem) return null;
  const rest = fileName.slice(stem.trim().length).replace(/^[\s_\-–]+/, "");
  return rest ? `${accountName} · ${rest}` : null;
}

/** What the activity list calls each outcome. */
const OUTCOME_LABEL: Record<string, string> = {
  imported: "Imported",
  dismissed: "Dismissed",
  requeued: "Opened again",
  older: "Older export",
  already_imported: "Already imported",
  already_dismissed: "Dismissed earlier",
  bad_name: "Name not recognised",
  needs_account: "Needs an account",
  too_large: "Too large",
  unreadable: "Couldn't read",
  queue_full: "Waiting for room",
  folder_problem: "Folder problem",
  folder_ok: "Folder found again",
  already_pending: "Already waiting",
  future_date: "Date in the future",
};

/** Folder activity, opened from the Transactions toolbar: exports waiting for review (Review or
 * Dismiss), and what happened to each recent file with why. "Review again" opens that file's
 * transaction review straight away; nothing is ever imported without the person's confirmation. */
export function FolderActivityDialog({
  state,
  busy,
  onReview,
  onManage,
  onClose,
}: {
  state: FolderImportsState;
  busy: boolean;
  /** Opens the transaction review for this export. */
  onReview: (batch: FolderBatch) => void;
  /** Goes to Settings → Data → Folder imports. */
  onManage: () => void;
  onClose: () => void;
}) {
  const [working, setWorking] = useState(false);
  const [message, setMessage] = useState<string | null>(null);
  // Which collapsed runs of handled files are showing (by their first entry), and whether every recent row is.
  const [openGroups, setOpenGroups] = useState<Set<number>>(new Set());
  const [showAll, setShowAll] = useState(false);
  const stems = (state.data?.mappings ?? []).map((m) => m.stem);
  const pending = state.data?.pending ?? [];
  const disabled = busy || working;
  // A file still waiting is already listed above; its "queued" entry would only repeat it.
  const pendingIds = new Set(pending.map((b) => b.id));
  const recent = state.activity.filter((entry) => !(entry.outcome === "queued" && entry.batch_id !== null && pendingIds.has(entry.batch_id)));

  // Only a file's newest entry offers Review again; older rows stay as history. Counted over every
  // entry, so a hidden "queued" entry or a newer one without the button still hides older buttons.
  const newestEntryIds = new Set<number>();
  const namesSeen = new Set<string>();
  for (const entry of state.activity) {
    if (namesSeen.has(entry.file_name)) continue;
    namesSeen.add(entry.file_name);
    newestEntryIds.add(entry.id);
  }

  async function dismiss(batch: FolderBatch) {
    setWorking(true);
    setMessage(null);
    try {
      await state.client.dismiss(batch.id);
      setMessage(`Dismissed ${batch.file_name}. It won't be queued again; use Review again below if you change your mind.`);
      await state.refresh();
    } catch (e) {
      setMessage(errorMessage(e));
    } finally {
      setWorking(false);
    }
  }

  async function reviewAgain(activityId: number) {
    setWorking(true);
    setMessage(null);
    try {
      const batch = await state.client.reviewAgain(activityId);
      await state.refresh();
      onReview(batch);
    } catch (e) {
      setMessage(errorMessage(e));
    } finally {
      setWorking(false);
    }
  }

  const rows = groupHandled(recent);
  const visibleRows = showAll ? rows : rows.slice(0, RECENT_ROWS_SHOWN);
  const hiddenRows = rows.length - visibleRows.length;
  const shownEntries = visibleRows.reduce((n, row) => n + (row.kind === "handled" ? row.entries.length : 1), 0);

  function renderEntry(entry: FolderActivity) {
    const text = outcomeText(entry.outcome, entry.reason);
    const lead = leadOf(entry.file_name, entry.account_name, stems);
    return (
      <li key={entry.id} className="folder-activity-item" data-folder-activity-entry={entry.outcome}>
        <div className="folder-activity-text">
          <span className="folder-activity-file" title={entry.file_name}>{lead ?? entry.file_name}</span>
          <span className="folder-activity-meta">
            {text.label ? <><strong>{text.label}</strong> — {text.reason}</> : <strong>{text.reason}</strong>}
            {!lead && entry.account_name ? ` · ${entry.account_name}` : ""} · {formatDisplayDate(entry.at.slice(0, 10))}
          </span>
          {entry.copy_cleared && (
            <span className="folder-activity-meta" data-folder-copy-cleared={entry.id}>
              Its saved copy was cleared to save space. To look at it again, import the file with Import transactions.
            </span>
          )}
        </div>
        {entry.can_review_again && newestEntryIds.has(entry.id) && (
          <div className="folder-activity-actions">
            <button
              type="button"
              className="modal-secondary"
              onClick={() => void reviewAgain(entry.id)}
              disabled={disabled}
              data-folder-review-again={entry.id}
              aria-label={`Review again ${entry.file_name}`}
            >
              Review again
            </button>
          </div>
        )}
      </li>
    );
  }

  const footer = (
    <div className="dup-review-actions">
      <button type="button" className="modal-secondary" onClick={onManage} disabled={disabled} data-folder-manage>
        Manage folder imports
      </button>
      <button type="button" onClick={onClose} disabled={working}>
        Close
      </button>
    </div>
  );

  return (
    <ModalShell title="Folder activity" onCancel={onClose} wide footer={footer} panelAttrs={{ "data-folder-activity": true }}>
      <div className="folder-activity">
        {state.data && !state.data.enabled && (
          <p className="modal-message-secondary" data-folder-paused>
            Watching the folder is turned off, so new exports aren't picked up. You can still review what's waiting.
          </p>
        )}
        {state.data?.folder_missing && (
          <div role="alert" className="import-review-notice">
            <p>The watched folder can't be found. If it's on a drive that isn't connected, connect it; otherwise choose the folder again.</p>
            <button type="button" className="modal-secondary" onClick={onManage} disabled={disabled} data-folder-choose-again>
              Choose the folder again
            </button>
          </div>
        )}
        {state.error && <p role="alert" className="import-review-notice">{state.error}</p>}
        {message && <p role="status" className="folder-activity-message">{message}</p>}

        <h3 className="folder-activity-heading">
          {pending.length > 0 ? `Waiting for review (${pending.length})` : "Waiting for review"}
        </h3>
        {pending.length === 0 ? (
          <p className="modal-message-secondary">Nothing is waiting. New exports appear here when they're saved in your folder.</p>
        ) : (
          <ul className="folder-activity-list" data-folder-pending-list>
            {pending.map((batch) => (
              <li key={batch.id} className="folder-activity-item" data-folder-pending={batch.id}>
                <div className="folder-activity-text">
                  <span className="folder-activity-file">{batch.account_name ?? "An account that was removed"} · {exportDates(batch)}</span>
                  <span className="folder-activity-meta folder-activity-filename" title={batch.file_name}>
                    {batch.file_name}
                    {!batch.source_present && " · original file gone, saved copy kept"}
                  </span>
                </div>
                <div className="folder-activity-actions">
                  <button type="button" onClick={() => onReview(batch)} disabled={disabled} data-folder-review={batch.id} aria-label={`Review ${batch.file_name}`}>
                    Review
                  </button>
                  <button type="button" className="modal-secondary" onClick={() => void dismiss(batch)} disabled={disabled} data-folder-dismiss={batch.id} aria-label={`Dismiss ${batch.file_name}`}>
                    Dismiss
                  </button>
                </div>
              </li>
            ))}
          </ul>
        )}

        <h3 className="folder-activity-heading">Recent files</h3>
        {recent.length === 0 ? (
          <p className="modal-message-secondary">No files have been looked at yet. Only files whose names start with one of your export names are picked up.</p>
        ) : (
          <ul className="folder-activity-list" data-folder-activity-list>
            {visibleRows.map((row) => {
              if (row.kind === "handled") {
                const first = row.entries[0].id;
                const open = openGroups.has(first);
                const tally = new Map<string, number>();
                for (const e of row.entries) tally.set(HANDLED_WORD[e.outcome], (tally.get(HANDLED_WORD[e.outcome]) ?? 0) + 1);
                return (
                  <Fragment key={`handled${first}`}>
                    <li className="folder-activity-item" data-folder-handled-group={first}>
                      <div className="folder-activity-text">
                        <span className="folder-activity-file">{row.entries.length} files already dealt with</span>
                        <span className="folder-activity-meta">{[...tally].map(([word, n]) => `${n} ${word}`).join(" · ")}</span>
                      </div>
                      <div className="folder-activity-actions">
                        <button
                          type="button"
                          className="modal-secondary"
                          aria-expanded={open}
                          onClick={() => setOpenGroups((all) => { const next = new Set(all); if (open) next.delete(first); else next.add(first); return next; })}
                          data-folder-handled-toggle
                        >
                          {open ? "Hide" : "Show"}
                        </button>
                      </div>
                    </li>
                    {open && row.entries.map(renderEntry)}
                  </Fragment>
                );
              }
              return renderEntry(row.entry);
            })}
          </ul>
        )}
        {hiddenRows > 0 && (
          <button type="button" className="modal-secondary" onClick={() => setShowAll(true)} data-folder-show-more>
            Show more
          </button>
        )}
        <p className="modal-message-secondary folder-activity-footnote">
          {hiddenRows > 0 ? `Showing the newest ${shownEntries} of ${recent.length} recent entries.` : `${count(recent.length, "recent entry", "recent entries")} shown.`} Your exports stay in your folder untouched; Vault Spend keeps its own copy for review.
        </p>
      </div>
    </ModalShell>
  );
}
