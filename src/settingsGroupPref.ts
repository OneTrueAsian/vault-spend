import { SETTINGS_GROUPS, type SettingsGroupId } from "./settingsIndex";

const KEY = "vaultspend-settings-group";

/** The Settings tab the person was last on, for this viewer (a display preference, like theme). Quick settings when
 * nothing was saved, the id is unknown, or storage cannot be read. */
export function readSettingsGroup(): SettingsGroupId {
  try {
    const saved = localStorage.getItem(KEY);
    if (saved === "quick" || SETTINGS_GROUPS.some((g) => g.id === saved)) return saved as SettingsGroupId;
  } catch {
    // blocked storage: start on Quick settings
  }
  return "quick";
}

export function writeSettingsGroup(id: SettingsGroupId): void {
  try {
    localStorage.setItem(KEY, id);
  } catch {
    // blocked storage: the choice just isn't remembered
  }
}
