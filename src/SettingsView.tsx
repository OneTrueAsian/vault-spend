import "./Rules.css";
import "./SettingsPage.css";
import { createContext, FormEvent, ReactNode, useContext, useEffect, useRef, useState } from "react";
import { createPortal } from "react-dom";
import { openUrl } from "@tauri-apps/plugin-opener";
import type { AppSettings, Backup, BackgroundSettings, LivePriceProviderId, LivePriceSettings, Profile, ThemeStyle } from "./types";
import { useAutoCancelDelete } from "./useAutoCancelDelete";
import { RulesManager } from "./RulesManager";
import { StatementLayoutsSection } from "./StatementLayoutsSection";
import { CHANGELOG, changelogSections } from "./changelog";
import { ICON_CREDITS, IconPicker, ProfileIcon, isProfileIconKey, PROFILE_ICON_OPTIONS, useDismissOnEscape, type ProfileIconKey } from "./icons";
import { ProfileProtectionSection } from "./ProfileProtectionSection";
import { ProtectionLeftovers } from "./ProtectionLeftovers";
import { ProtectionSetupDialog } from "./ProtectionSetupDialog";
import { getCurrentGeneration } from "./profileUiState";
import { ModalShell } from "./Modal";
import { PasswordForm } from "./PasswordForm";
import { MenuSelect } from "./MenuSelect";
import { formatDisplayDateTime } from "./format";
import { MobileSettings } from "./MobileSettings";
import { DEFAULT_APPEARANCE_PREFS, type AppearancePrefs, type NeonAccent } from "./themeBootstrap";
import type { Theme } from "./appTypes";
import { ThemeSwitch } from "./SidebarControls";
import transparentLightPreview from "./assets/style-previews/transparent-light.webp";
import transparentDarkPreview from "./assets/style-previews/transparent-dark.webp";
import futuristicLightPreview from "./assets/style-previews/futuristic-light.webp";
import futuristicDarkPreview from "./assets/style-previews/futuristic-dark.webp";
import retroLightPreview from "./assets/style-previews/retro-light.webp";
import retroDarkPreview from "./assets/style-previews/retro-dark.webp";
import { HelpLink } from "./HelpLink";
import { MoreInfo } from "./MoreInfo";
import { SettingStar, cardAttr, settingAttr } from "./SettingStar";
import { SettingsPage } from "./SettingsPage";
import type { SettingsGroupId } from "./settingsIndex";
import type { Tab } from "./appTypes";

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

/** The result of an action, shown in the card whose button was clicked. The app still shows its message at the bottom
 * of the window; this copy sits beside the control and is announced to assistive technology. */
type CardFeedback = { owner: string; text: string; kind: string };
const CardFeedbackContext = createContext<{ shown: CardFeedback | null; begin: (owner: string) => void } | null>(null);

export function CardFeedbackProvider({ status, children }: { status: { text: string; kind: string } | null; children: ReactNode }) {
  const [shown, setShown] = useState<CardFeedback | null>(null);
  const waiting = useRef<string | null>(null);
  const seen = useRef(status);
  useEffect(() => {
    if (status === seen.current) return;
    seen.current = status;
    if (!status || !waiting.current) return;
    setShown({ owner: waiting.current, ...status });
    waiting.current = null;
  }, [status]);
  const begin = (owner: string) => {
    waiting.current = owner;
    setShown(null);
  };
  return <CardFeedbackContext.Provider value={{ shown, begin }}>{children}</CardFeedbackContext.Provider>;
}

/** `begin()` marks the card as waiting for its action's result; `<Feedback />` shows it. */
function useCardFeedback(owner: string) {
  const context = useContext(CardFeedbackContext);
  const mine = context?.shown?.owner === owner ? context.shown : null;
  return { begin: () => context?.begin(owner), text: mine?.text ?? "", kind: mine?.kind ?? "" };
}

