/** The watched-folder import commands (VS-102) and the replies the page relies on. Replies are
 * checked before use: a malformed one is refused rather than shown. Mirrors
 * src-tauri/src/commands/folder_imports.rs. */

export type FolderMapping = {
  id: number;
  account_id: number;
  account_name: string | null;
  account_usable: boolean;
  stem: string;
  extensions: string[];
  invert_amounts: boolean;
  initial_cutoff: string | null;
  watermark: string | null;
};

export type FolderBatch = {
  id: number;
  file_name: string;
  account_id: number;
  account_name: string | null;
  export_start: string;
  export_end: string;
  detected_at: string;
  status: "pending" | "imported" | "dismissed";
  row_version: number;
  source_present: boolean;
  invert_amounts: boolean;
};

export type FolderImports = {
  enabled: boolean;
  folder: string | null;
  folder_missing: boolean;
  mappings: FolderMapping[];
  pending: FolderBatch[];
  /** The newest activity entry already seen in Folder activity. */
  seen_activity_id: number;
};

export type FolderActivity = {
  id: number;
  at: string;
  file_name: string;
  account_name: string | null;
  outcome: string;
  reason: string;
  batch_id: number | null;
  can_review_again: boolean;
  /** A finished export whose saved copy was cleared to save space, so it can't be reviewed again from here. */
  copy_cleared: boolean;
};

export type FolderMatch = {
  file_name: string;
  account_name: string | null;
  outcome: "would_queue" | "older" | "bad_name" | "future_date" | "needs_account" | "no_match";
  reason: string;
};

export type FolderMappingInput = {
  id: number | null;
  account_id: number;
  stem: string;
  extensions: string[];
  invert_amounts: boolean;
  initial_cutoff: string | null;
};

/** Sent by the native discovery thread whenever it saved or noted something. */
export const FOLDER_IMPORTS_CHANGED = "folder-imports-changed";

/** Outcomes that mean "a file was looked at and deliberately not queued". */
export const SKIPPED_OUTCOMES = new Set(["older", "bad_name", "future_date", "already_pending", "needs_account", "too_large", "unreadable", "already_imported", "already_dismissed", "queue_full", "folder_problem"]);

type Call = <T>(command: string, args?: Record<string, unknown>) => Promise<T>;

const isObject = (v: unknown): v is Record<string, unknown> => typeof v === "object" && v !== null && !Array.isArray(v);
const isText = (v: unknown): v is string => typeof v === "string";
const isTextOrNull = (v: unknown) => v === null || isText(v);
const isId = (v: unknown) => Number.isSafeInteger(v) && (v as number) > 0;
const isIsoDate = (v: unknown) => isText(v) && /^\d{4}-\d{2}-\d{2}$/.test(v);

function isBatch(v: unknown): v is FolderBatch {
  return (
    isObject(v) &&
    isId(v.id) &&
    isText(v.file_name) &&
    isId(v.account_id) &&
    isTextOrNull(v.account_name) &&
    isIsoDate(v.export_start) &&
    isIsoDate(v.export_end) &&
    isText(v.detected_at) &&
    (v.status === "pending" || v.status === "imported" || v.status === "dismissed") &&
    Number.isSafeInteger(v.row_version) &&
    typeof v.source_present === "boolean" &&
    typeof v.invert_amounts === "boolean"
  );
}

function isMapping(v: unknown): v is FolderMapping {
  return (
    isObject(v) &&
    isId(v.id) &&
    isId(v.account_id) &&
    isTextOrNull(v.account_name) &&
    typeof v.account_usable === "boolean" &&
    isText(v.stem) &&
    Array.isArray(v.extensions) &&
    v.extensions.every(isText) &&
    typeof v.invert_amounts === "boolean" &&
    (v.initial_cutoff === null || isIsoDate(v.initial_cutoff)) &&
    (v.watermark === null || isIsoDate(v.watermark))
  );
}

export function isFolderImports(v: unknown): v is FolderImports {
  return (
    isObject(v) &&
    typeof v.enabled === "boolean" &&
    isTextOrNull(v.folder) &&
    typeof v.folder_missing === "boolean" &&
    Array.isArray(v.mappings) &&
    v.mappings.every(isMapping) &&
    Array.isArray(v.pending) &&
    v.pending.every(isBatch) &&
    Number.isSafeInteger(v.seen_activity_id)
  );
}

export function isFolderActivity(v: unknown): v is FolderActivity {
  return (
    isObject(v) &&
    isId(v.id) &&
    isText(v.at) &&
    isText(v.file_name) &&
    isTextOrNull(v.account_name) &&
    isText(v.outcome) &&
    isText(v.reason) &&
    (v.batch_id === null || isId(v.batch_id)) &&
    typeof v.can_review_again === "boolean" &&
    typeof v.copy_cleared === "boolean"
  );
}

function checked<T>(value: unknown, valid: (v: unknown) => boolean, what: string): T {
  if (!valid(value)) throw new Error(`Vault Spend got an unexpected reply while reading ${what}. Try again.`);
  return value as T;
}

export function folderImportsClient(call: Call) {
  return {
    get: async () => checked<FolderImports>(await call("get_folder_imports"), isFolderImports, "folder imports"),
    activity: async () =>
      checked<FolderActivity[]>(await call("list_folder_import_activity"), (v) => Array.isArray(v) && v.every(isFolderActivity), "folder activity"),
    scanNow: () => call<void>("scan_folder_imports_now"),
    setEnabled: (enabled: boolean) => call<void>("set_folder_imports_enabled", { enabled }),
    setFolder: (dir: string | null) => call<string | null>("set_folder_import_folder", { dir }),
    saveMapping: (mapping: FolderMappingInput) => call<number>("save_folder_import_mapping", { mapping }),
    deleteMapping: (id: number) => call<void>("delete_folder_import_mapping", { id }),
    clearWatermark: (id: number) => call<void>("clear_folder_import_watermark", { id }),
    markSeen: (through: number) => call<void>("mark_folder_activity_seen", { through }),
    testNames: () => call<FolderMatch[]>("test_folder_import_names"),
    dismiss: (batchId: number) => call<void>("dismiss_folder_import", { batchId }),
    reviewAgain: async (activityId: number) =>
      checked<FolderBatch>(await call("review_folder_import_again", { activityId }), isBatch, "the export"),
  };
}

export type FolderImportsClient = ReturnType<typeof folderImportsClient>;
