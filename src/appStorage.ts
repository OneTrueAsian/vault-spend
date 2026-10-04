/** Per-viewer preferences the app shell keeps: browser storage (sidebar order, row density, last account)
 * and the profile's saved Transactions filters. */

import { getCurrentGeneration, getProfileUiState, setProfileUiState } from "./profileUiState";
import { NAV_ITEMS, type SavedLedgerFilter, type Tab } from "./appTypes";

export const NAV_ORDER_STORAGE_KEY = "meadow-nav-order";
// Per-viewer, like the theme: how tall Transactions rows are. Compact is the
// default — the comfortable layout stacked the tag box and Split button under
// their cells and made every row ~75px tall.
export const LEDGER_DENSITY_STORAGE_KEY = "vaultspend-ledger-density";
export type LedgerDensity = "comfortable" | "compact";
export function loadLedgerDensity(): LedgerDensity {
  try {
    return localStorage.getItem(LEDGER_DENSITY_STORAGE_KEY) === "comfortable" ? "comfortable" : "compact";
  } catch {
    return "compact"; // private window, blocked site data, etc. — just use the default
  }
}
// Which account a fresh import/manual transaction defaults to. Without
// this, the default falls back to whichever account sorts first
// alphabetically (list_accounts orders by name) — for most households
// that's not their everyday checking account, so a CSV import or quick
// add could silently land in the wrong place. Global rather than
// per-profile, same as theme/nav-order above; a stale id from another
// profile (or a deleted account) is harmless since callers only ever use
// this as a first guess and fall back to accounts[0] when it doesn't
// match a real, current account.
export const LAST_USED_ACCOUNT_STORAGE_KEY = "vaultspend-last-used-account-id";
export function getLastUsedAccountId(): number | null {
  try {
    const raw = localStorage.getItem(LAST_USED_ACCOUNT_STORAGE_KEY);
    return raw ? Number(raw) : null;
  } catch {
    return null; // private window, blocked site data, etc. — just skip the preference
  }
}
export function setLastUsedAccountId(id: number) {
  try {
    localStorage.setItem(LAST_USED_ACCOUNT_STORAGE_KEY, String(id));
  } catch {
    // best effort, same as every other localStorage write in this file
  }
}

export async function loadSavedFilters(): Promise<SavedLedgerFilter[]> {
  try {
    const stored = await getProfileUiState("saved_filters");
    if (stored) {
      const parsed: unknown = JSON.parse(stored);
      if (Array.isArray(parsed)) return parsed as SavedLedgerFilter[];
    }
  } catch {
    // corrupt/unavailable value — fall back to no saved filters
  }
  return [];
}

export async function saveSavedFilters(filters: SavedLedgerFilter[]) {
  try {
    const generation = await getCurrentGeneration();
    await setProfileUiState("saved_filters", JSON.stringify(filters), generation);
  } catch {
    // per-viewer preference only — fine to skip if the save fails
  }
}

/** Reads the sidebar's saved custom order — a per-viewer UI preference,
 * same as theme, so it lives in localStorage rather than the database.
 * Unknown ids (an old order from a build with different tabs) are
 * dropped; any tab missing from a stored order (a new tab shipped since
 * the user last reordered) is appended at the end rather than hidden. */
export function loadNavOrder(): Tab[] {
  const known = NAV_ITEMS.map((item) => item.id);
  try {
    const stored = localStorage.getItem(NAV_ORDER_STORAGE_KEY);
    if (stored) {
      const parsed: unknown = JSON.parse(stored);
      if (Array.isArray(parsed)) {
        const filtered = parsed.filter((id): id is Tab => known.includes(id as Tab));
        const missing = known.filter((id) => !filtered.includes(id));
        return [...filtered, ...missing];
      }
    }
  } catch {
    // corrupt/unavailable storage — fall back to the default order
  }
  return known;
}
