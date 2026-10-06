import "./MobileControls.css";
import { useCallback, useEffect, useState } from "react";
import { invoke } from "@tauri-apps/api/core";
import { listen } from "@tauri-apps/api/event";
import { ModalShell } from "./Modal";
import { errorMessage } from "./errorMessage";
import "./MobilePairingPrompt.css";
type Pending = { id: string; label: string };
type Profile = { id: string; name: string };
/** Desktop confirmation stays separate from the later Settings setup flow. */
export function MobilePairingPrompt() {
  const [pending, setPending] = useState<Pending[]>([]);
  const [profiles, setProfiles] = useState<Profile[]>([]);
  const [selected, setSelected] = useState<string[]>([]);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const refresh = useCallback(async () => {
    const requests = await invoke<Pending[]>("mobile_pending_pairings");
    setPending(requests);
    if (requests.length) setProfiles(await invoke<Profile[]>("mobile_pairing_profiles"));
  }, []);
  useEffect(() => {
    let stopped = false;
    let unsubscribe = () => {};
    void listen("mobile-pairing-changed", () => { if (!stopped) void refresh().catch(() => {}); })
      .then(stop => { if (stopped) stop(); else { unsubscribe = stop; void refresh().catch(() => {}); } }).catch(() => { if (!stopped) void refresh().catch(() => {}); });
    return () => { stopped = true; unsubscribe(); };
  }, [refresh]);
  const request = pending[0];
  const requestId = request?.id;
  useEffect(() => {
    setSelected([]);
    setError("");
    if (!requestId) return;
    const timer = window.setInterval(() => { void refresh().catch(() => {}); }, 2000);
    return () => window.clearInterval(timer);
  }, [requestId, refresh]);
  if (!request) return null;
  const decide = async (approved: boolean) => {
    if (busy || (approved && selected.length === 0)) return;
    setBusy(true); setError("");
    try {
      await invoke("mobile_decide_pairing", { id: request.id, profiles: approved ? selected : null });
      setPending(current => current.filter(p => p.id !== request.id));
    } catch (failure) { setError(errorMessage(failure)); }
    finally { setBusy(false); }
  };
  return <ModalShell title="Approve this phone?" onCancel={() => { void decide(false); }} dismissOnOverlayClick={false} footer={<div className="modal-actions">
    <button type="button" className="modal-secondary" disabled={busy} onClick={() => { void decide(false); }}>Reject</button>
    <button type="button" disabled={busy || selected.length === 0} onClick={() => { void decide(true); }}>Approve phone</button>
  </div>}>
    <div className="mobile-pairing-content"><p><strong>{request.label}</strong> is asking to save read-only snapshots. Approve only the phone you are pairing now; its name is supplied by that phone.</p>
    <fieldset className="mobile-pairing-profiles"><legend>Allow these profiles</legend>{profiles.map(profile => <label key={profile.id} className="checkbox-label">
      <input type="checkbox" checked={selected.includes(profile.id)} disabled={busy} onChange={event => setSelected(current => event.target.checked ? [...current, profile.id] : current.filter(id => id !== profile.id))} /> <span>{profile.name}</span>
    </label>)}</fieldset>
    <p>Refresh requires the same profile to be open and unlocked on this desktop. Revoking access blocks future downloads but cannot erase saved offline copies from the phone.</p>
    {error && <p role="alert">{error}</p>}</div>
  </ModalShell>;
}
