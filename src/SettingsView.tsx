import { FormEvent, useEffect, useState } from "react";
import { createPortal } from "react-dom";
import { openUrl } from "@tauri-apps/plugin-opener";
import type { AppSettings, Backup, BackgroundSettings, LivePriceProviderId, LivePriceSettings, Profile, ThemeStyle } from "./types";
import { useAutoCancelDelete } from "./useAutoCancelDelete";
import { RulesManager } from "./RulesManager";
import { CHANGELOG } from "./changelog";
import { ICON_CREDITS, IconPicker, ProfileIcon, isProfileIconKey, PROFILE_ICON_OPTIONS, type ProfileIconKey } from "./icons";

const LIVE_PRICE_PROVIDERS: Record<
  LivePriceProviderId,
  { label: string; signupUrl: string; keyPlaceholder: string; blurb: string; usageNote: string; refreshNote: string }
> = {
  alpha_vantage: {
    label: "Alpha Vantage",
    signupUrl: "https://www.alphavantage.co/support/#api-key",
    keyPlaceholder: "Alpha Vantage API key",
    blurb:
      "Alpha Vantage's free tier is limited to 25 requests/day — plenty for a small portfolio checked a few times a day, tight for a large one refreshed constantly.",
    usageNote: "using your Alpha Vantage API key",
    refreshNote: "one request per distinct symbol you hold",
  },
  finnhub: {
    label: "Finnhub",
    signupUrl: "https://finnhub.io/register",
    keyPlaceholder: "Finnhub API key",
    blurb:
      "Finnhub's free tier allows 60 requests/minute — comfortably more than this app needs at once, so there's no daily cap to track.",
    usageNote: "using your Finnhub API key",
    refreshNote: "one request per distinct symbol you hold",
  },
  twelve_data: {
    label: "Twelve Data",
    signupUrl: "https://twelvedata.com/register",
    keyPlaceholder: "Twelve Data API key",
    blurb: "Twelve Data's free tier is limited to 800 requests/day — plenty for a large portfolio checked often.",
    usageNote: "using your Twelve Data API key",
    refreshNote: "one request per distinct symbol you hold",
  },
  stockdata_org: {
    label: "StockData.org",
    signupUrl: "https://www.stockdata.org/register",
    keyPlaceholder: "StockData.org API key",
    blurb:
      "StockData.org's free tier is limited to 100 requests/day, but each request can price up to 3 symbols at once — a portfolio of 9 symbols costs 3 requests, not 9.",
    usageNote: "using your StockData.org API key",
    refreshNote: "up to 3 symbols priced per request",
  },
};

