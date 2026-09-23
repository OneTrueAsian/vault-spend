import { invoke } from "@tauri-apps/api/core";
import type { StartupState } from "./startup";

export const showProfileSelector = () => invoke<StartupState>("show_profile_selector");
export const selectProfile = (id: string) => invoke<StartupState>("select_profile", { id });
export const unlockProfile = (id: string, password: string) => invoke<StartupState>("unlock_profile", { id, password });
export const lockCurrentProfile = (expectedGeneration: number) =>
  invoke<StartupState>("lock_current_profile", { expectedGeneration });
export const verifyCurrentPassword = (password: string, expectedGeneration: number) =>
  invoke<void>("verify_current_password", { password, expectedGeneration });
export const changePassword = (currentPassword: string, token: string, answers: [string, string]) =>
  invoke<string>("change_password", { currentPassword, token, answers });
export const beginRegenerateRecovery = (currentPassword: string, expectedGeneration: number) =>
  invoke<SetupChallenge>("begin_regenerate_recovery", { currentPassword, expectedGeneration });
export const commitRegenerateRecovery = (token: string, answers: [string, string]) =>
  invoke<string>("commit_regenerate_recovery", { token, answers });

export interface SetupChallenge {
  token: string;
  recovery_display: string;
  challenge_group_indices: [number, number];
}

export const beginProtectionSetup = (password: string, expectedGeneration: number) =>
  invoke<SetupChallenge>("begin_protection_setup", { password, expectedGeneration });
export const cancelProtectionSetup = (token: string) => invoke<void>("cancel_protection_setup", { token });
export const commitProtectionSetup = (
  token: string,
  answers: [string, string],
  targetProfileId: string | null,
  newProfileName: string | null,
) => invoke<StartupState>("commit_protection_setup", { token, answers, targetProfileId, newProfileName });

export type LeftoverKind = "original_database" | "plaintext_backup" | "mirrored_plaintext_backup";

export interface LeftoverEntry {
  path: string;
  kind: LeftoverKind;
  size_bytes: number;
}

export const listProtectionLeftovers = () => invoke<LeftoverEntry[]>("list_protection_leftovers");
/** Returns whichever of `pathsToDelete` could NOT be deleted (a directory, the live database, or a
 * path that no longer exists) — never rejects just because some of them were refused. */
export const deleteProtectionLeftovers = (pathsToDelete: string[]) =>
  invoke<string[]>("delete_protection_leftovers", { pathsToDelete });
