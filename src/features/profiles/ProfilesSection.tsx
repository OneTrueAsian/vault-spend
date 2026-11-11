import { useDismissOnEscape, ProfileIcon, IconPicker, PROFILE_ICON_OPTIONS, isProfileIconKey, type ProfileIconKey } from "../../shared/ui/icons";
import { createPortal } from "react-dom";
import { type Profile } from "../../shared/lib/types";
import { useState, FormEvent } from "react";
import { useAutoCancelDelete } from "../../shared/hooks/useAutoCancelDelete";
import { getCurrentGeneration } from "../../shared/lib/profileUiState";
import { cardAttr, SettingStar } from "../../shared/ui/SettingStar";
import { MoreInfo } from "../../shared/ui/MoreInfo";
import { ProtectionSetupDialog } from "./ProtectionSetupDialog";

/** `ManageCategoriesDialog`'s inline `.icon-picker-popover` positions itself
 * `absolute` against its own row — fine inside a plain `<ul>`, but the
 * Profiles table below is a `.ledger`, which clips overflow to keep its
 * corners rounded, so an absolutely-positioned popover taller than one row
 * gets silently clipped away instead of showing. Portaling it to
 * `document.body` and positioning it `fixed` against the swatch's own
 * on-screen rect sidesteps that clipping entirely without touching
 * `.ledger`'s shared styling (used by every other table in the app). */
function ProfileIconPopover({ anchorRect, onClose, children }: { anchorRect: DOMRect; onClose: () => void; children: React.ReactNode }) {
  useDismissOnEscape(onClose);
  return createPortal(
    <>
      <div className="icon-picker-portal-backdrop" onClick={onClose} />
      <div className="icon-picker-popover icon-picker-popover-portal" style={{ top: anchorRect.bottom + 4, left: anchorRect.left }}>
        {children}
      </div>
    </>,
    document.body,
  );
}

