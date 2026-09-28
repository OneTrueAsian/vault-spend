import { useEffect, useState } from "react";
import { getCurrentGeneration } from "./profileUiState";
import {
  getAutoLockSettings,
  setAutoLockSettings,
  type AutoLockSettings as AutoLockSettingsValue,
  type SavedAutoLockSettings,
} from "./autoLock";

const DEFAULTS: AutoLockSettingsValue = {
  inactivity_minutes: 15,
  lock_when_hidden: true,
  lock_on_focus_loss: false,
  lock_on_system_event: true,
  system_event_supported: true,
};

const MINUTE_OPTIONS = [0, 1, 5, 15, 30, 60] as const;

export function AutoLockSettings({ enabled }: { enabled: boolean }) {
  const [settings, setSettings] = useState<AutoLockSettingsValue>(DEFAULTS);
  const [error, setError] = useState("");
  const [loaded, setLoaded] = useState(false);
  const [saving, setSaving] = useState(false);

  useEffect(() => {
    if (!enabled) {
      setSettings(DEFAULTS);
      setLoaded(false);
      return;
    }
    setLoaded(false);
    let cancelled = false;
    getAutoLockSettings()
      .then((next) => {
        if (!cancelled) {
          setSettings(next);
          setLoaded(true);
        }
      })
      .catch((reason) => {
        if (!cancelled) setError(String(reason));
      });
    return () => {
      cancelled = true;
    };
  }, [enabled]);

  async function save(next: AutoLockSettingsValue) {
    if (!loaded || saving) return;
    const previous = settings;
    setSettings(next);
    setError("");
    setSaving(true);
    const { system_event_supported: _supported, ...persisted } = next;
    try {
      const generation = await getCurrentGeneration();
      await setAutoLockSettings(persisted as SavedAutoLockSettings, generation);
    } catch (reason) {
      setSettings(previous);
      setError(String(reason));
    } finally {
      setSaving(false);
    }
  }

  const controlsDisabled = !enabled || !loaded || saving;

  return (
    <div data-auto-lock-settings>
      <h3 className="data-subhead">Automatic locking</h3>
      <p className="modal-message-secondary">
        Automatic locking closes this profile's data connection and returns to the password screen.
      </p>
      {!enabled && (
        <p className="modal-message-secondary">Turn on password protection to use automatic locking.</p>
      )}
      <div className="feature-toggle-list">
        <label className="feature-toggle-row">
          <select
            value={settings.inactivity_minutes}
            disabled={controlsDisabled}
            onChange={(event) => void save({ ...settings, inactivity_minutes: Number(event.target.value) as AutoLockSettingsValue["inactivity_minutes"] })}
            data-auto-lock-minutes
            aria-label="Lock after inactivity"
          >
            {MINUTE_OPTIONS.map((minutes) => (
              <option key={minutes} value={minutes}>
                {minutes === 0 ? "Off" : `${minutes} minute${minutes === 1 ? "" : "s"}`}
              </option>
            ))}
          </select>
          <span className="feature-toggle-text">
            <span className="feature-toggle-label">Lock after inactivity</span>
            <span className="modal-message-secondary">A 10-second warning appears before Vault Spend locks.</span>
          </span>
        </label>
        <Toggle
          marker="data-lock-when-hidden"
          checked={settings.lock_when_hidden}
          disabled={controlsDisabled}
          label="Lock when hidden to the tray"
          description="Reopening Vault Spend will require this profile's password."
          onChange={(checked) => void save({ ...settings, lock_when_hidden: checked })}
        />
        <Toggle
          marker="data-lock-on-focus-loss"
          checked={settings.lock_on_focus_loss}
          disabled={controlsDisabled}
          label="Lock when the window loses focus"
          description="Switching to another app locks this profile immediately. Off by default."
          onChange={(checked) => void save({ ...settings, lock_on_focus_loss: checked })}
        />
        <Toggle
          marker="data-lock-on-system-event"
          checked={settings.lock_on_system_event}
          disabled={controlsDisabled || !settings.system_event_supported}
          label="Lock when Windows locks or sleeps"
          description={settings.system_event_supported ? "Enabled by default on Windows." : "Available on Windows."}
          onChange={(checked) => void save({ ...settings, lock_on_system_event: checked })}
        />
      </div>
      {error && <p className="field-error" role="alert">{error}</p>}
    </div>
  );
}

function Toggle({
  marker,
  checked,
  disabled,
  label,
  description,
  onChange,
}: {
  marker: string;
  checked: boolean;
  disabled: boolean;
  label: string;
  description: string;
  onChange: (checked: boolean) => void;
}) {
  return (
    <label className="feature-toggle-row">
      <input
        type="checkbox"
        checked={checked}
        disabled={disabled}
        onChange={(event) => onChange(event.target.checked)}
        {...{ [marker]: "" }}
      />
      <span className="feature-toggle-text">
        <span className="feature-toggle-label">{label}</span>
        <span className="modal-message-secondary">{description}</span>
      </span>
    </label>
  );
}