/** Where the data lives — the first block of Settings' "Data" section. */
function DataFileBlock({
  dataFileLocation,
  onRelocateDataFile,
  onExportDatabase,
  onUseExistingDataFile,
}: {
  dataFileLocation: string | null;
  onRelocateDataFile: () => void;
  onExportDatabase: () => void;
  onUseExistingDataFile: () => void;
}) {
  return (
    <div className="data-block" data-data-file>
      <h3 className="data-subhead">Data file</h3>
      <p className="modal-message-secondary">Data file location</p>
      <p className="path-box" style={{ userSelect: "text" }}>
        {dataFileLocation ?? "Loading…"}
      </p>
      <button type="button" className="modal-secondary" onClick={onRelocateDataFile}>
        Move data file…
      </button>
      <button type="button" className="modal-secondary" onClick={onExportDatabase}>
        Export a copy…
      </button>
      <p className="modal-message-secondary">
        Saves a full copy of your data to a file you choose — for a backup on another drive, or to bring to another
        computer. Doesn't change what Vault Spend is using now.
      </p>
      <button type="button" className="modal-secondary" onClick={onUseExistingDataFile}>
        Use existing file…
      </button>
      <p className="modal-message-secondary">
        Point Vault Spend at a data file you already have — moving to a new computer, upgrading from an older version
        that used a different file name, or switching back to a file you exported earlier. Checked for real
        account/transaction data before being adopted; opens as a new profile alongside your current one (same as
        Settings → Profiles' own "Use existing file…").
      </p>
    </div>
  );
}

/** Settings' single "Data" section: the data file, its backups and the bulk setup
 * tools together, rather than three separate cards. */
function DataSection({
  dataFileLocation,
  onRelocateDataFile,
  onExportDatabase,
  onUseExistingDataFile,
  backups,
  onCreateBackupNow,
  onRestoreBackup,
  copyDir,
  onSetCopyDir,
  onBrowseCopyDir,
  onDownloadSetupTemplate,
  onImportSetupData,
}: {
  dataFileLocation: string | null;
  onRelocateDataFile: () => void;
  onExportDatabase: () => void;
  onUseExistingDataFile: () => void;
  backups: Backup[];
  onCreateBackupNow: () => void;
  onRestoreBackup: (filename: string) => void;
  copyDir: string | null;
  onSetCopyDir: (dir: string | null) => void;
  onBrowseCopyDir: () => void;
  onDownloadSetupTemplate: () => void;
  onImportSetupData: () => void;
}) {
  return (
    <div className="card" data-data-section>
      <div className="card-head">
        <span className="reports-section-title">Data</span>
      </div>
      <DataFileBlock
        dataFileLocation={dataFileLocation}
        onRelocateDataFile={onRelocateDataFile}
        onExportDatabase={onExportDatabase}
        onUseExistingDataFile={onUseExistingDataFile}
      />
      <BackupsBlock
        backups={backups}
        onCreateBackupNow={onCreateBackupNow}
        onRestoreBackup={onRestoreBackup}
        copyDir={copyDir}
        onSetCopyDir={onSetCopyDir}
        onBrowseCopyDir={onBrowseCopyDir}
      />
      <SetupDataBlock onDownloadSetupTemplate={onDownloadSetupTemplate} onImportSetupData={onImportSetupData} />
    </div>
  );
}

/** "Also copy each backup to another folder" — so one dead disk can't take
 * the data and its backups together. Works with any folder, including a
 * cloud-synced one (OneDrive, Dropbox) or a USB drive. */
function BackupCopySection({
  copyDir,
  onSetCopyDir,
  onBrowse,
}: {
  copyDir: string | null;
  onSetCopyDir: (dir: string | null) => void;
  onBrowse: () => void;
}) {
  const [draft, setDraft] = useState("");

  function handleSubmit(e: FormEvent) {
    e.preventDefault();
    if (!draft.trim()) return;
    onSetCopyDir(draft.trim());
    setDraft("");
  }

  return (
    <div className="backup-copy" data-backup-copy>
      <p className="backup-copy-title">Second copy</p>
      {copyDir ? (
        <>
          <p className="modal-message-secondary">
            Every backup is also copied to <strong data-backup-copy-dir>{copyDir}</strong>.
          </p>
          <div className="backup-copy-actions">
            <button type="button" className="modal-secondary" onClick={onBrowse}>
              Change folder…
            </button>
            <button type="button" className="modal-secondary" onClick={() => onSetCopyDir(null)}>
              Stop copying
            </button>
          </div>
        </>
      ) : (
        <>
          <p className="modal-message-secondary">
            Also keep a copy of each backup in another folder — one that syncs to the cloud (OneDrive, Dropbox) or a USB
            drive — so one failed disk can't take your data and its backups together.
          </p>
          <form className="backup-copy-form" onSubmit={handleSubmit}>
            <input
              className="text-input"
              aria-label="Second backup folder"
              value={draft}
              onChange={(e) => setDraft(e.target.value)}
              placeholder="Folder path, e.g. D:\OneDrive\VaultSpend"
            />
            <button type="button" className="modal-secondary" onClick={onBrowse}>
              Browse…
            </button>
            <button type="submit" disabled={!draft.trim()}>
              Start copying
            </button>
          </form>
        </>
      )}
    </div>
  );
}

/** The backup list and second-copy folder — the second block of the "Data" section. */
function BackupsBlock({
  backups,
  onCreateBackupNow,
  onRestoreBackup,
  copyDir,
  onSetCopyDir,
  onBrowseCopyDir,
}: {
  backups: Backup[];
  onCreateBackupNow: () => void;
  onRestoreBackup: (filename: string) => void;
  copyDir: string | null;
  onSetCopyDir: (dir: string | null) => void;
  onBrowseCopyDir: () => void;
}) {
  const [confirmingRestoreFilename, setConfirmingRestoreFilename] = useState<string | null>(null);

  return (
    <div className="data-block" data-backups>
      <div className="data-subhead-row">
        <h3 className="data-subhead">Backups</h3>
        <button type="button" className="modal-secondary" onClick={onCreateBackupNow}>
          Back up now
        </button>
      </div>
      <p className="modal-message-secondary">
        Vault Spend backs up automatically once a day when you open it, keeping the most recent 15. Restoring backs
        up your current data first, then reloads it — no restart needed.
      </p>
      <BackupCopySection copyDir={copyDir} onSetCopyDir={onSetCopyDir} onBrowse={onBrowseCopyDir} />
      <table className="ledger">
        <thead>
          <tr>
            <th>Created</th>
            <th className="amount-col">Size</th>
            <th className="actions-col"></th>
          </tr>
        </thead>
        <tbody>
          {backups.map((b) => (
            <tr key={b.filename}>
              <td>{b.created_at}</td>
              <td className="amount-col">{(b.size_bytes / 1024).toFixed(0)} KB</td>
              <td className="actions-col">
                {confirmingRestoreFilename === b.filename ? (
                  <span className="row-delete-confirm">
                    <button type="button" className="modal-secondary" onClick={() => setConfirmingRestoreFilename(null)}>
                      Cancel
                    </button>
                    <button
                      type="button"
                      onClick={() => {
                        onRestoreBackup(b.filename);
                        setConfirmingRestoreFilename(null);
                      }}
                    >
                      Restore
                    </button>
                  </span>
                ) : (
                  <button type="button" className="modal-secondary" onClick={() => setConfirmingRestoreFilename(b.filename)}>
                    Restore
                  </button>
                )}
              </td>
            </tr>
          ))}
          {backups.length === 0 && (
            <tr>
              <td colSpan={3} className="empty-state">
                No backups yet.
              </td>
            </tr>
          )}
        </tbody>
      </table>
    </div>
  );
}

function LivePricesSection({
  settings,
  onSetApiKey,
  onRefreshNow,
}: {
  settings: LivePriceSettings | null;
  onSetApiKey: (provider: LivePriceProviderId, apiKey: string | null) => void;
  onRefreshNow: () => void;
}) {
  const [apiKeyInput, setApiKeyInput] = useState("");
  const [pickerProvider, setPickerProvider] = useState<LivePriceProviderId>(settings?.provider ?? "alpha_vantage");

  // Keep the picker in sync with the last-saved provider whenever the
  // feature is off, so re-opening Settings pre-selects what was last used
  // rather than always resetting to Alpha Vantage.
  useEffect(() => {
    if (settings && !settings.enabled) setPickerProvider(settings.provider);
  }, [settings?.enabled, settings?.provider]);

  function handleSave(e: FormEvent) {
    e.preventDefault();
    const trimmed = apiKeyInput.trim();
    if (!trimmed) return;
    onSetApiKey(pickerProvider, trimmed);
    setApiKeyInput("");
  }

  const used = settings?.requests_used_today ?? 0;
  const limit = settings?.requests_limit ?? null;
  const atLimit = limit != null && used >= limit;
  // "Approaching" starts 5 requests before the cutoff — early enough to be
  // a heads-up, not just a surprise the moment it's already too late.
  const approachingLimit = limit != null && !atLimit && used >= limit - 5;

  return (
    <div className="card">
      <div className="card-head">
        <span className="reports-section-title">Live stock prices</span>
      </div>
      {settings?.enabled ? (
        <>
          <p className="modal-message-secondary">
            Prices refresh automatically when the app opens, and every 2 hours while it stays open —{" "}
            {LIVE_PRICE_PROVIDERS[settings.provider].refreshNote}, {LIVE_PRICE_PROVIDERS[settings.provider].usageNote}.
            New holdings can also auto-fill their starting price by symbol.
          </p>
          <p className="modal-message-secondary">
            Last refreshed: {settings.last_refreshed_at ?? "not yet — click Refresh now below"}
          </p>
          {limit != null ? (
            <p
              className={
                atLimit ? "live-price-usage live-price-usage-limit"
                : approachingLimit ? "live-price-usage live-price-usage-warning"
                : "live-price-usage"
              }
            >
              {atLimit
                ? `Daily limit reached (${used}/${limit}) — refreshes and autofill are paused until tomorrow.`
                : approachingLimit
                  ? `${used} of ${limit} requests used today — getting close to the daily limit.`
                  : `${used} of ${limit} requests used today.`}
            </p>
          ) : (
            <p className="modal-message-secondary">
              {used} request{used === 1 ? "" : "s"} used today — Finnhub's free tier allows 60 requests/minute, so
              there's no daily cap to track.
            </p>
          )}
          <div className="category-manage-actions">
            <button type="button" className="modal-secondary" onClick={onRefreshNow} disabled={atLimit}>
              Refresh now
            </button>
            <button type="button" className="modal-secondary" onClick={() => onSetApiKey(settings.provider, null)}>
              Disable
            </button>
          </div>
        </>
      ) : (
        <>
          <select
            aria-label="Live price provider"
            className="row-edit-input"
            value={pickerProvider}
            onChange={(e) => setPickerProvider(e.target.value as LivePriceProviderId)}
          >
            {(Object.keys(LIVE_PRICE_PROVIDERS) as LivePriceProviderId[]).map((id) => (
              <option key={id} value={id}>
                {LIVE_PRICE_PROVIDERS[id].label}
              </option>
            ))}
          </select>
          <p className="modal-message-secondary">
            Off by default — holding prices stay fully manual, edited directly on the Investments tab. Add a free{" "}
            {LIVE_PRICE_PROVIDERS[pickerProvider].label} API key to auto-fill prices for new holdings and keep
            existing ones current.
          </p>
          <p className="modal-message-secondary">{LIVE_PRICE_PROVIDERS[pickerProvider].blurb}</p>
          <button
            type="button"
            className="modal-secondary"
            onClick={() => openUrl(LIVE_PRICE_PROVIDERS[pickerProvider].signupUrl)}
          >
            Get a free API key →
          </button>
          <form className="category-create-form" onSubmit={handleSave}>
            <input
              type="password"
              value={apiKeyInput}
              onChange={(e) => setApiKeyInput(e.target.value)}
              placeholder={LIVE_PRICE_PROVIDERS[pickerProvider].keyPlaceholder}
            />
            <button type="submit" disabled={!apiKeyInput.trim()}>
              Save
            </button>
          </form>
        </>
      )}
    </div>
  );
}

const THEME_STYLE_OPTIONS: { id: ThemeStyle; label: string; description: string }[] = [
  {
    id: "classic",
    label: "Slate",
    description: "Vault Spend's default look, following the header's Light/Dark/System toggle.",
  },
  {
    id: "futuristic",
    label: "Futuristic",
    description:
      "A neon cyberpunk reskin — electric cyan, violet, and magenta-red accents, plus Orbitron and Share Tech Mono type, and its own angular sidebar icon set. Also follows the header's Light/Dark/System toggle.",
  },
  {
    id: "transparent",
    label: "Transparent",
    description:
      "A frosted-glass reskin — translucent, blurred sidebar and cards, pill-shaped buttons, and a soft glass highlight behind the active nav item. Also follows the header's Light/Dark/System toggle.",
  },
];

function AppearanceSection({
  themeStyle,
  onSetThemeStyle,
}: {
  themeStyle: ThemeStyle;
  onSetThemeStyle: (style: ThemeStyle) => void;
}) {
  return (
    <div className="card">
      <div className="card-head">
        <span className="reports-section-title">Appearance</span>
      </div>
      <p className="modal-message-secondary">
        Choose Vault Spend's visual theme. This only changes colors, fonts, and shapes — nothing about how the app
        works.
      </p>
      <div className="feature-toggle-list" role="radiogroup" aria-label="Theme">
        {THEME_STYLE_OPTIONS.map((opt) => (
          <label key={opt.id} className="feature-toggle-row">
            <input
              type="radio"
              name="theme-style"
              checked={themeStyle === opt.id}
              onChange={() => onSetThemeStyle(opt.id)}
            />
            <span className="feature-toggle-text">
              <span className="feature-toggle-label">{opt.label}</span>
              <span className="modal-message-secondary">{opt.description}</span>
            </span>
          </label>
        ))}
      </div>
    </div>
  );
}

function PrivacySection({ autoHide, onSetAutoHide }: { autoHide: boolean; onSetAutoHide: (autoHide: boolean) => void }) {
  return (
    <div className="card">
      <div className="card-head">
        <span className="reports-section-title">Privacy</span>
      </div>
      <p className="modal-message-secondary">
        The header's "Hide amounts" button covers every dollar figure on screen with ••••, so you can open Vault Spend
        with someone next to you. It hides the numbers, not the charts' shapes.
      </p>
      <div className="feature-toggle-list">
        <label className="feature-toggle-row">
          <input type="checkbox" checked={autoHide} onChange={(e) => onSetAutoHide(e.target.checked)} data-privacy-autohide />
          <span className="feature-toggle-text">
            <span className="feature-toggle-label">Also hide amounts when this window isn't in front</span>
            <span className="modal-message-secondary">
              Switch to another program and your figures are covered until you come back.
            </span>
          </span>
        </label>
      </div>
    </div>
  );
}

/** Opt-in: keep Vault Spend running in the system tray so it can remind you
 * about bills while the window is closed. */
function BackgroundRemindersSection({
  settings,
  onSetTray,
  onSetAutostart,
  onSendTest,
}: {
  settings: BackgroundSettings | null;
  onSetTray: (enabled: boolean) => void;
  onSetAutostart: (enabled: boolean) => void;
  onSendTest: () => void;
}) {
  if (!settings) return null;
  return (
    <div className="card" data-background-reminders>
      <div className="card-head">
        <span className="reports-section-title">Background reminders</span>
        <button type="button" className="modal-secondary" onClick={onSendTest} data-test-reminder>
          Send a test reminder
        </button>
      </div>
      <p className="modal-message-secondary">
        Off by default. Reminders normally only appear while Vault Spend is open; turn this on and it stays in the system tray
        after you close the window, reminding you about bills due in the next 3 days.
      </p>
      <div className="feature-toggle-list">
        <label className="feature-toggle-row">
          <input type="checkbox" checked={settings.tray_enabled} onChange={(e) => onSetTray(e.target.checked)} data-tray-toggle />
          <span className="feature-toggle-text">
            <span className="feature-toggle-label">Keep Vault Spend running in the tray</span>
            <span className="modal-message-secondary">
              Closing the window hides it instead of quitting. Use the tray icon's menu to open it again or to quit.
            </span>
          </span>
        </label>
        {settings.autostart_supported && (
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
        )}
      </div>
    </div>
  );
}

/** Bulk setup: fill in a spreadsheet template with accounts, categories,
 * budgets, goals and holdings, then import it — moved here from Reports, which
 * is now only for reading your numbers. The third block of the "Data" section. */
function SetupDataBlock({
  onDownloadSetupTemplate,
  onImportSetupData,
}: {
  onDownloadSetupTemplate: () => void;
  onImportSetupData: () => void;
}) {
  return (
    <div className="data-block" data-setup-data>
      <h3 className="data-subhead">Setup data</h3>
      <p className="modal-message-secondary">
        Setting up from scratch? Download the template, fill in your accounts, categories, budgets, goals and holdings,
        then import it in one go.
      </p>
      <div className="page-actions">
        <button type="button" className="modal-secondary" onClick={onDownloadSetupTemplate}>
          Download setup template…
        </button>
        <button type="button" className="modal-secondary" onClick={onImportSetupData}>
          Import setup data…
        </button>
      </div>
    </div>
  );
}

function FeatureTogglesSection({
  appSettings,
  onSetApplyToDebtEnabled,
  onSetSplitPurchasesEnabled,
  onSetEnvelopeCapsEnabled,
  onSetRolloverEnabled,
}: {
  appSettings: AppSettings;
  onSetApplyToDebtEnabled: (enabled: boolean) => void;
  onSetSplitPurchasesEnabled: (enabled: boolean) => void;
  onSetEnvelopeCapsEnabled: (enabled: boolean) => void;
  onSetRolloverEnabled: (enabled: boolean) => void;
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
      description: 'Shows the "Cap" checkbox on Budget categories, for warning at 90% instead of the default 80%.',
      onChange: onSetEnvelopeCapsEnabled,
    },
    {
      key: "rollover_enabled",
      label: "Rollover unspent",
      description:
        'Lets a Budget category carry what it didn\'t spend into next month (the "Roll over unspent" checkbox on each line). Off: nothing rolls over, and each category\'s choice is remembered for when you turn it back on.',
      onChange: onSetRolloverEnabled,
    },
  ];

  return (
    <div className="card">
      <div className="card-head">
        <span className="reports-section-title">Feature toggles</span>
      </div>
      <p className="modal-message-secondary">
        Turn a feature off to hide it everywhere it appears. Nothing it already stored is lost — turning it back on
        picks up right where it left off.
      </p>
      <div className="feature-toggle-list">
        {toggles.map((t) => (
          <label key={t.key} className="feature-toggle-row">
            <input type="checkbox" checked={appSettings[t.key]} onChange={(e) => t.onChange(e.target.checked)} />
            <span className="feature-toggle-text">
              <span className="feature-toggle-label">{t.label}</span>
              <span className="modal-message-secondary">{t.description}</span>
            </span>
          </label>
        ))}
      </div>
    </div>
  );
}

