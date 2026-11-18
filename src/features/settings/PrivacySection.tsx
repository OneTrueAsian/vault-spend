import { MoreInfo } from "../../shared/ui/MoreInfo";
import { settingAttr, SettingStar } from "../../shared/ui/SettingStar";

export function PrivacySection({ autoHide, onSetAutoHide }: { autoHide: boolean; onSetAutoHide: (autoHide: boolean) => void }) {
  return (
    <div className="card">
      <div className="card-head">
        <h2 className="reports-section-title">Privacy</h2>
      </div>
      <p className="modal-message-secondary">
        The Hide amounts button at the bottom of the sidebar covers every dollar figure on screen with ••••.{" "}
        <MoreInfo>Use it when someone is sitting next to you. It hides the numbers, not the shapes of charts.</MoreInfo>
      </p>
      <div className="feature-toggle-list">
        <div className="setting-row" {...settingAttr("hide-when-away")}>
<label className="feature-toggle-row">
          <input type="checkbox" checked={autoHide} onChange={(e) => onSetAutoHide(e.target.checked)} data-privacy-autohide />
          <span className="feature-toggle-text">
            <span className="feature-toggle-label">Also hide amounts when this window isn't in front</span>
            <span className="modal-message-secondary">
              Switch to another program and your figures are covered until you come back.
            </span>
          </span>
        </label>
<SettingStar id="hide-when-away" />
</div>
      </div>
    </div>
  );
}
