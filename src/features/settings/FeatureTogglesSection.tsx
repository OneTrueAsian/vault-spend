import { type AppSettings } from "../../shared/lib/types";
import { settingAttr, SettingStar } from "../../shared/ui/SettingStar";

const TOGGLE_SETTING_IDS: Record<keyof AppSettings, string> = {
  apply_to_debt_enabled: "apply-to-debt",
  split_purchases_enabled: "split-purchases",
  envelope_caps_enabled: "envelope-caps",
  rollover_enabled: "rollover-unspent",
  auto_link_transfers: "link-transfers",
  safe_to_spend_enabled: "safe-to-spend",
};

export function FeatureTogglesSection({
  appSettings,
  onSetApplyToDebtEnabled,
  onSetSplitPurchasesEnabled,
  onSetEnvelopeCapsEnabled,
  onSetRolloverEnabled,
  onSetAutoLinkTransfers,
  onSetSafeToSpendEnabled,
}: {
  appSettings: AppSettings;
  onSetApplyToDebtEnabled: (enabled: boolean) => void;
  onSetSplitPurchasesEnabled: (enabled: boolean) => void;
  onSetEnvelopeCapsEnabled: (enabled: boolean) => void;
  onSetRolloverEnabled: (enabled: boolean) => void;
  onSetAutoLinkTransfers: (enabled: boolean) => void;
  onSetSafeToSpendEnabled: (enabled: boolean) => void;
}) {
  const toggles: { key: keyof AppSettings; label: string; description: string; onChange: (enabled: boolean) => void }[] = [
    {
      key: "apply_to_debt_enabled",
      label: "Apply to Debt",
      description: 'Shows "Apply to a debt →" on each transaction, so a payment can also reduce a loan or credit card balance.',
      onChange: onSetApplyToDebtEnabled,
    },
    {
      key: "split_purchases_enabled",
      label: "Split purchases",
      description: "Shows the Split control on each transaction, for dividing one purchase across multiple categories.",
      onChange: onSetSplitPurchasesEnabled,
    },
    {
      key: "envelope_caps_enabled",
      label: "Envelope Caps",
      description: 'Adds "Warn at 90%" to each Budget category\'s ⋯ menu, for warning at 90% instead of the default 80%.',
      onChange: onSetEnvelopeCapsEnabled,
    },
    {
      key: "rollover_enabled",
      label: "Rollover unspent",
      description:
        'Lets a Budget category carry what it didn\'t spend into next month ("Roll over unspent" in each line\'s ⋯ menu). Off: nothing rolls over, and each category\'s choice is remembered for when you turn it back on.',
      onChange: onSetRolloverEnabled,
    },
    {
      key: "auto_link_transfers",
      label: "Link matching transfers automatically",
      description:
        "Off by default. When on, a pair of transactions that are clearly one move between your own accounts (equal amounts, opposite directions, different accounts, within 3 days, and no other possible match) is linked as soon as it arrives, instead of waiting in “possible transfers”. Every automatic link is listed on Transactions for you to review and unlink.",
      onChange: onSetAutoLinkTransfers,
    },
    {
      key: "safe_to_spend_enabled",
      label: "Safe to spend",
      description: "Shows the Safe to spend Dashboard widget. Turning this off keeps its saved position and buffer for when you turn it back on.",
      onChange: onSetSafeToSpendEnabled,
    },
  ];

  return (
    <div className="card">
      <div className="card-head">
        <h2 className="reports-section-title">Feature toggles</h2>
      </div>
      <p className="modal-message-secondary">
        Turn a feature off to hide it everywhere it appears. Nothing it already stored is lost — turning it back on
        picks up right where it left off.
      </p>
      <div className="feature-toggle-list">
        {toggles.map((t) => (
          <div key={t.key} className="setting-row" {...settingAttr(TOGGLE_SETTING_IDS[t.key])}>
          <label className="feature-toggle-row" data-feature-toggle={t.key}>
            <input type="checkbox" checked={appSettings[t.key]} onChange={(e) => t.onChange(e.target.checked)} />
            <span className="feature-toggle-text">
              <span className="feature-toggle-label">{t.label}</span>
              <span className="modal-message-secondary">{t.description}</span>
            </span>
          </label>
          <SettingStar id={TOGGLE_SETTING_IDS[t.key]} />
          </div>
        ))}
      </div>
    </div>
  );
}