/** `ManageCategoriesDialog`'s inline `.icon-picker-popover` positions itself
 * `absolute` against its own row — fine inside a plain `<ul>`, but the
 * Profiles table below is a `.ledger`, which clips overflow to keep its
 * corners rounded, so an absolutely-positioned popover taller than one row
 * gets silently clipped away instead of showing. Portaling it to
 * `document.body` and positioning it `fixed` against the swatch's own
 * on-screen rect sidesteps that clipping entirely without touching
 * `.ledger`'s shared styling (used by every other table in the app). */
function ProfileIconPopover({ anchorRect, onClose, children }: { anchorRect: DOMRect; onClose: () => void; children: React.ReactNode }) {
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

function ProfilesSection({
  profiles,
  onCreateProfile,
  onUseExistingDataFile,
  onSwitchProfile,
  onRenameProfile,
  onSetProfileIcon,
  onDeleteProfile,
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
}) {
  const [newProfileName, setNewProfileName] = useState("");
  const [editingId, setEditingId] = useState<string | null>(null);
  const [draftName, setDraftName] = useState("");
  const [confirmingDeleteId, setConfirmingDeleteId] = useState<string | null>(null);
  useAutoCancelDelete(confirmingDeleteId, () => setConfirmingDeleteId(null));
  const [editingIcon, setEditingIcon] = useState<{ id: string; anchorRect: DOMRect } | null>(null);

  function handleCreateSubmit(e: FormEvent) {
    e.preventDefault();
    const trimmed = newProfileName.trim();
    if (!trimmed) return;
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
    <div className="card">
      <div className="card-head">
        <span className="reports-section-title">Profiles</span>
      </div>
      <p className="modal-message-secondary">
        Each profile is a completely separate, independent data file — switching loads a different set of accounts,
        transactions, and everything else. Nothing is shared between profiles.
      </p>
      <table className="ledger">
        <thead>
          <tr>
            <th></th>
            <th>Name</th>
            <th className="actions-col"></th>
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
      <form className="category-create-form" onSubmit={handleCreateSubmit}>
        <input
          value={newProfileName}
          onChange={(e) => setNewProfileName(e.target.value)}
          placeholder='New profile, e.g. "Alex"'
        />
        <button type="submit" disabled={!newProfileName.trim()}>
          New profile…
        </button>
        <button type="button" className="modal-secondary" onClick={onUseExistingDataFile}>
          Use existing file…
        </button>
      </form>
      <p className="modal-message-secondary">
        Moving to a new computer, or upgrading from an older version that used a different data file name? "Use
        existing file…" points Vault Spend at a data file you've already got, instead of starting empty. It's
        checked for real account/transaction data before being adopted — a file that isn't actually a Vault Spend
        database is rejected with a clear reason.
      </p>
    </div>
  );
}

/** Every released version's notes, newest first — the persistent
 * counterpart to `WhatsNewDialog` (App.tsx), which only ever shows the one
 * version a viewer just updated to, once, then never again. Reuses the
 * same `CHANGELOG` data (`changelog.ts`) rather than a second copy, so
 * cutting a release only ever means adding one entry there. `Object.keys`
 * preserves insertion order for string keys, and `CHANGELOG`'s entries are
 * already written oldest-first, so reversing it is enough — no real
 * version-number parsing needed. */
function ReleaseNotesSection({ currentVersion }: { currentVersion: string | null }) {
  const versions = Object.keys(CHANGELOG).reverse();
  if (versions.length === 0) return null;

  return (
    <div className="card">
      <div className="card-head">
        <span className="reports-section-title">Release notes</span>
      </div>
      <div className="release-notes-list">
        {versions.map((v, i) => (
          <details key={v} className="release-note-entry" open={i === 0}>
            <summary>
              <span>Version {v}</span>
              {v === currentVersion && <span className="release-note-current">Current</span>}
            </summary>
            <ul className="modal-changelog-list">
              {CHANGELOG[v].map((note, j) => (
                <li key={j}>{note}</li>
              ))}
            </ul>
          </details>
        ))}
      </div>
    </div>
  );
}

/** Attribution for the bundled Noun Project icons (src/assets/icons/,
 * see icons/nounIcons.ts) used for several account, category, and bucket
 * icons — each one is licensed CC BY 3.0, which requires crediting the
 * work and its creator. */
function IconCreditsSection() {
  return (
    <div className="card">
      <div className="card-head">
        <span className="reports-section-title">Icon credits</span>
      </div>
      <p className="modal-message-secondary">
        Several account, category, and goal icons are from The Noun Project, used under CC BY 3.0 — credited to
        their creators below.
      </p>
      <button
        type="button"
        className="modal-secondary"
        onClick={() => openUrl("https://creativecommons.org/licenses/by/3.0/")}
      >
        View CC BY 3.0 license →
      </button>
      <details className="icon-credits-disclosure" style={{ marginTop: 12 }}>
        <summary>Show all {ICON_CREDITS.length} credits</summary>
        <ul className="category-manage-list" style={{ marginTop: 12 }}>
          {ICON_CREDITS.map((c) => (
            <li key={c.name} className="category-manage-row">
              <span className="category-manage-name">
                {c.description} <span className="modal-message-secondary">(Noun Project ID {c.nounProjectId})</span>
              </span>
              <span className="account-col">{c.author}</span>
            </li>
          ))}
        </ul>
      </details>
    </div>
  );
}

/** Non-affiliation disclaimer — Vault Spend is an independent, unaffiliated
 * project, and given the crowded "vault"-themed naming space in personal
 * finance software, saying so plainly heads off any appearance of trading
 * on someone else's brand. */
function AboutSection() {
  return (
    <div className="card">
      <div className="card-head">
        <span className="reports-section-title">About</span>
      </div>
      <p className="modal-message-secondary">
        Vault Spend is an independent open-source project and is not affiliated with, endorsed by, or partnered with
        any external financial services or wallet providers.
      </p>
    </div>
  );
}

export function SettingsView({
  appVersion,
  dataFileLocation,
  onRelocateDataFile,
  onExportDatabase,
  backups,
  onCreateBackupNow,
  onRestoreBackup,
  backupCopyDir,
  onSetBackupCopyDir,
  onBrowseBackupCopyDir,
  profiles,
  onCreateProfile,
  onUseExistingDataFile,
  onSwitchProfile,
  onRenameProfile,
  onSetProfileIcon,
  onDeleteProfile,
  livePriceSettings,
  onSetLivePriceApiKey,
  onRefreshLivePrices,
  appSettings,
  onSetApplyToDebtEnabled,
  onSetSplitPurchasesEnabled,
  onSetEnvelopeCapsEnabled,
  onSetRolloverEnabled,
  themeStyle,
  onSetThemeStyle,
  privacyAutoHide,
  onSetPrivacyAutoHide,
  onDownloadSetupTemplate,
  onImportSetupData,
  backgroundSettings,
  onSetTray,
  onSetAutostart,
  onSendTestReminder,
  categories,
  onRulesApplied,
  onMessage,
}: {
  onDownloadSetupTemplate: () => void;
  onImportSetupData: () => void;
  backgroundSettings: BackgroundSettings | null;
  onSetTray: (enabled: boolean) => void;
  onSetAutostart: (enabled: boolean) => void;
  onSendTestReminder: () => void;
  privacyAutoHide: boolean;
  onSetPrivacyAutoHide: (autoHide: boolean) => void;
  categories: string[];
  /** A saved rule re-categorized existing transactions — reload them. */
  onRulesApplied: () => void;
  onMessage: (text: string, kind: "success" | "error" | "info") => void;
  appVersion: string | null;
  dataFileLocation: string | null;
  onRelocateDataFile: () => void;
  onExportDatabase: () => void;
  backups: Backup[];
  onCreateBackupNow: () => void;
  onRestoreBackup: (filename: string) => void;
  backupCopyDir: string | null;
  onSetBackupCopyDir: (dir: string | null) => void;
  onBrowseBackupCopyDir: () => void;
  profiles: Profile[];
  onCreateProfile: (name: string) => void;
  onUseExistingDataFile: () => void;
  onSwitchProfile: (id: string) => void;
  onRenameProfile: (id: string, newName: string) => void;
  onSetProfileIcon: (id: string, iconKey: string | null) => void;
  onDeleteProfile: (id: string) => void;
  livePriceSettings: LivePriceSettings | null;
  onSetLivePriceApiKey: (provider: LivePriceProviderId, apiKey: string | null) => void;
  onRefreshLivePrices: () => void;
  appSettings: AppSettings;
  onSetApplyToDebtEnabled: (enabled: boolean) => void;
  onSetSplitPurchasesEnabled: (enabled: boolean) => void;
  onSetEnvelopeCapsEnabled: (enabled: boolean) => void;
  onSetRolloverEnabled: (enabled: boolean) => void;
  themeStyle: ThemeStyle;
  onSetThemeStyle: (style: ThemeStyle) => void;
}) {
  return (
    <div className="reports-view">
      <div className="page-top">
        <div>
          <h1 className="view-title">Settings</h1>
          <p className="view-sub">Appearance, profile, and local data.</p>
        </div>
      </div>
      <AppearanceSection themeStyle={themeStyle} onSetThemeStyle={onSetThemeStyle} />
      <PrivacySection autoHide={privacyAutoHide} onSetAutoHide={onSetPrivacyAutoHide} />
      <ProfilesSection
        profiles={profiles}
        onCreateProfile={onCreateProfile}
        onUseExistingDataFile={onUseExistingDataFile}
        onSwitchProfile={onSwitchProfile}
        onRenameProfile={onRenameProfile}
        onSetProfileIcon={onSetProfileIcon}
        onDeleteProfile={onDeleteProfile}
      />
      <DataSection
        dataFileLocation={dataFileLocation}
        onRelocateDataFile={onRelocateDataFile}
        onExportDatabase={onExportDatabase}
        onUseExistingDataFile={onUseExistingDataFile}
        backups={backups}
        onCreateBackupNow={onCreateBackupNow}
        onRestoreBackup={onRestoreBackup}
        copyDir={backupCopyDir}
        onSetCopyDir={onSetBackupCopyDir}
        onBrowseCopyDir={onBrowseBackupCopyDir}
        onDownloadSetupTemplate={onDownloadSetupTemplate}
        onImportSetupData={onImportSetupData}
      />
      <BackgroundRemindersSection
        settings={backgroundSettings}
        onSetTray={onSetTray}
        onSetAutostart={onSetAutostart}
        onSendTest={onSendTestReminder}
      />
      <LivePricesSection
        settings={livePriceSettings}
        onSetApiKey={onSetLivePriceApiKey}
        onRefreshNow={onRefreshLivePrices}
      />
      <FeatureTogglesSection
        appSettings={appSettings}
        onSetApplyToDebtEnabled={onSetApplyToDebtEnabled}
        onSetSplitPurchasesEnabled={onSetSplitPurchasesEnabled}
        onSetEnvelopeCapsEnabled={onSetEnvelopeCapsEnabled}
        onSetRolloverEnabled={onSetRolloverEnabled}
      />
      <RulesManager categories={categories} onRulesApplied={onRulesApplied} onMessage={onMessage} />
      <ReleaseNotesSection currentVersion={appVersion} />
      <IconCreditsSection />
      <AboutSection />
    </div>
  );
}
