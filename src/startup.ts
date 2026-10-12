import { invokeProfile } from "./profileIpc";

export type LaunchErrorKind =
  | "registry_unreadable"
  | "location_unreadable"
  | "data_file_missing"
  | "data_file_unreadable"
  | "protection_journal_unreadable"
  // Made here, not by the backend: it could not even be asked how startup went.
  | "startup_failed";

export interface LaunchProfile {
  id: string;
  name: string;
}

export interface LaunchError {
  kind: LaunchErrorKind;
  /** A plain sentence for the person. */
  message: string;
  /** The technical reason, kept behind a disclosure. */
  details: string;
  db_path: string | null;
  can_restore_registry: boolean;
  other_profiles: LaunchProfile[];
}

export interface SelectorEntry {
  id: string;
  name: string;
  icon_key: string | null;
  is_password_protected: boolean;
}

export type StartupState =
  | { status: "open" }
  | { status: "selector"; profiles: SelectorEntry[]; last_used_id: string | null }
  | { status: "locked"; profile_id: string; profile_name: string }
  | { status: "empty_registry" }
  | { status: "error"; error: LaunchError };

export const getStartupState = () => invokeProfile("get_startup_state");
export const retryStartup = () => invokeProfile("retry_startup");
export const restoreRegistryBackup = () => invokeProfile("restore_registry_backup");
export const openProfileAtLaunch = (id: string) => invokeProfile("open_profile_at_launch", { id });
export const locateDataFile = (path: string) => invokeProfile("locate_data_file", { path });
export const quitApp = () => invokeProfile("quit_app");
export const startWithNewDataFile = () => invokeProfile("start_with_new_data_file");
export const startWithNewProfileList = () => invokeProfile("start_with_new_profile_list");

export function startupFailure(reason: unknown): LaunchError {
  return {
    kind: "startup_failed",
    message: "Vault Spend couldn't find out whether your data could be opened.",
    details: String(reason),
    db_path: null,
    can_restore_registry: false,
    other_profiles: [],
  };
}
