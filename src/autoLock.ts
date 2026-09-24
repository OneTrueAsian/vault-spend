import { invoke } from "@tauri-apps/api/core";

export type AutoLockSettings = {
  inactivity_minutes: 0 | 1 | 5 | 15 | 30 | 60;
  lock_when_hidden: boolean;
  lock_on_focus_loss: boolean;
  lock_on_system_event: boolean;
  system_event_supported: boolean;
};

export type SavedAutoLockSettings = Omit<AutoLockSettings, "system_event_supported">;

export const getAutoLockSettings = () => invoke<AutoLockSettings>("get_auto_lock_settings");

export const setAutoLockSettings = (settings: SavedAutoLockSettings, expectedGeneration: number) =>
  invoke<void>("set_auto_lock_settings", { settings, expectedGeneration });
