// Wrapper for profile/file and CSV native dialogs. A dialog is an owned window: taking it up
// defocuses the main window the same way a real alt-tab does, which would otherwise lock a protected
// profile that's opted into "lock on focus loss" mid-Export/mid-Relocate/mid-"Use existing file…"
// (see `auto_lock::window_lock_reason`'s doc comment on the Rust side). Profile/file and CSV flows
// import `open`/`save` here; LaunchErrorScreen and MobileSettings currently call the plugin directly
// (see docs/NATIVE-CONTROLS.md). The `finally` guarantees the backend is told the dialog
// closed even if it's cancelled or its promise rejects.
import { open as tauriOpen, save as tauriSave } from "@tauri-apps/plugin-dialog";
import { invoke } from "@tauri-apps/api/core";

async function withNativeDialogOpen<T>(run: () => Promise<T>): Promise<T> {
  await invoke("note_native_dialog_state", { open: true }).catch(() => {
    // Best effort — StartupGate/the auto-lock session own the rest of this behavior; a failed
    // notification here just means a real focus-loss lock could still fire during this one dialog.
  });
  try {
    return await run();
  } finally {
    await invoke("note_native_dialog_state", { open: false }).catch(() => {});
  }
}

export const open: typeof tauriOpen = ((options?: Parameters<typeof tauriOpen>[0]) =>
  withNativeDialogOpen(() => tauriOpen(options))) as typeof tauriOpen;

export const save: typeof tauriSave = ((options?: Parameters<typeof tauriSave>[0]) =>
  withNativeDialogOpen(() => tauriSave(options))) as typeof tauriSave;
