import { invoke } from "@tauri-apps/api/core";

export type UiStateKey =
  | "saved_filters"
  | "safe_to_spend_buffer"
  | "notified_bills"
  | "category_order"
  | "show_bill_names_in_reminders";

/** `set_profile_ui_state`'s staleness guard needs the backend's current generation number — the
 * frontend had no reason to track its own copy of it before this. Fetched once per mount; `App`
 * remounts fresh (a new `key`) whenever the live profile changes, so a stale value here can't
 * outlive the profile it was fetched for. */
export const getCurrentGeneration = () => invoke<number>("get_current_generation");

export const getProfileUiState = (key: UiStateKey) => invoke<string | null>("get_profile_ui_state", { key });

export const setProfileUiState = (key: UiStateKey, value: string, expectedGeneration: number) =>
  invoke<void>("set_profile_ui_state", { key, value, expectedGeneration });

/** The exact global keys these four settings used before this table existed — never read again
 * once `migrateLegacyProfileUiState` has run once on this computer (`device_settings.ui_state_migrated`).
 * `show_bill_names_in_reminders` is not here: it was born in this table, with no earlier
 * localStorage form to migrate from. */
const LEGACY_KEYS: Partial<Record<UiStateKey, string>> = {
  saved_filters: "meadow-saved-ledger-filters", // App.tsx
  safe_to_spend_buffer: "vaultspend-safe-to-spend-buffer", // SafeToSpendCard.tsx
  notified_bills: "vaultspend-notified-bills", // App.tsx
  category_order: "meadow-budget-category-order", // BudgetView.tsx
};

/** Moves any legacy browser-storage values into the currently open profile's database, once per
 * computer. Every database write completes (and is awaited) before the migrated marker is set, and
 * the marker is set before any legacy key is removed — a crash between the writes and the marker
 * simply re-runs this on the next launch (an idempotent overwrite of the same values); a crash
 * between the marker and the removal leaves the old browser keys as harmless, never-read-again
 * orphans rather than re-importing anything twice. Safe to call on every launch. */
export async function migrateLegacyProfileUiState(expectedGeneration: number, alreadyMigrated: boolean): Promise<void> {
  if (alreadyMigrated) return;
  const writes: Promise<void>[] = [];
  for (const [key, legacyKey] of Object.entries(LEGACY_KEYS) as [UiStateKey, string][]) {
    const value = localStorage.getItem(legacyKey);
    if (value !== null) writes.push(setProfileUiState(key, value, expectedGeneration));
  }
  await Promise.all(writes);
  await invoke<void>("mark_ui_state_migrated");
  for (const legacyKey of Object.values(LEGACY_KEYS)) {
    try {
      localStorage.removeItem(legacyKey);
    } catch {
      // best effort — a per-viewer convenience key, not state anything else depends on
    }
  }
}

/** Fetches what `migrateLegacyProfileUiState` needs and runs it — the one call every reader of a
 * migrated key makes before its own read, so it never matters which one happens to run first.
 * Calling this from more than one place at once is safe: `migrateLegacyProfileUiState` is
 * idempotent (a second, concurrent migration just overwrites the same values and re-marks an
 * already-true flag), so there is no need to coordinate between callers. */
export async function ensureUiStateMigrated(): Promise<number> {
  const generation = await getCurrentGeneration();
  const alreadyMigrated = await invoke<boolean>("is_ui_state_migrated");
  await migrateLegacyProfileUiState(generation, alreadyMigrated);
  return generation;
}
