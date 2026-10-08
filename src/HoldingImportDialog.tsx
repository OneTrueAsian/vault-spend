import "./HoldingImportDialog.css";
import { useEffect, useRef, useState } from "react";
import { invoke } from "@tauri-apps/api/core";
import { getCurrentWebview } from "@tauri-apps/api/webview";
import { listen } from "@tauri-apps/api/event";
import type { Account } from "./types";
import { ModalShell } from "./Modal";
import { MenuSelect } from "./MenuSelect";
import { errorMessage } from "./errorMessage";
import { getCurrentGeneration } from "./profileUiState";
import { HOLDING_FIELDS, HOLDING_SAMPLE, addHoldingValues, formatHoldingAmount as formatAmount, mappingFromDraft, suggestHoldingMapping, type HoldingPreview, type HoldingSource, type ImportDirectory } from "./holdingImport";

export function HoldingImportDialog({ accounts, onClose, onSaved }: { accounts: Account[]; onClose: () => void; onSaved: (count: number, account: string) => Promise<void> }) {
  const investmentAccounts = accounts.filter(a => a.account_type === "investment");
  const [account, setAccount] = useState(investmentAccounts.length === 1 ? String(investmentAccounts[0].id) : "");
  const [step, setStep] = useState<"source" | "mapping" | "review" | "done">("source");
  const [inputMode, setInputMode] = useState("file");
  const [path, setPath] = useState("");
  const [content, setContent] = useState("");
  const [format, setFormat] = useState("csv");
  const [source, setSource] = useState<HoldingSource | null>(null);
  const [draft, setDraft] = useState(() => suggestHoldingMapping([]));
  const [preview, setPreview] = useState<HoldingPreview | null>(null);
  const [selected, setSelected] = useState(new Set<number>());
  const [page, setPage] = useState(0);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const [message, setMessage] = useState("");
  const [directory, setDirectory] = useState<ImportDirectory | null>(null);
  const [folder, setFolder] = useState("");
  const [browsing, setBrowsing] = useState(false);
  const [dropOver, setDropOver] = useState(false);
  const [savedCount, setSavedCount] = useState(0);
  const generation = useRef<number | null>(null);
  const sourceId = useRef("");
  const mounted = useRef(true);
  const dropArea = useRef<HTMLDivElement>(null);
  const closeRef = useRef(onClose);
  const busyRef = useRef(false);
  const stepRef = useRef(step);
  closeRef.current = onClose;
  busyRef.current = busy;
  stepRef.current = step;

  useEffect(() => {
    mounted.current = true;
    const cleanups: (() => void)[] = [];
    function subscribe(promise: Promise<() => void>) {
      void promise.then(fn => { if (mounted.current) cleanups.push(fn); else fn(); }).catch(() => { /* Typed path and paste remain available. */ });
    }
    void getCurrentGeneration().then(value => { if (mounted.current) generation.current = value; }).catch(e => { if (mounted.current) setError(errorMessage(e)); });
    subscribe(listen("profile-lock-state-changed", () => closeRef.current()));
    subscribe(getCurrentWebview().onDragDropEvent(event => {
      if (busyRef.current || stepRef.current !== "source") return;
      const payload = event.payload;
      if (payload.type === "leave") { setDropOver(false); return; }
      const bounds = dropArea.current?.getBoundingClientRect();
      if (!bounds) return;
      const x = payload.position.x / window.devicePixelRatio, y = payload.position.y / window.devicePixelRatio;
      const inside = x >= bounds.left && x <= bounds.right && y >= bounds.top && y <= bounds.bottom;
      setDropOver(inside && payload.type !== "drop");
      if (inside && payload.type === "drop") {
        if (payload.paths.length !== 1 || !/\.csv$/i.test(payload.paths[0])) { setError("Drop one CSV file, not a folder or another file type."); return; }
        setInputMode("file"); setPath(payload.paths[0]); setFormat("csv"); setError("");
      }
    }));
    return () => {
      mounted.current = false;
      cleanups.forEach(fn => fn());
      if (sourceId.current) void invoke("cancel_holding_import", { id: sourceId.current }).catch(() => {});
    };
  }, []);

  async function run(action: () => Promise<void>) {
    if (busyRef.current) return;
    busyRef.current = true; setBusy(true); setError(""); setMessage("");
    try { await action(); } catch (e) { if (mounted.current) setError(errorMessage(e)); }
    finally { busyRef.current = false; if (mounted.current) setBusy(false); }
  }

  async function load() {
    await run(async () => {
      if (generation.current === null) throw new Error("The profile is still loading. Try again in a moment.");
      if (sourceId.current) await invoke("cancel_holding_import", { id: sourceId.current });
      sourceId.current = "";
      const result = await invoke<HoldingSource>("load_holding_import", { path: inputMode === "file" ? path.trim() : null, content: inputMode === "paste" ? content : null, format, generation: generation.current });
      if (!mounted.current) { await invoke("cancel_holding_import", { id: result.id }); return; }
      sourceId.current = result.id; setSource(result); setDraft(suggestHoldingMapping(result.headers)); setPreview(null); setBrowsing(false); setStep("mapping");
    });
  }

  async function review() {
    await run(async () => {
      const mapping = mappingFromDraft(draft);
      if (!source || !mapping) throw new Error("Choose a different source column for every required field.");
      const result = await invoke<HoldingPreview>("preview_holding_import", { id: source.id, accountId: Number(account), mapping, generation: generation.current });
      if (!mounted.current) return;
      setPreview(result); setSelected(new Set(result.rows.filter(row => row.holding && !row.error && !row.repeated && !row.already_exists).map(row => row.row_number))); setPage(0); setStep("review");
    });
  }

  async function save() {
    await run(async () => {
      if (!source || !preview) return;
      const count = await invoke<number>("commit_holding_import", { id: source.id, selectedRows: Array.from(selected), generation: generation.current });
      sourceId.current = "";
      if (mounted.current) { setSavedCount(count); setStep("done"); }
      await onSaved(count, preview.account_name);
    });
  }

  async function openFolder(value?: string) {
    await run(async () => {
      const result = await invoke<ImportDirectory>("list_holding_import_files", { path: value ?? null });
      if (mounted.current) { setDirectory(result); setFolder(result.path); setBrowsing(true); }
    });
  }

  const chosen = preview?.rows.filter(row => selected.has(row.row_number)) ?? [];
  const total = addHoldingValues(chosen.map(row => row.value ?? "0"));
  const after = addHoldingValues([preview?.holdings_value ?? "0", total]);
  const mappingValid = mappingFromDraft(draft) !== null;
  const pages = Math.ceil((preview?.rows.length ?? 0) / 50);
  const validRows = preview?.rows.filter(row => row.holding && !row.error && !row.already_exists) ?? [];

  return <ModalShell title="Import holdings" onCancel={() => { if (!busyRef.current) onClose(); }} wide dismissOnOverlayClick={false}
    footer={<div className="modal-actions holding-import-actions">
      <button type="button" className="modal-secondary" disabled={busy} onClick={onClose}>{step === "done" ? "Done" : "Cancel"}</button>
      {step === "mapping" && <button type="button" className="modal-secondary" disabled={busy} onClick={() => { setStep("source"); setError(""); }}>Back</button>}
      {step === "review" && <button type="button" className="modal-secondary" disabled={busy} onClick={() => { setStep("mapping"); setError(""); }}>Back</button>}
      {step === "source" && <button type="button" disabled={busy || !account || (inputMode === "file" ? !path.trim() : !content.trim())} onClick={() => void load()}>{busy ? "Reading rows…" : "Match columns"}</button>}
      {step === "mapping" && <button type="button" disabled={busy || !mappingValid || !account} onClick={() => void review()}>{busy ? "Checking rows…" : "Review holdings"}</button>}
      {step === "review" && <button type="button" disabled={busy || selected.size === 0} onClick={() => void save()} data-add-imported-holdings>{busy ? "Adding holdings…" : `Add ${selected.size} holdings`}</button>}
    </div>}>
    <div className="holding-import" data-holding-import>
      {error && <p role="alert" className="field-error holding-import-error">{error}</p>}
      {message && <p role="status" className="field-hint">{message}</p>}
      {step !== "done" && <p className="modal-message-secondary">{step === "source" ? "1. Choose an account and load rows" : step === "mapping" ? "2. Match your columns" : "3. Review before adding"}</p>}
      {step !== "done" && <label className="modal-field"><span>Investment account</span><MenuSelect ariaLabel="Import account" value={account} onChange={value => { setAccount(value); setPreview(null); if (step === "review") setStep("mapping"); }} disabled={busy} fill placeholder="Choose an investment account" options={investmentAccounts.map(a => ({ value: String(a.id), label: a.name }))} /></label>}
      {investmentAccounts.length === 0 && <p className="field-hint">Create an investment account on Accounts before importing holdings.</p>}
      {step === "source" && <>
        <p className="modal-message">Add the positions you own today. Existing holdings stay unchanged. Use CSV or paste rows with headings from a spreadsheet.</p>
        <div className="holding-import-source-actions"><button type="button" className="modal-secondary" disabled={busy} aria-pressed={inputMode === "file"} onClick={() => setInputMode("file")}>CSV file</button><button type="button" className="modal-secondary" disabled={busy} aria-pressed={inputMode === "paste"} onClick={() => { setInputMode("paste"); setBrowsing(false); }}>Paste rows</button><button type="button" className="modal-secondary" disabled={busy} onClick={() => void run(async () => { await navigator.clipboard.writeText(HOLDING_SAMPLE); setMessage("Sample CSV copied. Replace the examples with your own holdings."); })}>Copy sample CSV</button></div>
        {inputMode === "file" ? <div ref={dropArea} className={`holding-import-drop${dropOver ? " is-over" : ""}`}>
          <p className="field-hint">Drop one CSV file here, browse in the app, or enter its full path.</p>
          <label className="modal-field"><span>CSV file path</span><input value={path} disabled={busy} onChange={e => setPath(e.target.value)} placeholder="Full path to your CSV file" /></label>
          <button type="button" className="modal-secondary" disabled={busy} onClick={() => void openFolder()}>Browse files…</button>
        </div> : <label className="modal-field"><span>Rows, including column headings</span><textarea value={content} disabled={busy} onChange={e => { setContent(e.target.value); if (e.target.value.split(/\r?\n/)[0]?.includes("\t")) setFormat("tsv"); }} placeholder={HOLDING_SAMPLE} rows={8} spellCheck={false} /></label>}
        {browsing && <div className="holding-import-browser" data-holding-file-browser>
          <div className="holding-import-folder-actions"><button type="button" className="modal-secondary" disabled={busy || !directory?.parent} onClick={() => void openFolder(directory?.parent ?? undefined)}>Up one folder</button><button type="button" className="modal-secondary" disabled={busy} onClick={() => void openFolder()}>Home folder</button><button type="button" className="modal-secondary" disabled={busy} onClick={() => setBrowsing(false)}>Close file browser</button></div>
          <form onSubmit={e => { e.preventDefault(); void openFolder(folder); }} className="holding-import-folder-path"><label className="modal-field"><span>Folder path</span><input value={folder} disabled={busy} onChange={e => setFolder(e.target.value)} /></label><button type="submit" disabled={busy}>Open folder</button></form>
          <ul className="holding-import-files" aria-label="Folders and CSV files">{directory?.entries.map(entry => <li key={entry.path}><button type="button" disabled={busy} className="modal-secondary" onClick={() => { if (entry.directory) void openFolder(entry.path); else { setPath(entry.path); setFormat("csv"); setBrowsing(false); } }}><span className="holding-import-file-kind">{entry.directory ? "Folder" : "CSV"}</span><span>{entry.name}</span></button></li>)}</ul>
          {directory?.entries.length === 0 && <p className="field-hint">No CSV files or subfolders in this folder.</p>}
        </div>}
        <label className="modal-field"><span>Column separator</span><MenuSelect ariaLabel="Column separator" value={format} onChange={setFormat} disabled={busy} options={[{ value: "csv", label: "Commas (CSV)" }, { value: "tsv", label: "Tabs (spreadsheet rows)" }]} /></label>
        <p className="field-hint">Include a symbol, shares, current price per share, and the total you paid. Unknown costs cannot be treated as zero. Import up to 5,000 rows and 5 MB at a time.</p>
      </>}
      {step === "mapping" && source && <>
        <p className="modal-message">{source.row_count} rows found. Choose a different column for each field. “What you paid” is the total for all shares, not the cost per share.</p>
        <div className="holding-import-mappings">{HOLDING_FIELDS.map(field => <label key={field.key} className="modal-field"><span>{field.label}</span><MenuSelect ariaLabel={field.label} fill disabled={busy} value={draft[field.key]} onChange={value => setDraft(old => ({ ...old, [field.key]: value }))} options={[{ value: "", label: field.key === "name" || field.key === "asset_class" ? "Not included" : "Choose a column" }, ...source.headers.map((label, index) => ({ value: String(index), label: `${label || "Unnamed"} (column ${index + 1})` }))]} /></label>)}</div>
        {!mappingValid && <p className="field-hint">Map every required field once. Optional fields can be left out.</p>}
        <details><summary>First rows from your source</summary><div className="modal-table-scroll"><table className="ledger"><thead><tr>{source.headers.map((label, i) => <th key={i}>{label || `Column ${i + 1}`}</th>)}</tr></thead><tbody>{source.samples.map((row, i) => <tr key={i}>{row.map((cell, j) => <td key={j}>{cell}</td>)}</tr>)}</tbody></table></div></details>
      </>}
      {step === "review" && preview && <>
        <p className="modal-message" role="status">{selected.size} selected of {preview.rows.length} rows · {formatAmount(total)} to add.</p>
        <p className="field-hint">Account value now: {formatAmount(preview.current_value)}. After adding selected holdings: {formatAmount(after)}.</p>
        {!preview.has_holdings && <p className="holding-import-warning">After adding holdings, this account's value comes from their combined value. Include all current positions if you want it to match your statement.</p>}
        <p className="field-hint">Rows already in this account are excluded. For a repeated symbol in this file, choose at most one row or combine its positions in your spreadsheet. File prices are used; live prices may update them later.</p>
        <div className="holding-import-source-actions"><button type="button" className="modal-secondary" disabled={busy} onClick={() => setSelected(new Set(validRows.filter(row => !row.repeated).map(row => row.row_number)))}>Select all new, unique rows</button><button type="button" className="modal-secondary" disabled={busy} onClick={() => setSelected(new Set())}>Clear selection</button></div>
        <div className="modal-table-scroll holding-import-review"><table className="ledger"><colgroup><col className="holding-col-check"/><col className="holding-col-row"/><col className="holding-col-symbol"/><col/><col/><col/><col className="holding-col-status"/></colgroup><thead><tr><th>Include</th><th>Row</th><th>Holding</th><th className="amount-col">Shares</th><th className="amount-col">Price</th><th className="amount-col">Total paid</th><th>Status</th></tr></thead><tbody>{preview.rows.slice(page * 50, (page + 1) * 50).map(row => {
          const another = row.holding && chosen.some(other => other.row_number !== row.row_number && other.holding?.symbol === row.holding?.symbol);
          return <tr key={row.row_number} data-holding-import-row={row.row_number}><td><input type="checkbox" aria-label={`Include row ${row.row_number}`} checked={selected.has(row.row_number)} disabled={busy || !!row.error || row.already_exists || !!another} onChange={() => setSelected(old => { const next = new Set(old); if (next.has(row.row_number)) next.delete(row.row_number); else next.add(row.row_number); return next; })} /></td><td>{row.row_number}</td><td><strong>{row.holding?.symbol ?? "—"}</strong><span className="holding-import-name">{row.holding?.name}</span></td><td className="amount-col">{row.holding?.shares ?? "—"}</td><td className="amount-col">{row.holding ? formatAmount(row.holding.price) : "—"}</td><td className="amount-col">{row.holding ? formatAmount(row.holding.cost_basis) : "—"}</td><td className={row.error ? "field-error" : ""}>{row.error ?? (row.already_exists ? "Already in this account" : row.repeated ? "Repeated symbol — choose one" : "Ready to add")}</td></tr>;
        })}</tbody></table></div>
        {pages > 1 && <div className="holding-import-pages"><button type="button" className="modal-secondary" disabled={busy || page === 0} onClick={() => setPage(p => p - 1)}>Previous rows</button><span>Page {page + 1} of {pages}</span><button type="button" className="modal-secondary" disabled={busy || page === pages - 1} onClick={() => setPage(p => p + 1)}>Next rows</button></div>}
      </>}
      {step === "done" && <p className="modal-message" role="status">Added {savedCount} holdings to {preview?.account_name}. Your holdings are saved.</p>}
    </div>
  </ModalShell>;
}