export function ProfilesSection({
  profiles,
  onCreateProfile,
  onUseExistingDataFile,
  onSwitchProfile,
  onRenameProfile,
  onSetProfileIcon,
  onDeleteProfile,
  onProtected,
}: {
  profiles: Profile[];
  onCreateProfile: (name: string) => void;
  /** Opens the native file picker for an existing `.db` file brought over
   * from another machine — see `App.tsx`'s `handlePickExistingDataFile`.
   * Takes no arguments; the picked path flows back through a separate
   * dialog (`UseExistingDataFileDialog`) that asks for a name, same
   * division of labor as `onRelocateDataFile`. */
  onUseExistingDataFile: () => void;
  onSwitchProfile: (id: string) => void;
  onRenameProfile: (id: string, newName: string) => void;
  onSetProfileIcon: (id: string, iconKey: string | null) => void;
  onDeleteProfile: (id: string) => void;
  onProtected: () => void;
}) {
  const [newProfileName, setNewProfileName] = useState("");
  const [protectNewProfile, setProtectNewProfile] = useState(false);
  const [pendingProtectedProfile, setPendingProtectedProfile] = useState<{ name: string; generation: number } | null>(null);
  const [editingId, setEditingId] = useState<string | null>(null);
  const [draftName, setDraftName] = useState("");
  const [confirmingDeleteId, setConfirmingDeleteId] = useState<string | null>(null);
  useAutoCancelDelete(confirmingDeleteId, () => setConfirmingDeleteId(null));
  const [editingIcon, setEditingIcon] = useState<{ id: string; anchorRect: DOMRect } | null>(null);

  async function handleCreateSubmit(e: FormEvent) {
    e.preventDefault();
    const trimmed = newProfileName.trim();
    if (!trimmed) return;
    if (protectNewProfile) {
      setPendingProtectedProfile({ name: trimmed, generation: await getCurrentGeneration() });
      return;
    }
    onCreateProfile(trimmed);
    setNewProfileName("");
  }

  function startEditing(p: Profile) {
    setConfirmingDeleteId(null);
    setEditingId(p.id);
    setDraftName(p.name);
  }

  function commitRename(id: string, oldName: string) {
    const trimmed = draftName.trim();
    if (trimmed && trimmed !== oldName) {
      onRenameProfile(id, trimmed);
    }
    setEditingId(null);
  }

  return (
    <div className="card" {...cardAttr("profiles")}>
      <div className="card-head">
        <h2 className="reports-section-title">Profiles</h2>
        <SettingStar id="profiles" />
      </div>
      <p className="modal-message-secondary">
        Each profile is its own separate data file. Nothing is shared between profiles.{" "}
        <MoreInfo>Switching loads a different set of accounts, transactions and everything else.</MoreInfo>
      </p>
      <table className="ledger">
        <thead>
          <tr>
            <th>
              <span className="sr-only">Icon</span>
            </th>
            <th>Name</th>
            <th className="actions-col"><span className="sr-only">Actions</span></th>
          </tr>
        </thead>
        <tbody>
          {profiles.map((p) => (
            <tr key={p.id}>
              <td>
                <span className="icon-toggle-anchor">
                  <button
                    type="button"
                    className="icon-picker-swatch"
                    title="Click to change this profile's icon"
                    aria-label={`Change ${p.name}'s icon`}
                    onClick={(e) => {
                      if (editingIcon?.id === p.id) {
                        setEditingIcon(null);
                        return;
                      }
                      setEditingIcon({ id: p.id, anchorRect: e.currentTarget.getBoundingClientRect() });
                    }}
                  >
                    <ProfileIcon iconKey={p.icon_key} />
                  </button>
                  {editingIcon?.id === p.id && (
                    <ProfileIconPopover anchorRect={editingIcon.anchorRect} onClose={() => setEditingIcon(null)}>
                      <IconPicker
                        options={PROFILE_ICON_OPTIONS}
                        value={p.icon_key && isProfileIconKey(p.icon_key) ? p.icon_key : null}
                        onChange={(key: ProfileIconKey) => {
                          onSetProfileIcon(p.id, key);
                          setEditingIcon(null);
                        }}
                        renderIcon={(key) => <ProfileIcon iconKey={key} />}
                        size="lg"
                      />
                    </ProfileIconPopover>
                  )}
                </span>
              </td>
              <td>
                {editingId === p.id ? (
                  <input
                    autoFocus
                    className="row-edit-input"
                    value={draftName}
                    onChange={(e) => setDraftName(e.target.value)}
                    onBlur={() => commitRename(p.id, p.name)}
                    onKeyDown={(e) => {
                      if (e.key === "Enter") commitRename(p.id, p.name);
                      if (e.key === "Escape") setEditingId(null);
                    }}
                  />
                ) : (
                  <>
                    {p.name}
                    {p.is_password_protected && (
                      <span className="settings-profile-lock" aria-label="Password protected" title="Password protected">
                        🔒
                      </span>
                    )}
                    {p.is_active && <span className="account-col"> (current)</span>}
                  </>
                )}
              </td>
              <td className="actions-col">
                {confirmingDeleteId === p.id ? (
                  <span className="row-delete-confirm">
                    <button type="button" className="modal-secondary" onClick={() => setConfirmingDeleteId(null)}>
                      Cancel
                    </button>
                    <button type="button" className="btn-danger" onClick={() => onDeleteProfile(p.id)}>
                      Delete
                    </button>
                  </span>
                ) : (
                  <span className="row-delete-confirm">
                    {!p.is_active && (
                      <button type="button" className="modal-secondary" onClick={() => onSwitchProfile(p.id)}>
                        Switch
                      </button>
                    )}
                    <button type="button" className="modal-secondary" onClick={() => startEditing(p)}>
                      Rename
                    </button>
                    {!p.is_active && (
                      <button
                        type="button"
                        className="modal-secondary"
                        onClick={() => setConfirmingDeleteId(p.id)}
                      >
                        Delete
                      </button>
                    )}
                  </span>
                )}
              </td>
            </tr>
          ))}
        </tbody>
      </table>
      <form className="category-create-form profile-create-form" onSubmit={handleCreateSubmit}>
        <input
          value={newProfileName}
          onChange={(e) => setNewProfileName(e.target.value)}
          placeholder='New profile, e.g. "Alex"'
        />
        <button type="submit" disabled={!newProfileName.trim()}>
          New profile
        </button>
        <button type="button" className="modal-secondary" onClick={onUseExistingDataFile}>
          Use existing file
        </button>
        <label className="checkbox-label">
          <input
            type="checkbox"
            data-protect-new-profile
            checked={protectNewProfile}
            onChange={(event) => setProtectNewProfile(event.target.checked)}
          />
          Protect this profile with a password
        </label>
      </form>
      <p className="modal-message-secondary">
        Moving to a new computer, or upgrading from an older version? "Use existing file" opens a data file you
        already have, as a new profile, instead of starting empty.{" "}
        <MoreInfo>
          It's checked for real account and transaction data before it is used. A file that isn't a Vault Spend
          database is turned down with a clear reason.
        </MoreInfo>
      </p>
      {pendingProtectedProfile && (
        <ProtectionSetupDialog
          targetProfileId={null}
          newProfileName={pendingProtectedProfile.name}
          expectedGeneration={pendingProtectedProfile.generation}
          onDone={() => {
            setPendingProtectedProfile(null);
            setNewProfileName("");
            setProtectNewProfile(false);
            onProtected();
          }}
          onCancel={() => setPendingProtectedProfile(null)}
        />
      )}
    </div>
  );
}
