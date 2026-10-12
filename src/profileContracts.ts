import { array, boolean, integer, nullable, object, string } from "./contractChecks";
import type { AutoLockSettings } from "./autoLock";
import type { LeftoverEntry, SetupChallenge } from "./protection";
import type { StartupState } from "./startup";

/** Machine identity is separate from display wording. Never include a rejected payload or secrets. */
export class ProfileIpcError extends Error {
  constructor(
    readonly code: string,
    message: string,
  ) {
    super(message);
    this.name = "ProfileIpcError";
  }
}

function invalid(): never {
  throw new ProfileIpcError("invalid_response", "Vault Spend received an invalid profile response. Try again.");
}

const nonempty = (value: unknown) => typeof value === "string" && value.trim().length > 0;
const launchProfile = object({ id: nonempty, name: nonempty });
const selectorEntry = object({
  id: nonempty,
  name: nonempty,
  icon_key: nullable(string),
  is_password_protected: boolean,
});
const errorKinds = new Set([
  "registry_unreadable",
  "location_unreadable",
  "data_file_missing",
  "data_file_unreadable",
  "protection_journal_unreadable",
  "startup_failed",
]);
const launchError = object({
  kind: (value) => typeof value === "string" && errorKinds.has(value),
  message: nonempty,
  details: string,
  db_path: nullable(string),
  can_restore_registry: boolean,
  other_profiles: array(launchProfile),
});

/** Existing status-tagged wire contract; additive fields are compatible, unknown variants are not. */
export function validateStartupState(value: unknown): StartupState {
  if (!value || typeof value !== "object" || Array.isArray(value)) return invalid();
  const state = value as Record<string, unknown>;
  switch (state.status) {
    case "open":
    case "empty_registry":
      break;
    case "locked":
      if (!object({ profile_id: nonempty, profile_name: nonempty })(state)) return invalid();
      break;
    case "selector": {
      if (!object({ profiles: array(selectorEntry), last_used_id: nullable(nonempty) })(state)) return invalid();
      const profiles = state.profiles as { id: string }[];
      if (new Set(profiles.map((profile) => profile.id)).size !== profiles.length) return invalid();
      break;
    }
    case "error":
      if (!launchError(state.error)) return invalid();
      break;
    default:
      return invalid();
  }
  return value as StartupState;
}

/** Display shape only; key checksum/authorization and proof verification remain backend-owned. */
export function validateRecoveryDisplay(value: unknown): string {
  if (typeof value !== "string" || !/^[0-9A-HJKMNP-TV-Z]{4}(?:-[0-9A-HJKMNP-TV-Z]{4}){6}$/.test(value))
    return invalid();
  return value;
}

export function validateSetupChallenge(value: unknown): SetupChallenge {
  if (!object({ token: nonempty, recovery_display: string, challenge_group_indices: array(integer) })(value))
    return invalid();
  const challenge = value as SetupChallenge;
  validateRecoveryDisplay(challenge.recovery_display);
  const indices = challenge.challenge_group_indices;
  if (indices.length !== 2 || indices.some((index) => index > 6) || indices[0] === indices[1]) return invalid();
  return challenge;
}

const leftover = object({
  path: nonempty,
  kind: (value) =>
    value === "original_database" || value === "plaintext_backup" || value === "mirrored_plaintext_backup",
  size_bytes: integer,
});
export function validateLeftovers(value: unknown): LeftoverEntry[] {
  if (!array(leftover)(value)) return invalid();
  return value as LeftoverEntry[];
}
export function validateRefusedPaths(value: unknown): string[] {
  if (!array(nonempty)(value)) return invalid();
  return value as string[];
}
export function validateVoid(value: unknown): void {
  // Tauri serializes unit as null; undefined also supports the bridge's void/mocked return.
  if (value !== null && value !== undefined) return invalid();
}

/** A short confirmation sentence the backend returns after creating a profile. */
export function validateMessage(value: unknown): string {
  if (!nonempty(value)) return invalid();
  return value as string;
}
export function validateGeneration(value: unknown): number {
  if (!integer(value)) return invalid();
  return value as number;
}
export function validateStoredText(value: unknown): string | null {
  if (!nullable(string)(value)) return invalid();
  return value as string | null;
}
export function validateFlag(value: unknown): boolean {
  if (typeof value !== "boolean") return invalid();
  return value;
}

const autoLockSettings = object({
  inactivity_minutes: (value) => value === 0 || value === 1 || value === 5 || value === 15 || value === 30 || value === 60,
  lock_when_hidden: boolean,
  lock_on_focus_loss: boolean,
  lock_on_system_event: boolean,
  system_event_supported: boolean,
});
export function validateAutoLockSettings(value: unknown): AutoLockSettings {
  if (!autoLockSettings(value)) return invalid();
  return value as AutoLockSettings;
}
