import { invoke } from "@tauri-apps/api/core";
import type { SavedAutoLockSettings } from "./autoLock";
import { errorMessage } from "./errorMessage";
import {
  ProfileIpcError,
  validateAutoLockSettings,
  validateBackgroundSettings,
  validateFlag,
  validateGeneration,
  validateLeftovers,
  validateMessage,
  validateProfileList,
  validateRecoveryDisplay,
  validateRefusedPaths,
  validateSetupChallenge,
  validateStartupState,
  validateStoredText,
  validateVoid,
} from "./profileContracts";

const decoders = {
  get_startup_state: validateStartupState,
  retry_startup: validateStartupState,
  restore_registry_backup: validateStartupState,
  open_profile_at_launch: validateStartupState,
  locate_data_file: validateStartupState,
  start_with_new_data_file: validateStartupState,
  start_with_new_profile_list: validateStartupState,
  quit_app: validateVoid,
  show_profile_selector: validateStartupState,
  select_profile: validateStartupState,
  unlock_profile: validateStartupState,
  lock_current_profile: validateStartupState,
  verify_current_password: validateVoid,
  change_password: validateRecoveryDisplay,
  begin_regenerate_recovery: validateSetupChallenge,
  commit_regenerate_recovery: validateRecoveryDisplay,
  remove_protection: validateVoid,
  verify_recovery_code: validateVoid,
  begin_recovery: validateSetupChallenge,
  commit_recovery: validateRecoveryDisplay,
  begin_protection_setup: validateSetupChallenge,
  cancel_protection_setup: validateVoid,
  commit_protection_setup: validateStartupState,
  list_protection_leftovers: validateLeftovers,
  delete_protection_leftovers: validateRefusedPaths,
  switch_profile: validateMessage,
  add_existing_profile: validateMessage,
  set_profile_icon: validateVoid,
  path_looks_password_protected: validateFlag,
  list_profiles: validateProfileList,
  get_background_settings: validateBackgroundSettings,
  set_tray_enabled: validateVoid,
  set_autostart_enabled: validateVoid,
  create_profile: validateMessage,
  rename_profile: validateVoid,
  delete_profile: validateVoid,
  get_current_generation: validateGeneration,
  get_profile_ui_state: validateStoredText,
  set_profile_ui_state: validateVoid,
  mark_ui_state_migrated: validateVoid,
  is_ui_state_migrated: validateFlag,
  get_auto_lock_settings: validateAutoLockSettings,
  set_auto_lock_settings: validateVoid,
  record_trusted_activity: validateVoid,
};

type Answers = [string, string];
interface Arguments {
  open_profile_at_launch: { id: string };
  locate_data_file: { path: string };
  select_profile: { id: string };
  unlock_profile: { id: string; password: string };
  lock_current_profile: { expectedGeneration: number };
  verify_current_password: { password: string; expectedGeneration: number };
  change_password: { currentPassword: string; token: string; answers: Answers };
  begin_regenerate_recovery: { currentPassword: string; expectedGeneration: number };
  commit_regenerate_recovery: { token: string; answers: Answers };
  remove_protection: { currentPassword: string; expectedGeneration: number };
  verify_recovery_code: { id: string; code: string };
  begin_recovery: { id: string; code: string; newPassword: string; expectedGeneration: number };
  commit_recovery: { id: string; code: string; token: string; answers: Answers };
  begin_protection_setup: { password: string; expectedGeneration: number };
  cancel_protection_setup: { token: string };
  commit_protection_setup: {
    token: string;
    answers: Answers;
    targetProfileId: string | null;
    newProfileName: string | null;
  };
  list_protection_leftovers: { expectedProfileId: string; expectedGeneration: number };
  delete_protection_leftovers: { pathsToDelete: string[]; expectedProfileId: string; expectedGeneration: number };
  switch_profile: { id: string };
  add_existing_profile: { name: string; dbPath: string; password: string | null; expectedGeneration: number };
  set_profile_icon: { id: string; iconKey: string | null };
  path_looks_password_protected: { path: string };
  set_tray_enabled: { enabled: boolean };
  set_autostart_enabled: { enabled: boolean };
  create_profile: { name: string };
  rename_profile: { id: string; newName: string };
  delete_profile: { id: string };
  get_profile_ui_state: { key: string };
  set_profile_ui_state: { key: string; value: string; expectedGeneration: number };
  set_auto_lock_settings: { settings: SavedAutoLockSettings; expectedGeneration: number };
  record_trusted_activity: { expectedGeneration: number };
}

/** One call, one decode. No retries of writes or guesses from native error message wording. */
export async function invokeProfile<C extends keyof typeof decoders>(
  command: C,
  ...args: C extends keyof Arguments ? [args: Arguments[C]] : []
): Promise<ReturnType<(typeof decoders)[C]>> {
  try {
    const raw: unknown = args.length ? await invoke(command, args[0]) : await invoke(command);
    return decoders[command](raw) as ReturnType<(typeof decoders)[C]>;
  } catch (reason) {
    if (reason instanceof ProfileIpcError) throw reason;
    // Existing profile commands still return human-readable strings. Preserve that boundary as
    // legacy_error, not a guessed domain refusal. Structured native identities pass through.
    const code =
      reason &&
      typeof reason === "object" &&
      "code" in reason &&
      typeof reason.code === "string" &&
      /^[a-z][a-z0-9_]*$/.test(reason.code)
        ? reason.code
        : "legacy_error";
    throw new ProfileIpcError(code, errorMessage(reason));
  }
}
