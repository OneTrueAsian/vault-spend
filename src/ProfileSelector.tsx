import { useEffect, useState } from "react";
import { invoke } from "@tauri-apps/api/core";
import { ProfileIcon } from "./icons";
import { selectProfile } from "./protection";
import { getCurrentGeneration } from "./profileUiState";
import { ProtectionSetupDialog } from "./ProtectionSetupDialog";
import { useAutoCancelDelete } from "./useAutoCancelDelete";
import type { SelectorEntry, StartupState } from "./startup";
import { errorMessage } from "./errorMessage";

/** A card per profile — an avatar, the name, and (matching Settings' own Profiles section, the only
 * other place these two actions exist) inline Rename/Delete, plus a dedicated "Add profile" tile.
 * Rename/Delete/Create all reach the backend directly via `invoke` (the same pattern
 * `EmptyRegistryScreen` already uses), since this screen renders before any profile is open and has
 * no access to `App.tsx`'s own handlers. Neither `rename_profile` nor `delete_profile` needs an open
 * session (confirmed by reading `commands.rs` directly), so both work fine from here. Reuses the
 * launch-error screen's own card shell for the outer frame — this is the same shape of thing, a
 * full-screen gate shown instead of the app — but gives the card grid itself a dedicated look. */
export function ProfileSelector({
  profiles,
  lastUsedId,
  onResolved,
}: {
  profiles: SelectorEntry[];
  lastUsedId: string | null;
  onResolved: (next: StartupState) => void;
}) {
  const [entries, setEntries] = useState(profiles);
  const [selected] = useState(lastUsedId ?? profiles[0]?.id ?? "");
  const [busy, setBusy] = useState(false);
  const [problem, setProblem] = useState("");
  const [editingId, setEditingId] = useState<string | null>(null);
  const [draftName, setDraftName] = useState("");
  const [confirmingDeleteId, setConfirmingDeleteId] = useState<string | null>(null);
  useAutoCancelDelete(confirmingDeleteId, () => setConfirmingDeleteId(null));
  const [adding, setAdding] = useState(false);
  const [newName, setNewName] = useState("");
  const [protectNewProfile, setProtectNewProfile] = useState(false);
  const [pendingProtectedProfile, setPendingProtectedProfile] = useState<{ name: string; generation: number } | null>(null);

  useEffect(() => {
    setEntries(profiles);
  }, [profiles]);

  async function open(id: string) {
    setBusy(true);
    setProblem("");
    try {
      onResolved(await selectProfile(id));
    } catch (e) {
      setProblem(errorMessage(e));
    } finally {
      setBusy(false);
    }
  }

  function startEditing(p: SelectorEntry) {
    setConfirmingDeleteId(null);
    setEditingId(p.id);
    setDraftName(p.name);
  }

  async function commitRename(id: string, oldName: string) {
    const trimmed = draftName.trim();
    setEditingId(null);
    if (!trimmed || trimmed === oldName) return;
    try {
      await invoke("rename_profile", { id, newName: trimmed });
      setEntries((cur) => cur.map((p) => (p.id === id ? { ...p, name: trimmed } : p)));
    } catch (e) {
      setProblem(errorMessage(e));
    }
  }

  async function commitDelete(id: string) {
    setConfirmingDeleteId(null);
    try {
      await invoke("delete_profile", { id });
      setEntries((cur) => cur.filter((p) => p.id !== id));
    } catch (e) {
      setProblem(errorMessage(e));
    }
  }

  async function commitCreate() {
    const trimmed = newName.trim();
    if (!trimmed) return;
    setBusy(true);
    setProblem("");
    try {
      if (protectNewProfile) {
        setPendingProtectedProfile({ name: trimmed, generation: await getCurrentGeneration() });
        setBusy(false);
        return;
      }
      await invoke("create_profile", { name: trimmed });
      onResolved({ status: "open" });
    } catch (e) {
      setProblem(errorMessage(e));
      setBusy(false);
    }
  }

  function cancelAdd() {
    setAdding(false);
    setNewName("");
    setProtectNewProfile(false);
  }

  return (
    <main className="profile-gate" data-profile-selector>
      <div className="profile-gate-card profile-selector-card">
        <h1 id="profile-selector-heading" tabIndex={-1}>
          Choose a profile
        </h1>
        <p className="profile-gate-subtitle">Pick a profile to continue, or add a new one.</p>
        <div className="profile-card-grid">
          {entries.map((p) => (
            <div className="profile-card" data-profile-card key={p.id}>
              {editingId === p.id ? (
                <div className="profile-card-editing">
                  <ProfileIcon iconKey={p.icon_key} className="profile-card-avatar" />
                  <input
                    autoFocus
                    className="text-input row-edit-input"
                    value={draftName}
                    onChange={(e) => setDraftName(e.target.value)}
                    onBlur={() => commitRename(p.id, p.name)}
                    onKeyDown={(e) => {
                      if (e.key === "Enter") {
                        // The commit re-renders this card and the selected profile's Open button takes focus;
                        // without this, the key's follow-on character event lands on that button and opens the profile.
                        e.preventDefault();
                        commitRename(p.id, p.name);
                      }
                      if (e.key === "Escape") setEditingId(null);
                    }}
                  />
                </div>
              ) : (
                <>
                  <button
                    type="button"
                    className="profile-card-open"
                    data-profile-option
                    disabled={busy}
                    onClick={() => open(p.id)}
                    autoFocus={p.id === selected}
                  >
                    <ProfileIcon iconKey={p.icon_key} className="profile-card-avatar" />
                    <span className="profile-card-name">
                      <span>{p.name}</span>
                      {p.is_password_protected && <span aria-label="Password protected">🔒</span>}
                    </span>
                  </button>
                  {confirmingDeleteId === p.id ? (
                    <span className="row-delete-confirm profile-card-actions">
                      <button type="button" className="modal-secondary btn-sm" onClick={() => setConfirmingDeleteId(null)}>
                        Cancel
                      </button>
                      <button type="button" className="btn-danger btn-sm" onClick={() => commitDelete(p.id)}>
                        Delete
                      </button>
                    </span>
                  ) : (
                    <span className="profile-card-actions">
                      <button type="button" className="modal-secondary btn-sm" onClick={() => startEditing(p)}>
                        Rename
                      </button>
                      <button type="button" className="modal-secondary btn-sm" onClick={() => setConfirmingDeleteId(p.id)}>
                        Delete
                      </button>
                    </span>
                  )}
                </>
              )}
            </div>
          ))}
          {adding ? (
            <form
              className="profile-card profile-card-new-form"
              onSubmit={(event) => {
                event.preventDefault();
                void commitCreate();
              }}
            >
              <input
                autoFocus
                className="text-input row-edit-input"
                placeholder="Profile name"
                value={newName}
                onChange={(e) => setNewName(e.target.value)}
                disabled={busy}
                onKeyDown={(e) => {
                  if (e.key === "Enter") {
                    e.preventDefault();
                    void commitCreate();
                  }
                  if (e.key === "Escape") cancelAdd();
                }}
              />
              <label className="checkbox-label">
                <input
                  type="checkbox"
                  data-protect-new-profile
                  checked={protectNewProfile}
                  onChange={(event) => setProtectNewProfile(event.target.checked)}
                  disabled={busy}
                />
                Protect this profile with a password
              </label>
              <span className="profile-card-actions">
                <button type="button" className="modal-secondary btn-sm" onClick={cancelAdd} disabled={busy}>
                  Cancel
                </button>
                <button type="submit" className="btn-sm" disabled={busy || newName.trim() === ""}>
                  Add
                </button>
              </span>
            </form>
          ) : (
            <button type="button" className="profile-card profile-card-add" data-add-profile onClick={() => setAdding(true)} disabled={busy}>
              <span className="profile-card-add-icon" aria-hidden="true">
                +
              </span>
              <span>Add profile</span>
            </button>
          )}
        </div>
        <p className="launch-error-problem" role="alert">
          {problem}
        </p>
      </div>
      {pendingProtectedProfile && (
        <ProtectionSetupDialog
          targetProfileId={null}
          newProfileName={pendingProtectedProfile.name}
          expectedGeneration={pendingProtectedProfile.generation}
          onDone={(next) => {
            setPendingProtectedProfile(null);
            cancelAdd(); // the profile now exists — don't leave its name typed into a live Add form
            onResolved(next);
          }}
          onCancel={() => setPendingProtectedProfile(null)}
        />
      )}
    </main>
  );
}
