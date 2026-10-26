import { useCallback, useEffect, useRef, useState } from "react";
import { deleteProtectionLeftovers, listProtectionLeftovers, type LeftoverEntry, type LeftoverKind } from "./protection";
import { getCurrentGeneration } from "./profileUiState";
import { errorMessage } from "./errorMessage";
import type { Profile } from "./types";

const KIND_LABEL: Record<LeftoverKind, string> = {
  original_database: "Original (unprotected) database",
  plaintext_backup: "Unprotected backup",
  mirrored_plaintext_backup: "Unprotected backup (second copy)",
};

/** Dismissal lasts only for this Settings mount. A different profile gets a
 * fresh owner; late reads/deletions cannot update its inventory or selection. */
export function ProtectionLeftovers({ profiles }: { profiles: Profile[] }) {
  const active = profiles.find(p => p.is_active);
  return active?.is_password_protected ? <ProfileLeftovers key={active.id} profileId={active.id} /> : null;
}

function ProfileLeftovers({ profileId }: { profileId: string }) {
  const [entries, setEntries] = useState<LeftoverEntry[]>([]);
  const [includeMirror, setIncludeMirror] = useState(false);
  const [dismissed, setDismissed] = useState(false);
  const [busy, setBusy] = useState(true);
  const [discoveryError, setDiscoveryError] = useState("");
  const [deleteError, setDeleteError] = useState("");
  const alive = useRef(true);
  const request = useRef(0);
  const originGeneration = useRef<number | null>(null);
  const deleting = useRef(false);

  const refreshInventory = useCallback(async (expectedGeneration?: number) => {
    const ticket = ++request.current;
    setBusy(true);
    setDiscoveryError("");
    try {
      const generation = expectedGeneration ?? await getCurrentGeneration();
      if (!alive.current || ticket !== request.current) return;
      const next = await listProtectionLeftovers(profileId, generation);
      if (!alive.current || ticket !== request.current) return;
      const currentGeneration = await getCurrentGeneration();
      if (!alive.current || ticket !== request.current) return;
      if (currentGeneration !== generation) throw new Error("The active profile changed during the cleanup check. Check cleanup status again.");
      originGeneration.current = generation;
      setEntries(next);
    } catch (error) {
      if (alive.current && ticket === request.current) setDiscoveryError("Cleanup status could not be checked. Previously created plaintext copies may still exist. " + errorMessage(error));
    } finally {
      if (alive.current && ticket === request.current) setBusy(false);
    }
  }, [profileId]);

  useEffect(() => {
    alive.current = true;
    void refreshInventory();
    return () => { alive.current = false; request.current++; };
  }, [refreshInventory]);

  const selected = entries.filter(e => includeMirror || e.kind !== "mirrored_plaintext_backup");
  const mirrorCount = entries.filter(e => e.kind === "mirrored_plaintext_backup").length;
  const localCount = entries.length - mirrorCount;

  // A partial deletion error remains visible even if the refreshed list is empty.
  if (dismissed || (entries.length === 0 && !discoveryError && !deleteError && !busy)) return null;

  async function deleteAll() {
    if (deleting.current || busy || discoveryError || selected.length === 0 || originGeneration.current === null) return;
    deleting.current = true;
    const generation = originGeneration.current;
    const ticket = request.current;
    setBusy(true);
    setDeleteError("");
    try {
      const failed = await deleteProtectionLeftovers(selected.map(e => e.path), profileId, generation);
      if (!alive.current || ticket !== request.current) return;
      const currentGeneration = await getCurrentGeneration();
      if (!alive.current || ticket !== request.current) return;
      if (currentGeneration !== generation) throw new Error("The active profile changed during plaintext cleanup. Check cleanup status again.");
      if (failed.length > 0) setDeleteError("Couldn't delete: " + failed.join(", "));
      await refreshInventory(generation);
    } catch (error) {
      if (alive.current && ticket === request.current) setDeleteError("Couldn't delete plaintext copies: " + errorMessage(error));
    } finally {
      deleting.current = false;
      if (alive.current) setBusy(false);
    }
  }

  return (
    <div className="card" role="region" aria-label="Leftover plaintext files" aria-busy={busy}>
      <div className="card-head"><span className="reports-section-title">Plaintext files left behind</span></div>
      {busy && <p className="modal-message-secondary" role="status">Checking plaintext cleanup status…</p>}
      {entries.length > 0 && <>
        <p className="modal-message-secondary">
          Your active data is encrypted. Previous plaintext originals and backups remain readable
          until you explicitly delete them. This check cannot find every export, external copy or cloud history.
        </p>
        <p className="modal-message-secondary">
          {discoveryError ? "Last known counts: " : ""}Local plaintext copies: {localCount}. Second-folder copies: {mirrorCount}.
        </p>
        {selected.length > 0 && <ul className="review-list">
          {selected.map(e => <li key={e.path}>{KIND_LABEL[e.kind]} — {e.path}</li>)}
        </ul>}
      </>}
      {mirrorCount > 0 && <label>
        <input type="checkbox" checked={includeMirror} disabled={busy} onChange={ev => setIncludeMirror(ev.target.checked)} />
        Also delete the copies in the second backup folder
      </label>}
      {discoveryError && <p className="launch-error-problem" role="alert">{discoveryError}</p>}
      {deleteError && <p className="launch-error-problem" role="alert">{deleteError}</p>}
      <div className="modal-actions">
        {(discoveryError || deleteError) && <button type="button" className="modal-secondary" onClick={() => void refreshInventory()} disabled={busy}>Retry cleanup check</button>}
        <button type="button" className="modal-secondary" onClick={() => setDismissed(true)} disabled={busy}>Keep for now</button>
        <button type="button" onClick={() => void deleteAll()} disabled={busy || !!discoveryError || selected.length === 0}>Delete plaintext copies now</button>
      </div>
    </div>
  );
}
