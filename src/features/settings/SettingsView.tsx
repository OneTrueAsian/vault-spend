import "../transactions/Rules.css";
import "./SettingsPage.css";
import type { AppSettings, Backup, BackgroundSettings, LivePriceProviderId, LivePriceSettings, Profile, ThemeStyle } from "../../shared/lib/types";
import { RulesManager } from "../transactions/RulesManager";
import { StatementLayoutsSection } from "../statements/StatementLayoutsSection";
import { ProfileProtectionSection } from "../profiles/ProfileProtectionSection";
import { ProtectionLeftovers } from "../profiles/ProtectionLeftovers";
import { MobileSettings } from "../../mobile/MobileSettings";
import { type AppearancePrefs } from "../../shared/lib/themeBootstrap";
import type { Theme } from "../../shared/native/appTypes";
import { HelpLink } from "../../shared/ui/HelpLink";
import { SettingsPage } from "./SettingsPage";
import { CardFeedbackProvider } from "../../shared/ui/CardFeedback";
import { AppearanceSection } from "./AppearanceSection";
import { PrivacySection } from "./PrivacySection";
import { ProfilesSection } from "../profiles/ProfilesSection";
import { DataSection } from "./DataSection";
import { FeatureTogglesSection } from "./FeatureTogglesSection";
import { BackgroundRemindersSection } from "./BackgroundRemindersSection";
import { LivePricesSection } from "../investments/LivePricesSection";
import { AboutSection, IconCreditsSection, ReleaseNotesSection } from "./AboutSections";
import type { SettingsGroupId } from "../../shared/lib/settingsIndex";
import type { Tab } from "../../shared/native/appTypes";

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
