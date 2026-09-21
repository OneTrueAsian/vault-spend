import { invoke } from "@tauri-apps/api/core";

export type LaunchErrorKind =
  | "registry_unreadable"
  | "location_unreadable"
  | "data_file_missing"
  | "data_file_unreadable"
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

export type StartupState = { status: "open" } | { status: "error"; error: LaunchError };

export const getStartupState = () => invoke<StartupState>("get_startup_state");
export const retryStartup = () => invoke<StartupState>("retry_startup");
export const restoreRegistryBackup = () => invoke<StartupState>("restore_registry_backup");
export const openProfileAtLaunch = (id: string) => invoke<StartupState>("open_profile_at_launch", { id });
export const locateDataFile = (path: string) => invoke<StartupState>("locate_data_file", { path });
export const quitApp = () => invoke<void>("quit_app");
export const startWithNewDataFile = () => invoke<StartupState>("start_with_new_data_file");
export const startWithNewProfileList = () => invoke<StartupState>("start_with_new_profile_list");

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
