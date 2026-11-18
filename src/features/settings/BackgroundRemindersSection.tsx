import { type BackgroundSettings } from "../../shared/lib/types";
import { settingAttr, SettingStar } from "../../shared/ui/SettingStar";
import { MoreInfo } from "../../shared/ui/MoreInfo";

/** Opt-in: keep Vault Spend running in the system tray so it can remind you
 * about bills while the window is closed. */
export function BackgroundRemindersSection({
  settings,
  onSetTray,
  onSetAutostart,
  onSendTest,
  showBillNamesInReminders,
  onSetShowBillNamesInReminders,
}: {
  settings: BackgroundSettings | null;
  onSetTray: (enabled: boolean) => void;
  onSetAutostart: (enabled: boolean) => void;
  onSendTest: () => void;
  showBillNamesInReminders: boolean;
  onSetShowBillNamesInReminders: (enabled: boolean) => void;
}) {
  if (!settings) return null;
  return (
    <div className="card" data-background-reminders>
      <div className="card-head">
        <h2 className="reports-section-title">Background reminders</h2>
        <span className="setting-inline" {...settingAttr("test-reminder")}>
          <button type="button" className="modal-secondary" onClick={onSendTest} data-test-reminder>
            Send a test reminder
          </button>
          <SettingStar id="test-reminder" />
        </span>
      </div>
      <p className="modal-message-secondary">
        Off by default. Turn this on to keep getting reminders after you close the window.{" "}
        <MoreInfo>
          Reminders normally only appear while Vault Spend is open. When this is on, it stays in the system tray and
          reminds you about bills due in the next 3 days.
        </MoreInfo>
      </p>
      <div className="feature-toggle-list">
        <div className="setting-row" {...settingAttr("keep-running-in-tray")}>
<label className="feature-toggle-row">
          <input type="checkbox" checked={settings.tray_enabled} onChange={(e) => onSetTray(e.target.checked)} data-tray-toggle />
          <span className="feature-toggle-text">
            <span className="feature-toggle-label">Keep Vault Spend running in the tray</span>
            <span className="modal-message-secondary">
              Closing the window hides it instead of quitting. Use the tray icon's menu to open it again or to quit.
            </span>
          </span>
        </label>
<SettingStar id="keep-running-in-tray" />
</div>
        {settings.autostart_supported && (
          <div className="setting-row" {...settingAttr("start-when-i-sign-in")}>
<label className="feature-toggle-row">
            <input
              type="checkbox"
              checked={settings.autostart_enabled}
              disabled={!settings.tray_enabled}
              onChange={(e) => onSetAutostart(e.target.checked)}
              data-autostart-toggle
            />
            <span className="feature-toggle-text">
              <span className="feature-toggle-label">Start Vault Spend when I sign in</span>
              <span className="modal-message-secondary">
                It starts hidden in the tray, so reminders work without you opening it. Needs the tray option above.
              </span>
            </span>
          </label>
<SettingStar id="start-when-i-sign-in" />
</div>
        )}
        <div className="setting-row" {...settingAttr("show-bill-names")}>
<label className="feature-toggle-row">
          <input
            type="checkbox"
            checked={showBillNamesInReminders}
            onChange={(e) => onSetShowBillNamesInReminders(e.target.checked)}
            data-show-bill-names-toggle
          />
          <span className="feature-toggle-text">
            <span className="feature-toggle-label">Show bill names in reminders</span>
            <span className="modal-message-secondary">
              Only applies while a password-protected profile is unlocked — its reminders say "A bill is due soon" instead
              of naming it, unless this is on. An unprotected profile always names the bill.
            </span>
          </span>
        </label>
<SettingStar id="show-bill-names" />
</div>
      </div>
    </div>
  );
}