function Feedback({ text, kind }: { text: string; kind: string }) {
  return (
    <span role="status" className={`settings-feedback${kind === "error" ? " settings-feedback-error" : ""}`}>
      {text}
    </span>
  );
}

/** The path of the data file, wrapping when long, with a Copy path button and its result beside it. */
function CopyablePath({ path }: { path: string | null }) {
  const [result, setResult] = useState("");
  const timer = useRef<number | null>(null);
  useEffect(() => () => { if (timer.current) window.clearTimeout(timer.current); }, []);
  async function copy() {
    if (!path) return;
    try {
      await navigator.clipboard.writeText(path);
      setResult("Path copied");
    } catch {
      setResult("Couldn't copy. Select the path and copy it yourself.");
    }
    if (timer.current) window.clearTimeout(timer.current);
    timer.current = window.setTimeout(() => setResult(""), 4000);
  }
  return (
    <div className="path-row">
      <p className="path-box" style={{ userSelect: "text" }}>
        {path ?? "Loading…"}
      </p>
      <div className="path-copy">
        <button type="button" className="modal-secondary" disabled={!path} onClick={() => void copy()}>
          Copy path
        </button>
        <span role="status" className="settings-feedback">{result}</span>
      </div>
    </div>
  );
}

/** Where the data lives — the first card of Settings' Data group. */
export function DataFileBlock({
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
  const feedback = useCardFeedback("data-file");
  return (
    <div className="card" data-data-file {...cardAttr("data-file")}>
      <div className="card-head">
        <h2 className="reports-section-title">Data file</h2>
        <SettingStar id="data-file" />
      </div>
      <p className="modal-message-secondary">Everything you enter is saved in this file.</p>
      <CopyablePath path={dataFileLocation} />
      <div className="settings-action">
        <button type="button" className="modal-secondary" onClick={() => { feedback.begin(); onRelocateDataFile(); }}>
          Move data file
        </button>
        <p className="modal-message-secondary">
          Switches to a copy of your data in a folder you choose. Your old file is left where it is, untouched.
        </p>
      </div>
      <div className="settings-action">
        <button type="button" className="modal-secondary" onClick={() => { feedback.begin(); onExportDatabase(); }}>
          Export a copy
        </button>
        <p className="modal-message-secondary">
          Saves a full copy of your data to a file you choose. Doesn't change what Vault Spend is using now.{" "}
          <MoreInfo>Good for a backup on another drive, or to bring your data to another computer.</MoreInfo>
        </p>
      </div>
      <div className="settings-action">
        <button type="button" className="modal-secondary" onClick={() => { feedback.begin(); onUseExistingDataFile(); }}>
          Use existing file
        </button>
        <p className="modal-message-secondary">
          Opens a data file you already have. Opens as a new profile next to your current one.{" "}
          <MoreInfo>
            Use it when moving to a new computer, upgrading from an older version that used a different file name, or
            switching back to a file you exported earlier. The file is checked for real account and transaction data
            before it is used. It does the same as Settings → Profiles &amp; security → Profiles → Use existing file.
          </MoreInfo>
        </p>
      </div>
      <Feedback text={feedback.text} kind={feedback.kind} />
    </div>
  );
}

/** Settings' Data group: one card per task, rather than one large card with sub-headings. */
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
  isProtected,
}: {
  dataFileLocation: string | null;
  onRelocateDataFile: () => void;
  onExportDatabase: () => void;
  onUseExistingDataFile: () => void;
  backups: Backup[];
  onCreateBackupNow: () => void;
  onRestoreBackup: (filename: string, password?: string) => void | Promise<void>;
  copyDir: string | null;
  onSetCopyDir: (dir: string | null) => void;
  onBrowseCopyDir: () => void;
  onDownloadSetupTemplate: () => void;
  onImportSetupData: () => void;
  isProtected: boolean;
}) {
  return (
    <>
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
        isProtected={isProtected}
        copyDir={copyDir}
        onSetCopyDir={onSetCopyDir}
        onBrowseCopyDir={onBrowseCopyDir}
      />
      <SetupDataBlock onDownloadSetupTemplate={onDownloadSetupTemplate} onImportSetupData={onImportSetupData} />
    </>
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
  const feedback = useCardFeedback("backup-copy");

  function handleSubmit(e: FormEvent) {
    e.preventDefault();
    if (!draft.trim()) return;
    feedback.begin();
    onSetCopyDir(draft.trim());
  }

  // The typed folder stays until the app has accepted it (a refused folder keeps what was typed, so it can be fixed).
  useEffect(() => {
    setDraft("");
  }, [copyDir]);

  return (
    <div className="card" data-backup-copy {...cardAttr("backup-copy")}>
      <div className="card-head">
        <h2 className="reports-section-title">Second copy</h2>
        <SettingStar id="backup-copy" />
      </div>
      {copyDir ? (
        <>
          <p className="modal-message-secondary">
            Every backup is also copied to <strong data-backup-copy-dir>{copyDir}</strong>.
          </p>
          <div className="backup-copy-actions">
            <button type="button" className="modal-secondary" onClick={() => { feedback.begin(); onBrowse(); }}>
              Change folder
            </button>
            <button type="button" className="modal-secondary" onClick={() => { feedback.begin(); onSetCopyDir(null); }}>
              Stop copying
            </button>
          </div>
        </>
      ) : (
        <>
          <p className="modal-message-secondary">
            Also keep a copy of each backup in another folder, like a cloud folder (OneDrive, Dropbox) or a USB drive.
            Then one failed disk can't take your data and its backups together.
          </p>
          <form className="backup-copy-form" onSubmit={handleSubmit}>
            <input
              className="text-input"
              aria-label="Second backup folder"
              value={draft}
              onChange={(e) => setDraft(e.target.value)}
              placeholder="Folder path, e.g. D:\OneDrive\VaultSpend"
            />
            <button type="button" className="modal-secondary" onClick={() => { feedback.begin(); onBrowse(); }}>
              Browse
            </button>
            <button type="submit" disabled={!draft.trim()}>
              Start copying
            </button>
          </form>
        </>
      )}
      <Feedback text={feedback.text} kind={feedback.kind} />
    </div>
  );
}

/** The backup cards of the Data group: automatic backups, the second-copy folder and the backup history. */
export function BackupsBlock({
  backups,
  onCreateBackupNow,
  onRestoreBackup,
  copyDir,
  onSetCopyDir,
  onBrowseCopyDir,
  isProtected,
}: {
  backups: Backup[];
  onCreateBackupNow: () => void;
  onRestoreBackup: (filename: string, password?: string) => void | Promise<void>;
  copyDir: string | null;
  onSetCopyDir: (dir: string | null) => void;
  onBrowseCopyDir: () => void;
  isProtected: boolean;
}) {
  const feedback = useCardFeedback("backups");
  const [confirmingRestoreFilename, setConfirmingRestoreFilename] = useState<string | null>(null);
  const [passwordRestoreFilename, setPasswordRestoreFilename] = useState<string | null>(null);

  return (
    <>
      <div className="settings-pair">
      <div className="card" {...cardAttr("backups")}>
        <div className="card-head">
          <h2 className="reports-section-title">Automatic backups</h2>
          <SettingStar id="backups" />
        </div>
        <p className="modal-message-secondary">
          Vault Spend backs up once a day when you open it, keeping the most recent 15.
        </p>
        <div className="settings-action settings-action-result">
          <button type="button" onClick={() => { feedback.begin(); onCreateBackupNow(); }}>
            Back up now
          </button>
          <Feedback text={feedback.text} kind={feedback.kind} />
        </div>
      </div>
      <BackupCopySection copyDir={copyDir} onSetCopyDir={onSetCopyDir} onBrowse={onBrowseCopyDir} />
      </div>
      <div className="card" data-backups {...cardAttr("backup-history")}>
        <div className="card-head">
          <h2 className="reports-section-title">Backup history</h2>
          <SettingStar id="backup-history" />
        </div>
        <p className="modal-message-secondary">
          Restoring backs up your current data first, then reloads it. No restart needed.
        </p>
      <table className="ledger">
        <thead>
          <tr>
            <th>Created</th>
            <th className="amount-col">Size</th>
            <th className="actions-col"><span className="sr-only">Actions</span></th>
          </tr>
        </thead>
        <tbody>
          {backups.map((b) => confirmingRestoreFilename === b.filename ? (
            <tr key={b.filename}>
              {/* The confirmation takes the whole row: in the narrow actions cell it wrapped to a few characters a line on small windows. */}
              <td colSpan={3}>
                <div className="backup-restore-confirm">
                  <span className="backup-restore-warning" role="alert">Replace your current data with {b.filename}? Your current data will be backed up first.</span>
                  <span className="backup-restore-actions">
                    <button
                      type="button"
                      className="modal-secondary"
                      autoFocus
                      onClick={() => {
                        setConfirmingRestoreFilename(null);
                        requestAnimationFrame(() => document.querySelector<HTMLElement>(`[data-restore-for="${b.filename}"]`)?.focus());
                      }}
                    >
                      Cancel
                    </button>
                    <button
                      type="button"
                      onClick={() => {
                        setConfirmingRestoreFilename(null);
                        if (isProtected) setPasswordRestoreFilename(b.filename);
                        else void onRestoreBackup(b.filename);
                      }}
                    >
                      Restore
                    </button>
                  </span>
                </div>
              </td>
            </tr>
          ) : (
            <tr key={b.filename}>
              <td className="date-cell">
                {formatDisplayDateTime(b.created_at)}
                <div className="backup-file-label">{b.filename}</div>
              </td>
              <td className="amount-col">{(b.size_bytes / 1024).toFixed(0)} KB</td>
              <td className="actions-col">
                <button type="button" className="modal-secondary" data-restore-for={b.filename} onClick={() => setConfirmingRestoreFilename(b.filename)}>
                  Restore
                </button>
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
      {passwordRestoreFilename && (
        <ModalShell title="Restore password-protected backup" onCancel={() => setPasswordRestoreFilename(null)}>
          <p className="modal-message-secondary">
            Enter the password that protected this backup when it was created. If you changed your password later,
            this may be your old password. Restoring also makes that password current again.
          </p>
          <PasswordForm
            submitLabel="Restore"
            onCancel={() => setPasswordRestoreFilename(null)}
            onSubmit={async (password) => {
              await onRestoreBackup(passwordRestoreFilename, password);
              setPasswordRestoreFilename(null);
            }}
          />
        </ModalShell>
      )}
      </div>
    </>
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
  const savedEnabled = settings?.enabled;
  const savedProvider = settings?.provider;
  useEffect(() => {
    if (savedEnabled === false && savedProvider) setPickerProvider(savedProvider);
  }, [savedEnabled, savedProvider]);

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
    <div className="card" {...cardAttr("live-prices")}>
      <div className="card-head">
        <h2 className="reports-section-title">Live stock prices</h2>
        <SettingStar id="live-prices" />
      </div>
      {settings?.enabled ? (
        <>
          <p className="modal-message-secondary">
            Prices refresh when the app opens and every 2 hours while it stays open —{" "}
            {LIVE_PRICE_PROVIDERS[settings.provider].refreshNote}, {LIVE_PRICE_PROVIDERS[settings.provider].usageNote}.{" "}
            <MoreInfo>New holdings can also fill in their starting price by symbol.</MoreInfo>
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
          <MenuSelect
            ariaLabel="Live price provider"
            value={pickerProvider}
            onChange={(v) => setPickerProvider(v as LivePriceProviderId)}
            options={(Object.keys(LIVE_PRICE_PROVIDERS) as LivePriceProviderId[]).map((id) => ({ value: id, label: LIVE_PRICE_PROVIDERS[id].label }))}
            fill
          />
          <p className="modal-message-secondary">
            Off by default — you edit holding prices yourself on the Investments tab. Add a free{" "}
            {LIVE_PRICE_PROVIDERS[pickerProvider].label} API key to fill in and update prices for you.
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

/** Each style shown as a picture (its Dashboard, captured by tools/capture-style-previews.mjs) in the
 * light or dark the app is showing, with a one-line description. */
const THEME_STYLE_OPTIONS: { id: ThemeStyle; label: string; description: string; previews: { light: string; dark: string } }[] = [
  {
    id: "transparent",
    label: "Default",
    description: "Clean and soft, with see-through panels.",
    previews: { light: transparentLightPreview, dark: transparentDarkPreview },
  },
  {
    id: "futuristic",
    label: "Futuristic",
    description: "Neon colors on dark blue. Pick the glow color below.",
    previews: { light: futuristicLightPreview, dark: futuristicDarkPreview },
  },
  {
    id: "retro",
    label: "Retro",
    description: "Classic gray desktop look with square corners.",
    previews: { light: retroLightPreview, dark: retroDarkPreview },
  },
];

const ACCENT_OPTIONS: { id: NeonAccent; label: string }[] = [
  { id: "cyan", label: "Ion Cyan" },
  { id: "pink", label: "Rebel Pink" },
  { id: "violet", label: "Ultraviolet" },
];

export function AppearanceSection({
  themeStyle,
  onSetThemeStyle,
  appearance,
  onSetAppearance,
  theme,
  onSetTheme,
  resolvedTheme,
}: {
  themeStyle: ThemeStyle;
  onSetThemeStyle: (style: ThemeStyle) => void;
  appearance: AppearancePrefs;
  onSetAppearance: (next: AppearancePrefs) => void;
  theme: Theme;
  onSetTheme: (t: Theme) => void;
  /** The light or dark actually showing, so the pictures match it. */
  resolvedTheme: "light" | "dark";
}) {
  return (
    <div className="card">
      <div className="card-head">
        <h2 className="reports-section-title">Appearance</h2>
      </div>
      <p className="modal-message-secondary">
        Choose how Vault Spend looks. This only changes colors, fonts and shapes, not how the app works.
      </p>
      <div className="appearance-theme" {...settingAttr("theme")}>
        <span className="feature-toggle-label" id="appearance-light-dark">Light or dark</span>
        <ThemeSwitch theme={theme} onSetTheme={onSetTheme} className="view-toggle" labelledBy="appearance-light-dark" />
        <SettingStar id="theme" />
      </div>
      <div className="setting-style" {...settingAttr("style")}>
      <div className="setting-title">
        <span className="feature-toggle-label">Style</span>
        <SettingStar id="style" />
      </div>
      <div className="style-preview-grid" role="radiogroup" aria-label="Style">
        {THEME_STYLE_OPTIONS.map((opt) => (
          <label key={opt.id} className={themeStyle === opt.id ? "style-preview-tile style-preview-tile-checked" : "style-preview-tile"}>
            <input
              type="radio"
              name="theme-style"
              className="style-preview-radio"
              checked={themeStyle === opt.id}
              aria-label={opt.label}
              aria-describedby={`style-description-${opt.id}`}
              onChange={() => onSetThemeStyle(opt.id)}
            />
            <img
              className="style-preview-image"
              src={opt.previews[resolvedTheme]}
              alt={`${opt.label} style preview`}
              width={480}
              height={300}
            />
            <span className="style-preview-name">{opt.label}</span>
            <span className="style-preview-description" id={`style-description-${opt.id}`}>{opt.description}</span>
          </label>
        ))}
      </div>
      </div>
      {themeStyle === "futuristic" && (
        <div className="futuristic-options" data-futuristic-options>
          <span className="feature-toggle-label">Futuristic options</span>
          <div className="accent-choices" role="radiogroup" aria-label="Accent color">
            {ACCENT_OPTIONS.map((opt) => {
              const checked = appearance.accent === opt.id;
              return (
                <label key={opt.id} className={`accent-choice${checked ? " accent-choice-checked" : ""}`}>
                  <input
                    type="radio"
                    name="neon-accent"
                    checked={checked}
                    onChange={() => onSetAppearance({ ...appearance, accent: opt.id })}
                  />
                  <span className={`accent-swatch accent-swatch-${opt.id}`} aria-hidden="true" />
                  {opt.label}
                  {checked && (
                    <span className="accent-check" data-accent-check aria-hidden="true" />
                  )}
                </label>
              );
            })}
          </div>
          <label className="neon-intensity">
            <span className="neon-intensity-head">
              <span>Neon intensity</span>
              <span className="neon-intensity-value">{appearance.intensity}%</span>
            </span>
            <input
              type="range"
              min={0}
              max={100}
              step={5}
              aria-label="Neon intensity"
              value={appearance.intensity}
              onChange={(e) => onSetAppearance({ ...appearance, intensity: Number(e.currentTarget.value) })}
            />
            <span className="modal-message-secondary">
              How strongly the colored glow shows. At 0 the glow is off; text, outlines, and colors that carry
              meaning stay the same.
            </span>
          </label>
          <div>
            <button type="button" className="modal-secondary" onClick={() => onSetAppearance(DEFAULT_APPEARANCE_PREFS)}>
              Reset Futuristic options
            </button>
          </div>
        </div>
      )}
      <div className="setting-row" {...settingAttr("reduce-motion")}>
<label className="feature-toggle-row reduce-motion-row">
        <input
          type="checkbox"
          data-reduce-motion
          checked={appearance.reduceMotion}
          onChange={(e) => onSetAppearance({ ...appearance, reduceMotion: e.currentTarget.checked })}
        />
        <span className="feature-toggle-text">
          <span className="feature-toggle-label">Reduce motion</span>
          <span className="modal-message-secondary">
            Turns off sliding and fading effects in every style. If your computer is set to reduce motion, that is
            always followed too.
          </span>
        </span>
      </label>
<SettingStar id="reduce-motion" />
</div>
    </div>
  );
}

function PrivacySection({ autoHide, onSetAutoHide }: { autoHide: boolean; onSetAutoHide: (autoHide: boolean) => void }) {
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

/** Opt-in: keep Vault Spend running in the system tray so it can remind you
 * about bills while the window is closed. */
function BackgroundRemindersSection({
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
  const feedback = useCardFeedback("setup-data");
  return (
    <div className="card" data-setup-data {...cardAttr("setup-data")}>
      <div className="card-head">
        <h2 className="reports-section-title">Setup data</h2>
        <SettingStar id="setup-data" />
      </div>
      <p className="modal-message-secondary">
        Setting up from scratch? Download the template, fill in your accounts, categories, budgets, goals and holdings,
        then import it in one go.
      </p>
      <div className="settings-actions">
        <button type="button" className="modal-secondary" onClick={() => { feedback.begin(); onDownloadSetupTemplate(); }}>
          Download setup template
        </button>
        <button type="button" onClick={() => { feedback.begin(); onImportSetupData(); }}>
          Import setup data
        </button>
      </div>
      <Feedback text={feedback.text} kind={feedback.kind} />
    </div>
  );
}

const TOGGLE_SETTING_IDS: Record<keyof AppSettings, string> = {
  apply_to_debt_enabled: "apply-to-debt",
  split_purchases_enabled: "split-purchases",
  envelope_caps_enabled: "envelope-caps",
  rollover_enabled: "rollover-unspent",
  auto_link_transfers: "link-transfers",
  safe_to_spend_enabled: "safe-to-spend",
};

function FeatureTogglesSection({
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
    <div className="card" {...cardAttr("release-notes")}>
      <div className="card-head">
        <h2 className="reports-section-title">Release notes</h2>
        <SettingStar id="release-notes" />
      </div>
      <div className="release-notes-list">
        {versions.map((v, i) => (
          <details key={v} className="release-note-entry" open={i === 0}>
            <summary>
              <span>Version {v}</span>
              {v === currentVersion && <span className="release-note-current">Current</span>}
            </summary>
            {changelogSections(CHANGELOG[v]).map(({ heading, notes }) => (
              <section key={heading ?? ""}>
                {heading && <h3 className="modal-changelog-heading">{heading}</h3>}
                <ul className="modal-changelog-list">
                  {notes.map((note, j) => (
                    <li key={j}>{note}</li>
                  ))}
                </ul>
              </section>
            ))}
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
export function IconCreditsSection() {
  return (
    <div className="card" {...cardAttr("icon-credits")}>
      <div className="card-head">
        <h2 className="reports-section-title">Icon credits</h2>
        <SettingStar id="icon-credits" />
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
        <ul className="category-manage-list" style={{ marginTop: 12 }} tabIndex={0} aria-label="Icon credits">
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
    <div className="card" {...cardAttr("about")}>
      <div className="card-head">
        <h2 className="reports-section-title">About Vault Spend</h2>
        <SettingStar id="about" />
      </div>
      <p className="modal-message-secondary">Own your Data, Own your Money!</p>
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
  onProtected,
  livePriceSettings,
  onSetLivePriceApiKey,
  onRefreshLivePrices,
  appSettings,
  onSetApplyToDebtEnabled,
  onSetSplitPurchasesEnabled,
  onSetEnvelopeCapsEnabled,
  onSetRolloverEnabled,
  onSetAutoLinkTransfers,
  onSetSafeToSpendEnabled,
  themeStyle,
  onSetThemeStyle,
  appearance,
  onSetAppearance,
  theme,
  onSetTheme,
  resolvedTheme,
  privacyAutoHide,
  onSetPrivacyAutoHide,
  onDownloadSetupTemplate,
  onImportSetupData,
  backgroundSettings,
  onSetTray,
  onSetAutostart,
  onSendTestReminder,
  showBillNamesInReminders,
  onSetShowBillNamesInReminders,
  categories,
  onRulesApplied,
  onMessage,
  onOpenHelp,
  jumpRequest,
  status = null,
}: {
  /** The app's latest message, so a result can also be shown beside the control that caused it. */
  status?: { text: string; kind: string } | null;
  onDownloadSetupTemplate: () => void;
  onImportSetupData: () => void;
  backgroundSettings: BackgroundSettings | null;
  onSetTray: (enabled: boolean) => void;
  onSetAutostart: (enabled: boolean) => void;
  onSendTestReminder: () => void;
  showBillNamesInReminders: boolean;
  onSetShowBillNamesInReminders: (enabled: boolean) => void;
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
  onRestoreBackup: (filename: string, password?: string) => void | Promise<void>;
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
  /** Protection changed: reload bound owners for the new Store session, retaining Settings. */
  onProtected: () => void;
  livePriceSettings: LivePriceSettings | null;
  onSetLivePriceApiKey: (provider: LivePriceProviderId, apiKey: string | null) => void;
  onRefreshLivePrices: () => void;
  appSettings: AppSettings;
  onSetApplyToDebtEnabled: (enabled: boolean) => void;
  onSetSplitPurchasesEnabled: (enabled: boolean) => void;
  onSetEnvelopeCapsEnabled: (enabled: boolean) => void;
  onSetRolloverEnabled: (enabled: boolean) => void;
  onSetAutoLinkTransfers: (enabled: boolean) => void;
  onSetSafeToSpendEnabled: (enabled: boolean) => void;
  themeStyle: ThemeStyle;
  onSetThemeStyle: (style: ThemeStyle) => void;
  appearance: AppearancePrefs;
  onSetAppearance: (next: AppearancePrefs) => void;
  theme: Theme;
  onSetTheme: (t: Theme) => void;
  resolvedTheme: "light" | "dark";
  /** Opens Help at this page's section (the ? beside the title). */
  onOpenHelp?: (tab: Tab) => void;
  /** Opens a group (a new `nonce` asks again), e.g. "manage profiles" from the profile switcher. */
  jumpRequest?: { group: SettingsGroupId; nonce: number };
}) {
  return (
    <div className="reports-view settings-view">
      <CardFeedbackProvider status={status}>
      <SettingsPage
        title={
          <>
            <div className="view-title-row">
              <h1 className="view-title">Settings</h1>
              {onOpenHelp && <HelpLink tab="settings" onOpen={onOpenHelp} />}
            </div>
            <p className="view-sub">How the app looks, who uses it, and where your data lives.</p>
          </>
        }
        jumpRequest={jumpRequest}
        panels={{
          display: (
            <>
              <AppearanceSection
                themeStyle={themeStyle}
                onSetThemeStyle={onSetThemeStyle}
                appearance={appearance}
                onSetAppearance={onSetAppearance}
                theme={theme}
                onSetTheme={onSetTheme}
                resolvedTheme={resolvedTheme}
              />
              <PrivacySection autoHide={privacyAutoHide} onSetAutoHide={onSetPrivacyAutoHide} />
            </>
          ),
          profiles: (
            <>
              <ProfilesSection
                profiles={profiles}
                onCreateProfile={onCreateProfile}
                onUseExistingDataFile={onUseExistingDataFile}
                onSwitchProfile={onSwitchProfile}
                onRenameProfile={onRenameProfile}
                onSetProfileIcon={onSetProfileIcon}
                onDeleteProfile={onDeleteProfile}
                onProtected={onProtected}
              />
              <ProfileProtectionSection profiles={profiles} onProtected={onProtected} />
              <ProtectionLeftovers profiles={profiles} />
            </>
          ),
          data: (
            <>
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
                isProtected={profiles.find((profile) => profile.is_active)?.is_password_protected ?? false}
              />
              <MobileSettings />
            </>
          ),
          features: (
            <>
              <FeatureTogglesSection
                appSettings={appSettings}
                onSetApplyToDebtEnabled={onSetApplyToDebtEnabled}
                onSetSplitPurchasesEnabled={onSetSplitPurchasesEnabled}
                onSetEnvelopeCapsEnabled={onSetEnvelopeCapsEnabled}
                onSetRolloverEnabled={onSetRolloverEnabled}
                onSetAutoLinkTransfers={onSetAutoLinkTransfers}
                onSetSafeToSpendEnabled={onSetSafeToSpendEnabled}
              />
              <BackgroundRemindersSection
                settings={backgroundSettings}
                onSetTray={onSetTray}
                onSetAutostart={onSetAutostart}
                onSendTest={onSendTestReminder}
                showBillNamesInReminders={showBillNamesInReminders}
                onSetShowBillNamesInReminders={onSetShowBillNamesInReminders}
              />
              <RulesManager categories={categories} onRulesApplied={onRulesApplied} onMessage={onMessage} />
              <StatementLayoutsSection onMessage={onMessage} />
              <LivePricesSection
                settings={livePriceSettings}
                onSetApiKey={onSetLivePriceApiKey}
                onRefreshNow={onRefreshLivePrices}
              />
            </>
          ),
          about: (
            <>
              <ReleaseNotesSection currentVersion={appVersion} />
              <IconCreditsSection />
              <AboutSection />
            </>
          ),
        }}
      />
      </CardFeedbackProvider>
    </div>
  );
}
