import { invokeProfile } from "./profileIpc";

export const showProfileSelector = () => invokeProfile("show_profile_selector");
export const selectProfile = (id: string) => invokeProfile("select_profile", { id });
export const unlockProfile = (id: string, password: string) => invokeProfile("unlock_profile", { id, password });
export const lockCurrentProfile = (expectedGeneration: number) =>
  invokeProfile("lock_current_profile", { expectedGeneration });
export const verifyCurrentPassword = (password: string, expectedGeneration: number) =>
  invokeProfile("verify_current_password", { password, expectedGeneration });
export const changePassword = (currentPassword: string, token: string, answers: [string, string]) =>
  invokeProfile("change_password", { currentPassword, token, answers });
export const beginRegenerateRecovery = (currentPassword: string, expectedGeneration: number) =>
  invokeProfile("begin_regenerate_recovery", { currentPassword, expectedGeneration });
export const commitRegenerateRecovery = (token: string, answers: [string, string]) =>
  invokeProfile("commit_regenerate_recovery", { token, answers });
export const removeProtection = (currentPassword: string, expectedGeneration: number) =>
  invokeProfile("remove_protection", { currentPassword, expectedGeneration });
export const verifyRecoveryCode = (id: string, code: string) => invokeProfile("verify_recovery_code", { id, code });
export const beginRecovery = (id: string, code: string, newPassword: string, expectedGeneration: number) =>
  invokeProfile("begin_recovery", { id, code, newPassword, expectedGeneration });
export const commitRecovery = (id: string, code: string, token: string, answers: [string, string]) =>
  invokeProfile("commit_recovery", { id, code, token, answers });

export interface SetupChallenge {
  token: string;
  recovery_display: string;
  challenge_group_indices: [number, number];
}

export const beginProtectionSetup = (password: string, expectedGeneration: number) =>
  invokeProfile("begin_protection_setup", { password, expectedGeneration });
export const cancelProtectionSetup = (token: string) => invokeProfile("cancel_protection_setup", { token });
export const commitProtectionSetup = (
  token: string,
  answers: [string, string],
  targetProfileId: string | null,
  newProfileName: string | null,
) => invokeProfile("commit_protection_setup", { token, answers, targetProfileId, newProfileName });

export type LeftoverKind = "original_database" | "plaintext_backup" | "mirrored_plaintext_backup";

export interface LeftoverEntry {
  path: string;
  kind: LeftoverKind;
  size_bytes: number;
}

export const listProtectionLeftovers = (expectedProfileId: string, expectedGeneration: number) =>
  invokeProfile("list_protection_leftovers", { expectedProfileId, expectedGeneration });
/** Returns whichever of `pathsToDelete` could NOT be deleted (a directory, the live database, or a
 * path that no longer exists) — never rejects just because some of them were refused. */
export const deleteProtectionLeftovers = (
  pathsToDelete: string[],
  expectedProfileId: string,
  expectedGeneration: number,
) => invokeProfile("delete_protection_leftovers", { pathsToDelete, expectedProfileId, expectedGeneration });
