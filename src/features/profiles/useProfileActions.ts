import type { Dispatch, SetStateAction } from "react";
import { open } from "../../shared/native/nativeDialog";
import { type Tab, type StatusKind } from "../../shared/native/appTypes";
import { type Profile } from "../../shared/lib/types";
import { invokeProfile } from "../../shared/native/profileIpc";
import { errorMessage } from "../../shared/lib/errorMessage";
import { getCurrentGeneration } from "../../shared/lib/profileUiState";

export function useProfileActions({ onDataFileChanged, setStatus, setChoosingExistingSource, setPendingExistingIsProtected, setPendingExistingRequiresPassword, setPendingExistingDbPath, pendingExistingDbPath, pendingExistingIsProtected, pendingExistingRequiresPassword, profiles, setPendingProtectedSwitch, refreshProfiles }: {
  onDataFileChanged: (message: string, tab?: Tab | undefined) => void;
  setStatus: (text: string, kind?: StatusKind) => void;
  setChoosingExistingSource: Dispatch<SetStateAction<boolean>>;
  setPendingExistingIsProtected: Dispatch<SetStateAction<boolean>>;
  setPendingExistingRequiresPassword: Dispatch<SetStateAction<boolean>>;
  setPendingExistingDbPath: Dispatch<SetStateAction<string | null>>;
  pendingExistingDbPath: string | null;
  pendingExistingIsProtected: boolean;
  pendingExistingRequiresPassword: boolean;
  profiles: Profile[];
  setPendingProtectedSwitch: Dispatch<SetStateAction<{ id: string; name: string; } | null>>;
  refreshProfiles: () => Promise<void>;
}) {
  async function handleCreateProfile(name: string) {
    try {
      const created = await invokeProfile("create_profile", { name });
      onDataFileChanged(`Switched to the new "${created}" profile — it starts completely empty.`);
    } catch (e) {
      setStatus(errorMessage(e));
    }
  }

  /** "Use existing file" step 1: pick the file. Step 2 (naming it) happens
   * in `UseExistingDataFileDialog` once `pendingExistingDbPath` is set —
   * split the same way `handleRelocateDataFile` splits picking a folder
   * from the backend call, except a name has to come from the user first. */
  async function handlePickExistingDataFile() {
    setChoosingExistingSource(true);
  }

  async function handlePickExistingDatabase() {
    const path = await open({ multiple: false, filters: [{ name: "Vault Spend Database", extensions: ["db"] }] });
    if (!path || Array.isArray(path)) return;
    setChoosingExistingSource(false);
    setPendingExistingIsProtected(false);
    // A bare, in-place `.db` can still be encrypted — e.g. a profile removed from the list
    // ("forgot the password? remove it" or a plain Delete) leaves exactly this shape on disk. Ask
    // the backend rather than guessing from the filename, so the dialog knows to show a password
    // field before the person ever hits "Use this file" and gets a confusing refusal.
    let requiresPassword = false;
    try {
      requiresPassword = await invokeProfile("path_looks_password_protected", { path });
    } catch {
      /* best effort — worst case the dialog omits the password field and the backend's own
         "That password didn't work for this profile" surfaces if it turns out to be needed */
    }
    setPendingExistingRequiresPassword(requiresPassword);
    setPendingExistingDbPath(path);
  }

  async function handlePickProtectedPackage() {
    const path = await open({ directory: true, multiple: false, title: "Choose a .vaultspend package folder" });
    if (!path || Array.isArray(path)) return;
    setChoosingExistingSource(false);
    setPendingExistingIsProtected(true);
    setPendingExistingRequiresPassword(false);
    setPendingExistingDbPath(path);
  }

  async function handleAddExistingProfile(name: string, password?: string) {
    if (!pendingExistingDbPath) return;
    try {
      const expectedGeneration = await getCurrentGeneration();
      const added = await invokeProfile("add_existing_profile", {
        name,
        dbPath: pendingExistingDbPath,
        password: password ?? null,
        expectedGeneration,
      });
      setPendingExistingDbPath(null);
      setPendingExistingIsProtected(false);
      setPendingExistingRequiresPassword(false);
      onDataFileChanged(`Switched to "${added}".`);
    } catch (e) {
      setStatus(errorMessage(e));
      if (pendingExistingIsProtected || pendingExistingRequiresPassword) throw e;
    }
  }

  async function handleSwitchProfile(id: string) {
    const target = profiles.find((p) => p.id === id);
    if (target?.is_password_protected) {
      setPendingProtectedSwitch({ id, name: target.name });
      return;
    }
    try {
      const switched = await invokeProfile("switch_profile", { id });
      onDataFileChanged(`Switched to "${switched}".`);
    } catch (e) {
      setStatus(errorMessage(e));
    }
  }

  async function handleRenameProfile(id: string, newName: string) {
    try {
      await invokeProfile("rename_profile", { id, newName });
      await refreshProfiles();
    } catch (e) {
      setStatus(errorMessage(e));
    }
  }

  async function handleSetProfileIcon(id: string, iconKey: string | null) {
    try {
      await invokeProfile("set_profile_icon", { id, iconKey });
      await refreshProfiles();
    } catch (e) {
      setStatus(errorMessage(e));
    }
  }

  async function handleDeleteProfile(id: string) {
    try {
      await invokeProfile("delete_profile", { id });
      await refreshProfiles();
    } catch (e) {
      setStatus(errorMessage(e));
    }
  }

  return { handleCreateProfile, handlePickExistingDataFile, handlePickExistingDatabase, handlePickProtectedPackage, handleAddExistingProfile, handleSwitchProfile, handleRenameProfile, handleSetProfileIcon, handleDeleteProfile };
}
