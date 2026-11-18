import { open } from "../../shared/native/nativeDialog";
import { type StatusKind, type Tab } from "../../shared/native/appTypes";
import { errorMessage } from "../../shared/lib/errorMessage";
import { getCurrentGeneration } from "../../shared/lib/profileUiState";

export function useBackupActions({ invoke, refreshBackups, setStatus, onDataFileChanged }: {
  invoke: <T>(command: string, args?: Record<string, unknown> | undefined) => Promise<T>;
  refreshBackups: () => Promise<void>;
  setStatus: (text: string, kind?: StatusKind) => void;
  onDataFileChanged: (message: string, tab?: Tab | undefined) => void;
}) {
  async function handleCreateBackupNow() {
    try {
      const result = await invoke<{ filename: string; copied_to: string | null; copy_error: string | null }>("create_backup_now");
      await refreshBackups();
      if (result.copy_error) {
        setStatus(`Backup created, but the copy to your second folder failed: ${result.copy_error}`, "error");
      } else if (result.copied_to) {
        setStatus(`Backup created and copied to ${result.copied_to}.`, "success");
      } else {
        setStatus("Backup created.", "success");
      }
    } catch (e) {
      setStatus(errorMessage(e));
    }
  }

  async function handleSetBackupCopyDir(dir: string | null) {
    try {
      const message = await invoke<string>("set_backup_copy_dir", { dir });
      await refreshBackups();
      setStatus(message, "success");
    } catch (e) {
      setStatus(errorMessage(e));
    }
  }

  async function handleBrowseBackupCopyDir() {
    try {
      const picked = await open({ directory: true, multiple: false, title: "Choose a folder for the second backup copy" });
      if (typeof picked === "string") await handleSetBackupCopyDir(picked);
    } catch (e) {
      setStatus(errorMessage(e));
    }
  }

  async function handleRestoreBackup(filename: string, password?: string) {
    try {
      const expectedGeneration = await getCurrentGeneration();
      await invoke("restore_backup", { filename, password: password ?? null, expectedGeneration });
      onDataFileChanged(`Restored ${filename} — your prior data was backed up first.`);
    } catch (e) {
      setStatus(errorMessage(e));
      if (password !== undefined) throw e;
    }
  }

  return { handleCreateBackupNow, handleSetBackupCopyDir, handleBrowseBackupCopyDir, handleRestoreBackup };
}
