import { useFinancialRead } from "./useFinancialRead";
import { FinancialReadState } from "./FinancialReadState";
import type { BudgetSnapshot } from "./financialContracts";
import { captureManualLockGeneration, useManualProfileLock } from "./useManualProfileLock";
// Eager stylesheet modules keep the original cascade and prevent lazy views from reloading base rules.
import "./App.css";
import "./AppShell.css";
import "./SharedButtons.css";
import "./SharedCards.css";
import "./AccountsCards.css";
import "./BudgetAndGoals.css";
import "./DashboardCards.css";
import "./Ledger.css";
import "./Rules.css";
import "./FirstRunChecklist.css";
import "./Modal.css";
import "./AppResponsive.css";
import "./CashFlowCharts.css";
import "./AccumulationSection.css";
import "./LaunchErrorScreen.css";
import "./ProfileAccess.css";
import "./ProtectionSetupDialog.css";
import "./SharedControls.css";
import "./AppliedPaymentDetails.css";
import "./LegalNotice.css";
import "./MenuSelect.css";
import "./themes/retro.css";
import "./themes/futuristic.css";
import { LedgerSavedFilters } from "./LedgerSavedFilters";
import { useTransactionsLedger } from "./useTransactionsLedger";
import { recordTransactionPerf } from "./transactionPerf";
import { TransactionReadState } from "./TransactionReadState";
import { useTransactionData } from "./useTransactionData";
import { useTransactionTransfers } from "./useTransactionTransfers";
import { useTransactionBulkActions } from "./useTransactionBulkActions";
import { useTransactionRowActions } from "./useTransactionRowActions";
import { LedgerTable } from "./LedgerTable";
import { LedgerNeedsCategory } from "./LedgerNeedsCategory";
import { SidebarControls } from "./SidebarControls";
import { useResolvedTheme } from "./useResolvedTheme";
import { HelpLink } from "./HelpLink";
import { LedgerPageActions } from "./LedgerPageActions";
import { LedgerBulkActions } from "./LedgerBulkActions";
import { LedgerFilterBar } from "./LedgerFilterBar";
import { SetupImportReviewDialog } from "./SetupImportReviewDialog";
import { RecategorizedReviewPanel } from "./RecategorizedReviewPanel";
import { Suspense, lazy, useCallback, useEffect, useLayoutEffect, useMemo, useRef, useState } from "react";
import { createPortal } from "react-dom";
import { accountTypeLabel, pickDefaultAccountId } from "./accountGroups";
import { invoke } from "@tauri-apps/api/core";
import { getVersion } from "@tauri-apps/api/app";
import { open, save } from "./nativeDialog";
import { isPermissionGranted, requestPermission, sendNotification } from "@tauri-apps/plugin-notification";
import vaultSpendIcon from "./assets/vault-spend-icon-1024.png";
import { createTransactionExporter } from "./transactionExport";
import { toCsv } from "./csv";
import { buildSetupTemplate } from "./setupTemplate";
import { CHANGELOG } from "./changelog";
import {
  THEME_STORAGE_KEY,
  THEME_STYLE_STORAGE_KEY,
  applyAppearancePrefs,
  readStoredAppearancePrefs,
  readThemeStyle,
  saveAppearancePrefs,
  type AppearancePrefs,
} from "./themeBootstrap";
import {
  ModalShell,
  AddWidgetDialog,
  CategoryTransactionsDialog,
  ConfirmInvertDialog,
  CsvExportWarningDialog,
  ManageCategoriesDialog,
  ManageFamilyMembersDialog,
  MonthExpenseDetailDialog,
  NewAccountDialog,
  NewCategoryDialog,
  NewTransactionDialog,
  TransferReviewDialog,
  AutoLinkedReviewDialog,
  ChooseExistingDataSourceDialog,
  SwitchToProtectedProfileDialog,
  UseExistingDataFileDialog,
  WelcomeDialog,
  WhatsNewDialog,
} from "./Modal";
import { TransactionNotesDialog } from "./TransactionNotesDialog";
import { importSignSuggestion, type ImportSignCounts, type ImportSignSuggestion } from "./importSigns";
import {
  DEFAULT_LAYOUT,
  loadDashboardLayout,
  parseWidgetId,
  saveDashboardLayout,
  type WidgetId,
} from "./dashboardLayout";
import { ProfileSwitcher } from "./ProfileSwitcher";
import { MobilePairingPrompt } from "./MobilePairingPrompt";
import { lockCurrentProfile, unlockProfile } from "./protection";
import { hasObservableUnsavedInput } from "./unsavedInput";

import { paymentDisplayIndex } from "./paymentDiscovery";
import { usePaymentSource } from "./usePaymentSource";

import { MonthReviewDialog } from "./MonthReviewDialog";
import { AccountDetailView } from "./AccountDetailView";

import { ImportReviewDialog } from "./ImportReviewDialog";
import { useImportReview } from "./useImportReview";
import { LEDGER_STEPS, ledgerShownLabel, rowsToShowFor, showMoreLabel } from "./ledgerPaging";
import { SELECT_ALL_CAP } from "./ledgerSelection";

import { ImportInboxDialog } from "./ImportInboxDialog";
import { CommandPalette, ShortcutsDialog } from "./CommandPalette";
import type { PaletteEntry } from "./paletteSearch";
import { buildInbox, type InboxItem } from "./importInbox";
import { monthReviewDue } from "./monthReview";
import { loadPrivacyPrefs, savePrivacyPrefs, startPrivacyMask, type PrivacyPrefs } from "./privacy";
// Each tab view is its own chunk, loaded only the first time its tab is
// actually opened, instead of every tab's code shipping in the one
// startup bundle regardless of whether the user ever visits it.
const AccountsView = lazy(() => import("./AccountsView").then((m) => ({ default: m.AccountsView })));
const RecurringView = lazy(() => import("./RecurringView").then((m) => ({ default: m.RecurringView })));
const BucketsView = lazy(() => import("./BucketsView").then((m) => ({ default: m.BucketsView })));
const BudgetView = lazy(() => import("./BudgetView").then((m) => ({ default: m.BudgetView })));
const ReportsView = lazy(() => import("./ReportsView").then((m) => ({ default: m.ReportsView })));
const SettingsView = lazy(() => import("./SettingsView").then((m) => ({ default: m.SettingsView })));
const InvestmentsView = lazy(() => import("./InvestmentsView").then((m) => ({ default: m.InvestmentsView })));
const HouseholdView = lazy(() => import("./HouseholdView").then((m) => ({ default: m.HouseholdView })));
const CashFlowView = lazy(() => import("./CashFlowView").then((m) => ({ default: m.CashFlowView })));
const DashboardView = lazy(() => import("./DashboardView").then((m) => ({ default: m.DashboardView })));
const HelpView = lazy(() => import("./HelpView").then((m) => ({ default: m.HelpView })));

import { UpdateBanner } from "./UpdateBanner";
import { SidebarNav } from "./SidebarNav";
import { useSidebarOverlay } from "./useSidebarOverlay";
import { formatAmount, formatDisplayDate, toLocalIsoDate } from "./format";
import { summarizeLivePriceRefresh } from "./livePriceStatus";
import { useDelayedVisibility } from "./useDelayedVisibility";
import { DataLoading } from "./DataLoading";

import { ensureUiStateMigrated, getCurrentGeneration, getProfileUiState, setProfileUiState } from "./profileUiState";
import type {
  Account,
  AllocationTarget,
  AnomalyFlag,
  BackgroundSettings,
  AppSettings,
  Asset,
  Backup,
  Bucket,
  BudgetAlert,
  BudgetSuggestions,
  CashFlow,
  MonthReview,
  CategoryAmount,
  CategoryIconEntry,
  CategoryTransaction,
  DebtPayoffPlan,
  FamilyMember,
  BillAwareForecast,
  Holding,
  AccountContributionDelta,
  Insight,
  LivePriceProviderId,
  LivePriceRefreshSummary,
  LivePriceSettings,
  MonthExpenseDetail,
  NetWorthPoint,
  Profile,
  PortfolioPoint,
  Recurring,
  RecurringCandidate,
  RecurringMatch,
  RecurringTotals,
  Report,
  MaintenanceSummary,
  SetupImportPreview,
  SetupImportSummary,
  SinkingFundContribution,
  ThemeStyle,
  Transaction,
  YoyCashFlow,
} from "./types";
import { MenuSelect } from "./MenuSelect";
import { errorMessage } from "./errorMessage";
import { sumMoney } from "./money";
import { StatusBanner } from "./StatusBanner";
import { ledgerColumnCount as computeLedgerColumnCount } from "./ledgerHelpers";
import {
  NAV_ORDER_STORAGE_KEY,
  getLastUsedAccountId,
  loadLedgerDensity,
  loadNavOrder,
  setLastUsedAccountId,
  type LedgerDensity,
} from "./appStorage";
import {
  NAV_ITEMS,
  PINNED_NAV_ITEMS,
  UNCATEGORIZED_FILTER,
  type LedgerSortColumn,
  type NewAccountResult,
  type PendingDialog,
  type StatusKind,
  type Tab,
  type Theme,
} from "./appTypes";

const EMPTY_TRANSACTIONS: Transaction[] = [];
const EMPTY_FLAGS: AnomalyFlag[] = [];
const EMPTY_ACCOUNTS: Account[] = [];
const EMPTY_MEMBERS: FamilyMember[] = [];
const EMPTY_STRINGS: string[] = [];
const EMPTY_ICONS: CategoryIconEntry[] = [];

function App({
  initialStatus,
  onDataFileChanged,
}: {
  initialStatus: string;
  /** Called after `relocate_data_file`/`restore_backup` succeeds — the Rust
   * side has already hot-swapped its live connection to the new file (see
   * commands.rs), so all this needs to do is force every piece of frontend
   * state to re-fetch from scratch. The wrapper below does that by
   * remounting this whole component under a fresh `key`, carrying `message`
   * over as the freshly-mounted instance's starting status banner. */
  onDataFileChanged: (message: string) => void;
}) {
  const [activeTab, setActiveTab] = useState<Tab>("dashboard");
  // The page whose ? button opened Help: Help opens that page's section. Cleared once Help is left,
  // so opening Help from the sidebar later starts with every section closed.
  const [helpFocus, setHelpFocus] = useState<Tab | null>(null);
  function openHelpFor(tab: Tab) {
    setHelpFocus(tab);
    setActiveTab("help");
  }
  useEffect(() => {
    if (activeTab !== "help") setHelpFocus(null);
  }, [activeTab]);
  const mainScrollRef = useRef<HTMLDivElement>(null);
  useLayoutEffect(() => {
    mainScrollRef.current?.scrollTo({ top: 0, left: 0, behavior: "instant" });
  }, [activeTab]);
  const [theme, setThemeState] = useState<Theme>(() => {
    try {
      return (localStorage.getItem(THEME_STORAGE_KEY) as Theme | null) ?? "system";
    } catch {
      return "system";
    }
  });
  const [themeStyle, setThemeStyleState] = useState<ThemeStyle>(() => {
    try {
      return readThemeStyle(localStorage.getItem(THEME_STYLE_STORAGE_KEY));
    } catch {
      return readThemeStyle(null);
    }
  });
  const [appearance, setAppearance] = useState<AppearancePrefs>(readStoredAppearancePrefs);
  const [navOrder, setNavOrder] = useState<Tab[]>(loadNavOrder);
  const [dragNavTab, setDragNavTab] = useState<Tab | null>(null);
  // Below 1000px the sidebar shows icons only; "Show names" lays the full sidebar over the page
  // (see useSidebarOverlay for what closes it).
  const sidebarRef = useRef<HTMLElement>(null);
  const {
    expanded: sidebarExpanded,
    setExpanded: setSidebarExpanded,
    iconOnly: sidebarIconOnly,
    handleBlur: handleSidebarBlur,
  } = useSidebarOverlay(sidebarRef);
  const [layoutWidgets, setLayoutWidgetsState] = useState<WidgetId[]>(DEFAULT_LAYOUT);
  // Set once the person changes the layout, so a slow first read of the saved one (it arrives
  // asynchronously after mount) can't land afterwards and undo what they just did.
  const layoutEditedRef = useRef(false);
  const [addWidgetModalOpen, setAddWidgetModalOpen] = useState(false);
  useLayoutEffect(() => { recordTransactionPerf("app-commit"); });
  const transactionData = useTransactionData();
  const { refresh, call: callTransaction, revision: transactionRevision } = transactionData;
  const transactions = transactionData.snapshot?.transactions ?? EMPTY_TRANSACTIONS;
  const anomalyFlags = transactionData.snapshot?.flags ?? EMPTY_FLAGS;
  const accounts = transactionData.snapshot?.accounts ?? EMPTY_ACCOUNTS;
  const familyMembers = transactionData.snapshot?.members ?? EMPTY_MEMBERS;
  const allTags = transactionData.snapshot?.tags ?? EMPTY_STRINGS;
  const usedCategories = transactionData.snapshot?.categories ?? EMPTY_STRINGS;
  const categoryIcons = transactionData.snapshot?.categoryIcons ?? EMPTY_ICONS;
  const stats = transactionData.snapshot?.stats ?? null;
  const dataLoaded = transactionData.snapshot !== null;
  const {
    editingAmount,
    editingDate,
    editingDescription,
    confirmingDeleteId,
    applyingDebtId,
    applyDebtForm,
    editingPrincipalId,
    principalDraft,
    expandedSplitId,
    splitLines,
    newTagText,
    taggingId,
    notesDialogFor,
    setEditingAmount,
    setEditingDate,
    setEditingDescription,
    setConfirmingDeleteId,
    setApplyingDebtId,
    setApplyDebtForm,
    setEditingPrincipalId,
    setPrincipalDraft,
    setExpandedSplitId,
    setNewTagText,
    setTaggingId,
    setNotesDialogFor,
    commitAmountEdit,
    commitDateEdit,
    commitDescriptionEdit,
    handleAccountChangeForTransaction,
    handleMemberChangeForTransaction,
    handleDeleteTransaction,
    startApplyingDebtPayment,
    handleApplyDebtPayment,
    handleUnapplyDebtPayment,
    startEditingPrincipal,
    handleSetPrincipalAmount,
    handleResetPrincipalAmount,
    toggleSplitEditor,
    addSplitLine,
    removeSplitLine,
    updateSplitLine,
    splitRemaining,
    saveSplits,
    clearSplits,
    handleSaveNotes,
    handleAddTag,
    handleRemoveTag,
  } = useTransactionRowActions({ data: transactionData, accounts, categories: usedCategories, onStatus: setStatus });
  const [pendingPaymentId, setPendingPaymentId] = useState<number | null>(null);
  const {
    searchText,
    setSearchText,
    filterCategory,
    setFilterCategory,
    filterAccountIds,
    setFilterAccountIds,
    filterMemberIds,
    setFilterMemberIds,
    filterFrom,
    setFilterFrom,
    filterTo,
    setFilterTo,
    filterTag,
    setFilterTag,
    savedFilters,
    savingFilter,
    setSavingFilter,
    newFilterName,
    setNewFilterName,
    saveCurrentFilter,
    applySavedFilter,
    deleteSavedFilter,
    sortColumn,
    setSortColumn,
    sortDirection,
    setSortDirection,
    pageSize,
    setPageSize,
    shownCount,
    setShownCount,
    selectAllBatch,
    selectAllMessage,
    selectedIds,
    setSelectedIds,
    filteredTransactions,
    sortedTransactions,
    displayTransactions,
    inLegByOutId,
    pagedTransactions,
    shownTransactions,
    selectedPairForLink,
    selectedAccountNames,
    toggleSort,
    toggleSelectedMany,
    toggleSelected,
    toggleSelectAll,
  } = useTransactionsLedger({
    transactions,
    active: activeTab === "ledger",
    pendingPaymentId,
    onSelectionLimit: () => setStatus(`A change can apply to at most ${SELECT_ALL_CAP} transactions at a time.`, "info"),
  });
  const [highlightedPaymentRow, setHighlightedPaymentRow] = useState<number | null>(null);
  const loadPaymentSource = usePaymentSource((source) => {
    setSearchText("");
    setFilterCategory("all");
    setFilterAccountIds("all");
    setFilterMemberIds("all");
    setFilterFrom("");
    setFilterTo("");
    setFilterTag("all");
    setSelectedIds(new Set());
    setPendingPaymentId(source.id);
    setActiveTab("ledger");
    setStatus(`Opened payment from ${source.account_name}.`, "info");
  }, message => setStatus(message, "info"), async () => (await refresh()).transactions);

  function openPayment(sourceId: number) {
    setPendingPaymentId(null);
    setHighlightedPaymentRow(null);
    void loadPaymentSource(sourceId);
  }

  useEffect(() => {
    let cancelled = false;
    ensureUiStateMigrated()
      .catch(() => { }) // best effort — the same treatment every browser-storage read/write here already gets
      .then(() => loadDashboardLayout())
      .then((widgets) => {
        if (!cancelled && !layoutEditedRef.current) setLayoutWidgetsState(widgets);
      });
    return () => {
      cancelled = true;
    };
  }, []);

  // The ledger row whose tag field is open (its ⋯ menu's "Add tag…").

  const [buckets, setBuckets] = useState<Bucket[]>([]);
  const [recurring, setRecurring] = useState<Recurring[]>([]);
  const [recurringMatches, setRecurringMatches] = useState<RecurringMatch[]>([]);
  const [recurringTotals, setRecurringTotals] = useState<RecurringTotals>({
    monthly_expense: "0.00",
    monthly_income: "0.00",
    annual_expense: "0.00",
    annual_income: "0.00",
  });
  const [recurringCandidates, setRecurringCandidates] = useState<RecurringCandidate[]>([]);
  const [holdings, setHoldings] = useState<Holding[]>([]);
  const [portfolioHistory, setPortfolioHistory] = useState<PortfolioPoint[]>([]);
  const [allocationTargets, setAllocationTargets] = useState<AllocationTarget[]>([]);
  const [assets, setAssets] = useState<Asset[]>([]);
  const [dataFileLocation, setDataFileLocation] = useState<string | null>(null);
  const [backups, setBackups] = useState<Backup[]>([]);
  const [profiles, setProfiles] = useState<Profile[]>([]);
  const [livePriceSettings, setLivePriceSettings] = useState<LivePriceSettings | null>(null);
  // Defaults to every feature on (not null) so nothing flashes hidden
  // before this loads — matches how each of these three already behaved
  // before this setting existed.
  const [appSettings, setAppSettings] = useState<AppSettings>({
    apply_to_debt_enabled: true,
    split_purchases_enabled: true,
    envelope_caps_enabled: true,
    rollover_enabled: true,
    auto_link_transfers: false, // the one opt-in switch
    safe_to_spend_enabled: true,
  });
  const [appSettingsLoaded, setAppSettingsLoaded] = useState(false);

  const [backupCopyDir, setBackupCopyDir] = useState<string | null>(null);
  const [backgroundSettings, setBackgroundSettings] = useState<BackgroundSettings | null>(null);
  useEffect(() => {
    invoke<BackgroundSettings>("get_background_settings")
      .then(setBackgroundSettings)
      .catch(() => undefined);
  }, []);
  // Off by default for every profile; only meaningfully different once the profile is protected
  // (decision 9) — shown in Settings unconditionally so the value is already correct if the profile
  // is protected later, rather than hidden and then defaulted for an already-configured profile.
  const [showBillNamesInReminders, setShowBillNamesInReminders] = useState(false);
  useEffect(() => {
    getProfileUiState("show_bill_names_in_reminders")
      .then((v) => setShowBillNamesInReminders(v === "true"))
      .catch(() => undefined);
  }, []);
  async function handleSetShowBillNamesInReminders(enabled: boolean) {
    setShowBillNamesInReminders(enabled);
    try {
      const generation = await getCurrentGeneration();
      await setProfileUiState("show_bill_names_in_reminders", enabled ? "true" : "false", generation);
    } catch (e) {
      setStatus(errorMessage(e));
    }
  }
  const refreshBackups = useCallback(async () => {
    setBackups(await invoke<Backup[]>("list_backups"));
    setBackupCopyDir(await invoke<string | null>("get_backup_copy_dir"));
  }, []);

  const refreshProfiles = useCallback(async () => {
    setProfiles(await invoke<Profile[]>("list_profiles"));
  }, []);

  const refreshDataFileLocation = useCallback(async () => {
    setDataFileLocation(await invoke<string>("get_data_file_location"));
  }, []);

  const refreshLivePriceSettings = useCallback(async () => {
    setLivePriceSettings(await invoke<LivePriceSettings>("get_live_price_settings"));
  }, []);

  const refreshAppSettings = useCallback(async () => {
    const next = await invoke<AppSettings>("get_app_settings");
    setAppSettings(next);
    setAppSettingsLoaded(true);
  }, []);

  useEffect(() => {
    refreshDataFileLocation().catch((e) => setStatus(errorMessage(e)));
    refreshBackups().catch((e) => setStatus(errorMessage(e)));
    refreshProfiles().catch((e) => setStatus(errorMessage(e)));
    refreshLivePriceSettings().catch((e) => setStatus(errorMessage(e)));
    refreshAppSettings().catch((e) => setStatus(errorMessage(e)));
  }, [refreshBackups, refreshProfiles, refreshDataFileLocation, refreshLivePriceSettings, refreshAppSettings]);

  const refreshProtectionState = useCallback(async () => {
    try {
      await Promise.all([refreshProfiles(), refreshDataFileLocation(), refreshBackups()]);
    } catch (e) {
      setStatus(errorMessage(e));
    }
  }, [refreshBackups, refreshDataFileLocation, refreshProfiles]);

  // Once live prices are enabled for the active profile, refresh right away
  // and then every 2 hours for as long as the app stays open. Keyed on
  // `enabled` (not an empty-deps mount effect) so flipping the Settings
  // toggle starts/stops this immediately, and re-runs cleanly on every
  // profile-switch remount — a different profile's own enabled state and
  // 2-hour clock take over automatically.
  const REFRESH_INTERVAL_MS = 2 * 60 * 60 * 1000;
  useEffect(() => {
    if (!livePriceSettings?.enabled) return;
    handleRefreshLivePrices();
    const timer = setInterval(handleRefreshLivePrices, REFRESH_INTERVAL_MS);
    return () => clearInterval(timer);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [livePriceSettings?.enabled]);

  async function handleCreateBackupNow() {
    try {
      const result = await invoke<{ filename: string; copied_to: string | null; copy_error: string | null }>("create_backup_now");
      await refreshBackups();
      if (result.copy_error) {
        setStatus(`Backup created, but the copy to your second folder failed: ${result.copy_error}`, "error");
      } else if (result.copied_to) {
        setStatus(`Backup created and copied to ${result.copied_to}.`, "success");
      } else {
        setStatus("Backup created.", "success");
      }
    } catch (e) {
      setStatus(errorMessage(e));
    }
  }

  async function handleSetBackupCopyDir(dir: string | null) {
    try {
      const message = await invoke<string>("set_backup_copy_dir", { dir });
      await refreshBackups();
      setStatus(message, "success");
    } catch (e) {
      setStatus(errorMessage(e));
    }
  }

  async function handleSetTray(enabled: boolean) {
    try {
      await invoke("set_tray_enabled", { enabled });
      const settings = await invoke<BackgroundSettings>("get_background_settings");
      // Turning the tray off also ends "start at sign-in" — hidden in a tray
      // that isn't there would leave nothing to bring the window back.
      if (!enabled && settings.autostart_enabled) {
        await invoke("set_autostart_enabled", { enabled: false });
        settings.autostart_enabled = false;
      }
      setBackgroundSettings(settings);
      setStatus(enabled ? "Vault Spend will keep running in the tray and remind you about bills." : "Background reminders are off.", "success");
    } catch (e) {
      setStatus(errorMessage(e));
    }
  }

  async function handleSetAutostart(enabled: boolean) {
    try {
      await invoke("set_autostart_enabled", { enabled });
      setBackgroundSettings(await invoke<BackgroundSettings>("get_background_settings"));
    } catch (e) {
      setStatus(errorMessage(e));
    }
  }

  async function handleSendTestReminder() {
    try {
      await invoke("send_test_reminder");
      setStatus("Sent a test reminder — check your notifications.", "info");
    } catch (e) {
      setStatus(errorMessage(e));
    }
  }

  async function handleBrowseBackupCopyDir() {
    try {
      const picked = await open({ directory: true, multiple: false, title: "Choose a folder for the second backup copy" });
      if (typeof picked === "string") await handleSetBackupCopyDir(picked);
    } catch (e) {
      setStatus(errorMessage(e));
    }
  }

  async function handleRestoreBackup(filename: string, password?: string) {
    try {
      const expectedGeneration = await getCurrentGeneration();
      await invoke("restore_backup", { filename, password: password ?? null, expectedGeneration });
      onDataFileChanged(`Restored ${filename} — your prior data was backed up first.`);
    } catch (e) {
      setStatus(errorMessage(e));
      if (password !== undefined) throw e;
    }
  }

  async function handleRelocateDataFile() {
    const dir = await open({ directory: true, multiple: false });
    if (!dir || Array.isArray(dir)) return;
    try {
      const newPath = await invoke<string>("relocate_data_file", { newDir: dir });
      onDataFileChanged(`Data file moved to ${newPath} — your old file was left in place, untouched.`);
    } catch (e) {
      setStatus(errorMessage(e));
    }
  }

  async function handleExportDatabase() {
    const isProtected = profiles.find((profile) => profile.is_active)?.is_password_protected ?? false;
    const path = await save({
      defaultPath: `vaultspend-export-${toLocalIsoDate(new Date())}.${isProtected ? "vaultspend" : "db"}`,
      filters: [
        isProtected
          ? { name: "Vault Spend Protected Package", extensions: ["vaultspend"] }
          : { name: "Vault Spend Database", extensions: ["db"] },
      ],
    });
    if (!path) return;
    try {
      await invoke("export_database", { destination: path });
      setStatus(`Exported a copy to ${path}.`, "success");
    } catch (e) {
      setStatus(errorMessage(e));
    }
  }

  async function handleCreateProfile(name: string) {
    try {
      const created = await invoke<string>("create_profile", { name });
      onDataFileChanged(`Switched to the new "${created}" profile — it starts completely empty.`);
    } catch (e) {
      setStatus(errorMessage(e));
    }
  }

  /** "Use existing file…" step 1: pick the file. Step 2 (naming it) happens
   * in `UseExistingDataFileDialog` once `pendingExistingDbPath` is set —
   * split the same way `handleRelocateDataFile` splits picking a folder
   * from the backend call, except a name has to come from the user first. */
  async function handlePickExistingDataFile() {
    setChoosingExistingSource(true);
  }

  async function handlePickExistingDatabase() {
    const path = await open({ multiple: false, filters: [{ name: "Vault Spend Database", extensions: ["db"] }] });
    if (!path || Array.isArray(path)) return;
    setChoosingExistingSource(false);
    setPendingExistingIsProtected(false);
    // A bare, in-place `.db` can still be encrypted — e.g. a profile removed from the list
    // ("forgot the password? remove it" or a plain Delete) leaves exactly this shape on disk. Ask
    // the backend rather than guessing from the filename, so the dialog knows to show a password
    // field before the person ever hits "Use this file" and gets a confusing refusal.
    let requiresPassword = false;
    try {
      requiresPassword = await invoke<boolean>("path_looks_password_protected", { path });
    } catch {
      /* best effort — worst case the dialog omits the password field and the backend's own
         "That password didn't work for this profile" surfaces if it turns out to be needed */
    }
    setPendingExistingRequiresPassword(requiresPassword);
    setPendingExistingDbPath(path);
  }

  async function handlePickProtectedPackage() {
    const path = await open({ directory: true, multiple: false, title: "Choose a .vaultspend package folder" });
    if (!path || Array.isArray(path)) return;
    setChoosingExistingSource(false);
    setPendingExistingIsProtected(true);
    setPendingExistingRequiresPassword(false);
    setPendingExistingDbPath(path);
  }

  async function handleAddExistingProfile(name: string, password?: string) {
    if (!pendingExistingDbPath) return;
    try {
      const expectedGeneration = await getCurrentGeneration();
      const added = await invoke<string>("add_existing_profile", {
        name,
        dbPath: pendingExistingDbPath,
        password: password ?? null,
        expectedGeneration,
      });
      setPendingExistingDbPath(null);
      setPendingExistingIsProtected(false);
      setPendingExistingRequiresPassword(false);
      onDataFileChanged(`Switched to "${added}".`);
    } catch (e) {
      setStatus(errorMessage(e));
      if (pendingExistingIsProtected || pendingExistingRequiresPassword) throw e;
    }
  }

  async function handleSwitchProfile(id: string) {
    const target = profiles.find((p) => p.id === id);
    if (target?.is_password_protected) {
      setPendingProtectedSwitch({ id, name: target.name });
      return;
    }
    try {
      const switched = await invoke<string>("switch_profile", { id });
      onDataFileChanged(`Switched to "${switched}".`);
    } catch (e) {
      setStatus(errorMessage(e));
    }
  }

  // Locking never disturbs any other profile's data (there is nothing to touch — this just drops
  // the live connection) — StartupGate's own profile-lock-state-changed subscription swaps the
  // screen over to ProfileLockScreen on its own, so there is nothing else to do here afterward.
  const manualLock = useManualProfileLock({
    generation: getCurrentGeneration,
    originGeneration: () => captureManualLockGeneration(profiles.find(profile => profile.is_active)?.id,
      getCurrentGeneration, async () => (await invoke<Profile[]>("list_profiles")).find(profile => profile.is_active)?.id),
    lock: lockCurrentProfile,
    dirty: hasObservableUnsavedInput,
    onError: (error) => setStatus(errorMessage(error)),
  });
  const handleLockProfile = manualLock.start;

  async function handleRenameProfile(id: string, newName: string) {
    try {
      await invoke("rename_profile", { id, newName });
      await refreshProfiles();
    } catch (e) {
      setStatus(errorMessage(e));
    }
  }

  async function handleSetProfileIcon(id: string, iconKey: string | null) {
    try {
      await invoke("set_profile_icon", { id, iconKey });
      await refreshProfiles();
    } catch (e) {
      setStatus(errorMessage(e));
    }
  }

  async function handleDeleteProfile(id: string) {
    try {
      await invoke("delete_profile", { id });
      await refreshProfiles();
    } catch (e) {
      setStatus(errorMessage(e));
    }
  }

  async function handleSetLivePriceApiKey(provider: LivePriceProviderId, apiKey: string | null) {
    try {
      await invoke("set_live_price_settings", { provider, apiKey });
      await refreshLivePriceSettings();
    } catch (e) {
      setStatus(errorMessage(e));
    }
  }

  async function handleSetApplyToDebtEnabled(enabled: boolean) {
    try {
      await invoke("set_apply_to_debt_enabled", { enabled });
      await refreshAppSettings();
    } catch (e) {
      setStatus(errorMessage(e));
    }
  }

  async function handleSetSplitPurchasesEnabled(enabled: boolean) {
    try {
      await invoke("set_split_purchases_enabled", { enabled });
      await refreshAppSettings();
    } catch (e) {
      setStatus(errorMessage(e));
    }
  }

  async function handleSetEnvelopeCapsEnabled(enabled: boolean) {
    try {
      await invoke("set_envelope_caps_enabled", { enabled });
      await refreshAppSettings();
      // The feature's effect on the 90% threshold lives in the backend
      // (see budget_alerts_for_month) — refresh so any already-loaded
      // alerts pick up the change immediately instead of on next nav.
      await refreshBudgetMonthActuals(budgetYear, budgetMonthNum);
    } catch (e) {
      setStatus(errorMessage(e));
    }
  }

  async function handleSetRolloverEnabled(enabled: boolean) {
    try {
      await invoke("set_rollover_enabled", { enabled });
      await refreshAppSettings();
      // What carries into a month is worked out in the backend, and the alerts
      // (and the month review) count it as part of the budget — drop the cached
      // alerts so they're read again against the new setting.
      currentMonthAlertsRef.current = null;
      await refreshBudgetMonthActuals(budgetYear, budgetMonthNum);
    } catch (e) {
      setStatus(errorMessage(e));
    }
  }

  async function handleSetSafeToSpendEnabled(enabled: boolean) {
    try {
      await invoke("set_safe_to_spend_enabled", { enabled });
      await refreshAppSettings();
      if (!enabled) setSafeToSpendForecast(null);
    } catch (e) {
      setStatus(errorMessage(e));
    }
  }

  async function handleSetAutoLinkTransfers(enabled: boolean) {
    try {
      const linkedNow = await invoke<number>("set_auto_link_transfers", { enabled });
      await refreshAppSettings();
      if (!enabled) {
        setStatus("Automatic transfer linking is off. Links already made stay; unlink any from Transactions.", "info");
        return;
      }
      // Turning it on also links the clear-cut pairs already in the ledger.
      await refresh();
      setStatus(
        linkedNow > 0
          ? `Automatic linking is on. ${linkedNow === 1 ? "Linked 1 transfer that was" : `Linked ${linkedNow} transfers that were`} already there — review ${linkedNow === 1 ? "it" : "them"} on Transactions.`
          : "Automatic linking is on. Clear-cut transfers will be linked as they arrive.",
        "success",
      );
    } catch (e) {
      setStatus(errorMessage(e));
    }
  }

  async function handleRefreshLivePrices() {
    try {
      const summary = await invoke<LivePriceRefreshSummary>("refresh_live_prices");
      await Promise.all([refreshHoldings(), refreshLivePriceSettings()]);
      const { text, kind } = summarizeLivePriceRefresh(summary);
      setStatus(text, kind);
    } catch (e) {
      setStatus(errorMessage(e));
    }
  }

  async function handleFetchLiveQuote(symbol: string): Promise<string | null> {
    try {
      return await invoke<string | null>("fetch_live_quote", { symbol });
    } catch {
      return null; // convenience autofill only — swallow errors rather than interrupting the form
    }
  }
  const [report, setReport] = useState<Report | null>(null);
  const [selectedAccountId, setSelectedAccountId] = useState<number | null>(null);
  const [status, setStatusState] = useState<{ text: string; kind: StatusKind } | null>(
    initialStatus ? { text: initialStatus, kind: "success" } : null,
  );
  // Wraps the raw state setter so ~90 existing `setStatus(errorMessage(e))` catch
  // blocks stay one-line error reports (kind defaults to "error" there) while
  // confirmations/in-progress messages opt into "success"/"info" explicitly —
  // see the `.status-*` rules in DashboardCards.css for what each kind looks like.
  function setStatus(text: string, kind: StatusKind = "error") {
    setStatusState(text ? { text, kind } : null);
  }

  // Auto-dismiss the status banner so it doesn't sit there stale forever —
  // resets the clock every time a new message replaces it. Errors stay up
  // longer than a routine confirmation since they're more likely to need
  // actually reading (a raw error string), not just glancing at.
  useEffect(() => {
    if (!status) return;
    const timer = setTimeout(() => setStatusState(null), status.kind === "error" ? 20000 : 10000);
    return () => clearTimeout(timer);
  }, [status]);

  // Shown once per install — a fresh AppData folder (a brand-new install,
  // or someone else's computer) has never set this, so it always appears
  // there; dismissing it either way (including clicking outside the
  // dialog) marks it seen so it never comes back on this machine.
  const WELCOME_SEEN_STORAGE_KEY = "vaultspend-welcome-seen";
  const [showWelcome, setShowWelcome] = useState(() => {
    try {
      return localStorage.getItem(WELCOME_SEEN_STORAGE_KEY) !== "1";
    } catch {
      return false; // storage unavailable — don't block the app with a dialog that can't be dismissed
    }
  });

  function dismissWelcome() {
    setShowWelcome(false);
    try {
      localStorage.setItem(WELCOME_SEEN_STORAGE_KEY, "1");
    } catch {
      // per-viewer preference only — fine to skip if storage is unavailable
    }
  }

  function handleExploreHelpFromWelcome() {
    dismissWelcome();
    setActiveTab("help");
  }

  // Shown once per version — both on a true first install and after every
  // update, since `lastSeenVersion` starts out unset either way. Compared
  // against the actual installed version (`getVersion()`, from
  // tauri.conf.json), not the frontend bundle's own notion of its version,
  // so it reflects what's really running. Nothing shows if this version
  // has no CHANGELOG entry yet.
  const LAST_SEEN_VERSION_KEY = "vaultspend-last-seen-version";
  const [appVersion, setAppVersion] = useState<string | null>(null);
  const [whatsNewVersion, setWhatsNewVersion] = useState<string | null>(null);

  useEffect(() => {
    (async () => {
      const current = await getVersion();
      setAppVersion(current);
      if (!CHANGELOG[current]) return;
      let lastSeen: string | null = null;
      try {
        lastSeen = localStorage.getItem(LAST_SEEN_VERSION_KEY);
      } catch {
        // storage unavailable — show it every launch, harmless
      }
      if (lastSeen !== current) setWhatsNewVersion(current);
    })();
  }, []);

  function dismissWhatsNew() {
    if (whatsNewVersion) {
      try {
        localStorage.setItem(LAST_SEEN_VERSION_KEY, whatsNewVersion);
      } catch {
        // per-viewer preference only — fine to skip if storage is unavailable
      }
    }
    setWhatsNewVersion(null);
  }

  const [busy, setBusy] = useState(false);
  const {
    newTransactionOpen,
    reviewIds,
    confirmingBulkDelete,
    confirmingBulkFlip,
    undoToast,
    similarToast,
    bulkTagText,
    setNewTransactionOpen,
    setReviewIds,
    setConfirmingBulkDelete,
    setConfirmingBulkFlip,
    setUndoToast,
    setSimilarToast,
    setBulkTagText,
    handleCategoryChange,
    handleApplyToSimilar,
    handleCreateManualTransaction,
    handleRecategorize,
    handleBulkMemberChange,
    handleBulkAddTag,
    handleBulkCategoryChange,
    handleBulkDelete,
    handleUndoBulkDelete,
    handleBulkFlipSigns,
    handleAddSelectedToRecurring,
  } = useTransactionBulkActions({ data: transactionData, ledger: { selectedIds, setSelectedIds }, onStatus: setStatus, onBusy: setBusy, askNewCategory, refreshRecurring: async () => { await refreshRecurring(); } });

  const [dialog, setDialog] = useState<PendingDialog | null>(null);
  const [pendingSetupImport, setPendingSetupImport] = useState<{
    path: string;
    preview: SetupImportPreview;
    includedAccounts: Set<number>;
    includedCategories: Set<number>;
    includedBudgets: Set<number>;
    includedBuckets: Set<number>;
    includedHoldings: Set<number>;
  } | null>(null);
  const [manageCategoriesOpen, setManageCategoriesOpen] = useState(false);
  const [manageFamilyMembersOpen, setManageFamilyMembersOpen] = useState(false);

  const [pendingExistingDbPath, setPendingExistingDbPath] = useState<string | null>(null);
  const [pendingExistingIsProtected, setPendingExistingIsProtected] = useState(false);
  const [pendingExistingRequiresPassword, setPendingExistingRequiresPassword] = useState(false);
  const [choosingExistingSource, setChoosingExistingSource] = useState(false);
  const [pendingProtectedSwitch, setPendingProtectedSwitch] = useState<{ id: string; name: string } | null>(null);
  const [moreMenuOpen, setMoreMenuOpen] = useState(false);
  const moreMenuRef = useRef<HTMLDivElement>(null);
  const { shouldRender: moreMenuShouldRender, closing: moreMenuClosing } = useDelayedVisibility(moreMenuOpen);

  // Closes the Transactions toolbar's "More" menu on an outside click — same
  // pattern as MoreFiltersPopover/AccountFilterDropdown.
  useEffect(() => {
    if (!moreMenuOpen) return;
    function handleClickOutside(e: MouseEvent) {
      if (moreMenuRef.current && !moreMenuRef.current.contains(e.target as Node)) {
        setMoreMenuOpen(false);
      }
    }
    document.addEventListener("mousedown", handleClickOutside);
    return () => document.removeEventListener("mousedown", handleClickOutside);
  }, [moreMenuOpen]);

  // Its own independent state from `status` (not a `setStatus(...)` call)
  // so a routine message elsewhere can never clobber an active undo
  // window — see `StatusBanner`'s own comment on the `action` prop.

  // Offered right after fixing one transaction's category, when the rule
  // that fix just taught the app would also re-categorize other, similar
  // transactions already on the books. Own state (like `undoToast`) so a
  // routine status message can't clobber it mid-decision.

  // const [ledgerDensity, setLedgerDensityState] = useState<LedgerDensity>(loadLedgerDensity);
  const [ledgerDensity] = useState<LedgerDensity>(loadLedgerDensity);
  // Restore this setter with the Transactions density selector below.
  // function setLedgerDensity(next: LedgerDensity) {
  //   setLedgerDensityState(next);
  //   try {
  //     localStorage.setItem(LEDGER_DENSITY_STORAGE_KEY, next);
  //   } catch {
  //     // a failed write only means the choice isn't remembered next launch
  //   }
  // }
  // Below this container width (not window width — the sidebar eats into
  // that), Member/Source/Debt/Account/Category move out of the table into
  // a per-row expandable Details panel instead of squeezing every column
  // down until headers overlap and controls clip. One threshold rather
  // than the two the brief sketches (1100px moving Member/Source/Debt,
  // 850px also moving Account/Category) — ledgered as a scope reduction,
  // using the brief's own tighter 850px tier so a genuinely ordinary
  // desktop window (1280px, measured at ~985px content width once the
  // page's own vertical scrollbar is present) stays in the wide layout;
  // this app's own tested widths (1440/1280 wide, 960/800 narrow) don't
  // actually exercise the 850-1100 gap between the brief's two tiers.
  const LEDGER_NARROW_BREAKPOINT = 850;
  const [ledgerNarrow, setLedgerNarrow] = useState(false);
  // A plain ref's `.current` doesn't trigger a re-render or effect when it
  // changes, so a `useEffect(..., [])` that reads it at mount time missed
  // the container entirely whenever the app first loaded on a tab other
  // than Transactions (the usual case) — the ledger's own div didn't exist
  // yet, the observer was never attached, and `ledgerNarrow` stayed false
  // forever after. A callback ref re-fires this effect exactly when the
  // div actually mounts (switching onto the tab) or unmounts (off it).
  const [ledgerScrollEl, setLedgerScrollEl] = useState<HTMLDivElement | null>(null);
  useEffect(() => {
    if (!ledgerScrollEl || typeof ResizeObserver === "undefined") return;
    const observer = new ResizeObserver((entries) => {
      const width = entries[0]?.contentRect.width;
      if (width !== undefined) setLedgerNarrow(width < LEDGER_NARROW_BREAKPOINT);
    });
    observer.observe(ledgerScrollEl);
    return () => observer.disconnect();
  }, [ledgerScrollEl]);
  const [detailsOpenId, setDetailsOpenId] = useState<number | null>(null);

  // `usedCategories` now comes straight from the backend's category
  // registry (`list_categories`, refetched alongside the rest of the
  // transaction data) — it already includes the standard suggestions, every budgeted
  // category, and anything created or assigned by hand, so it's the
  // complete, single source of truth for every category picker in the app.
  const categoryOptions = usedCategories;
  const categoryFilterOptions = useMemo(
    () => [
      { value: "all", label: "All categories" },
      { value: UNCATEGORIZED_FILTER, label: "Uncategorized" },
      ...categoryOptions.map((c) => ({ value: c, label: c })),
    ],
    [categoryOptions],
  );

  // Name → explicit icon override, for the handful of places that render a
  // `<CategoryIcon>` against a real stored category (not just a name typed
  // into a picker) — `iconForCategory`'s own keyword guess still applies
  // for any category missing from this map (not yet fetched, or with no
  // explicit icon chosen).
  const categoryIconMap = useMemo(() => {
    const map: Record<string, string | null> = {};
    for (const c of categoryIcons) map[c.name] = c.icon_key;
    return map;
  }, [categoryIcons]);

  // Accounts a payment can be applied toward paying down — loans and
  // credit cards are the two account types that represent debt.
  const debtAccounts = accounts.filter((a) => a.account_type === "loan" || a.account_type === "credit");

  // Each wrapped in useMemo — this app's own state lives almost entirely
  // in this one component, so without memoization these three would
  // rerun on *every* render regardless of cause: a single keystroke into
  // an unrelated inline edit (a tag, a date) would re-filter and re-sort
  // the full transaction array for no reason. Real cost for a multi-year
  // history with thousands of rows.
  const anomalyFlagsByTransaction = useMemo(() => {
    const map = new Map<number, AnomalyFlag[]>();
    for (const flag of anomalyFlags) {
      const existing = map.get(flag.transaction_id);
      if (existing) existing.push(flag);
      else map.set(flag.transaction_id, [flag]);
    }
    return map;
  }, [anomalyFlags]);

  // Suggested transfers (equal-and-opposite amounts in different accounts a
  // few days apart) — fetched whenever the Transactions tab is showing and
  // the data changes, so a fresh import or manual entry surfaces its own.
  const {
    transferReviewOpen,
    setTransferReviewOpen,
    dismissUndoToast,
    setDismissUndoToast,
    transferCandidatePairs,
    autoLinkReviewOpen,
    setAutoLinkReviewOpen,
    autoLinkedPairs,
    handleDismissTransferCandidates,
    handleDismissAllTransferCandidates,
    handleUndoDismissTransferCandidates,
    handleUnlinkTransfer,
    handleLinkSelectedAsTransfer,
    handleLinkTransfers,
    handleMarkAutoLinksReviewed,
  } = useTransactionTransfers({ data: transactionData, transactions, active: activeTab === "ledger", ledger: { selectedPairForLink, setSelectedIds }, onStatus: setStatus });
  // The Member column earns its space only when there's more than one person to choose between.
  const showMemberCol = familyMembers.length >= 2;
  // select, date, description, amount, actions — plus, when not narrow, account, [member], category
  // and source. Debt payments live under the description and in the row's ⋯ menu, not a column.
  const ledgerColumnCount = computeLedgerColumnCount(ledgerNarrow, showMemberCol);

  useEffect(() => {
    if (pendingPaymentId === null) return;
    if (activeTab !== "ledger") { setPendingPaymentId(null); return; }
    const index = paymentDisplayIndex(displayTransactions, inLegByOutId, pendingPaymentId);
    if (index < 0) {
      setPendingPaymentId(null);
      setStatus("Payment is no longer available.", "info");
      return;
    }
    const needed = rowsToShowFor(index, shownCount, pageSize);
    if (needed !== shownCount) { setShownCount(needed); return; }
    const rowId = displayTransactions[index].id;
    setDetailsOpenId(rowId);
    setHighlightedPaymentRow(rowId);
    const row = document.querySelector<HTMLElement>(`[data-payment-row="${rowId}"]`);
    row?.focus();
    row?.scrollIntoView({ block: "center" });
    setPendingPaymentId(null);
  }, [pendingPaymentId, activeTab, displayTransactions, inLegByOutId, pageSize, shownCount, setShownCount]);

  useEffect(() => {
    if (highlightedPaymentRow === null) return;
    const timer = setTimeout(() => setHighlightedPaymentRow(null), 5000);
    return () => clearTimeout(timer);
  }, [highlightedPaymentRow]);

  useEffect(() => {
    const root = document.documentElement;
    if (theme === "light" || theme === "dark") {
      root.setAttribute("data-theme", theme);
    } else {
      root.removeAttribute("data-theme");
    }
    try {
      localStorage.setItem(THEME_STORAGE_KEY, theme);
    } catch {
      // per-viewer preference only — fine to skip if storage is unavailable
    }
  }, [theme]);

  const resolvedTheme = useResolvedTheme(theme);

  function setTheme(next: Theme) {
    setThemeState(next);
  }

  // Privacy mode: hides every dollar amount on screen (see privacy.ts). Two
  // per-viewer preferences: the on/off button at the bottom of the sidebar, and an opt-in
  // "also hide whenever this window isn't in front" from Settings.
  const [privacyPrefs, setPrivacyPrefs] = useState<PrivacyPrefs>(loadPrivacyPrefs);
  const [windowFocused, setWindowFocused] = useState(() => document.hasFocus());
  // Only followed while the auto-hide option is on: every focus change is a
  // state change, and App is too big to re-render for nothing each time the
  // window is clicked away from.
  useEffect(() => {
    if (!privacyPrefs.autoHide) return;
    const onFocus = () => setWindowFocused(true);
    const onBlur = () => setWindowFocused(false);
    setWindowFocused(document.hasFocus());
    window.addEventListener("focus", onFocus);
    window.addEventListener("blur", onBlur);
    return () => {
      window.removeEventListener("focus", onFocus);
      window.removeEventListener("blur", onBlur);
    };
  }, [privacyPrefs.autoHide]);
  const amountsHidden = privacyPrefs.hidden || (privacyPrefs.autoHide && !windowFocused);
  // Layout effect so the first paint after launch already has amounts hidden.
  useLayoutEffect(() => {
    const root = document.documentElement;
    if (!amountsHidden) {
      root.removeAttribute("data-privacy");
      return;
    }
    root.setAttribute("data-privacy", "on");
    return startPrivacyMask(document.body);
  }, [amountsHidden]);
  useEffect(() => {
    savePrivacyPrefs(privacyPrefs);
  }, [privacyPrefs]);

  useEffect(() => {
    const root = document.documentElement;
    root.setAttribute("data-palette", themeStyle);
    try {
      localStorage.setItem(THEME_STYLE_STORAGE_KEY, themeStyle);
    } catch {
      // per-viewer preference only — fine to skip if storage is unavailable
    }
  }, [themeStyle]);

  // Layout effect so a change shows on the next frame, with no flash of the old accent.
  useLayoutEffect(() => {
    applyAppearancePrefs(appearance);
    saveAppearancePrefs(appearance);
  }, [appearance]);

  function setThemeStyle(next: ThemeStyle) {
    setThemeStyleState(next);
  }

  function setLayoutWidgets(next: WidgetId[]) {
    layoutEditedRef.current = true;
    setLayoutWidgetsState(next);
    saveDashboardLayout(next);
  }

  /** Shared by the "+ Add widget" modal and every "Pin to Dashboard" button
   * (Cash Flow's Top merchants/Debt Payoff Planner, Investments' Allocation,
   * Reports' Net Worth by Member) — both are the same action, just reached
   * from a different starting page. A widget already on the layout is a
   * no-op, matching the modal's "Added" (not a second copy). */
  function addWidgetToDashboard(id: WidgetId, announce: boolean) {
    if (!layoutWidgets.includes(id)) {
      setLayoutWidgets([...layoutWidgets, id]);
    }
    if (announce) setStatus("Pinned to Dashboard.", "success");
  }

  const orderedNavItems = navOrder.map((id) => NAV_ITEMS.find((item) => item.id === id)!);

  function handleNavDrop(targetId: Tab) {
    if (!dragNavTab || dragNavTab === targetId) {
      setDragNavTab(null);
      return;
    }
    setNavOrder((prev) => {
      const next = prev.filter((id) => id !== dragNavTab);
      next.splice(next.indexOf(targetId), 0, dragNavTab);
      try {
        localStorage.setItem(NAV_ORDER_STORAGE_KEY, JSON.stringify(next));
      } catch {
        // per-viewer preference only — fine to skip if storage is unavailable
      }
      return next;
    });
    setDragNavTab(null);
  }

  /** The keyboard equivalent of dragging a nav item — mouse-only
   * drag-and-drop has no keyboard path otherwise. Swaps `id` with its
   * neighbor *within its own group* (skipping over any other group's items
   * that sit between them in the flat stored order), matching drag's own
   * same-group-only reordering — see `NAV_ITEMS`'s doc comment. */
  function moveNavItem(id: Tab, direction: -1 | 1) {
    setNavOrder((prev) => {
      const group = NAV_ITEMS.find((n) => n.id === id)?.group;
      const sameGroupIds = prev.filter((navId) => NAV_ITEMS.find((n) => n.id === navId)?.group === group);
      const swapWith = sameGroupIds[sameGroupIds.indexOf(id) + direction];
      if (swapWith === undefined) return prev; // already at that edge of its group
      const next = [...prev];
      const i = next.indexOf(id);
      const j = next.indexOf(swapWith);
      [next[i], next[j]] = [next[j], next[i]];
      try {
        localStorage.setItem(NAV_ORDER_STORAGE_KEY, JSON.stringify(next));
      } catch {
        // per-viewer preference only — fine to skip if storage is unavailable
      }
      return next;
    });
  }

  function askNewAccount(): Promise<NewAccountResult | null> {
    return new Promise((resolve) => setDialog({ kind: "newAccount", resolve }));
  }
  function askNewCategory(): Promise<string | null> {
    return new Promise((resolve) => setDialog({ kind: "newCategory", resolve }));
  }
  function askConfirmInvert(accountName?: string, suggestion?: ImportSignSuggestion): Promise<boolean> {
    return new Promise((resolve) => setDialog({ kind: "confirmInvert", resolve, accountName, suggestion }));
  }
  function askCsvExportWarning(): Promise<boolean> {
    return new Promise((resolve) => setDialog({ kind: "csvExportWarning", resolve }));
  }

  // Bumped by every refetch below that follows a real mutation (never by
  // `refreshDashboard`/`refreshReport` themselves, which only ever *read*)
  // — the Dashboard tab-switch effect compares against this instead of
  // unconditionally refetching on every visit, so bouncing between tabs
  // with nothing actually changed skips 6 redundant backend calls. A ref,
  // not state, since bumping it should never itself trigger a render.
  const dataVersionRef = useRef(0);

  // A pinned account/bucket/investment-account widget's dead-reference
  // pruning effect (below) needs to tell "this account was deleted" apart
  // from "accounts just haven't loaded yet" — both start out as `[]`
  // before their first fetch resolves, which would otherwise look
  // identical and wipe out every parameterized widget on first paint.
  const accountsLoadedRef = useRef(false);
  // False until the first load of the profile's data has finished (or failed): views wait for it
  // instead of showing their empty states for data that is still on its way.
  const bucketsLoadedRef = useRef(false);
  const holdingsLoadedRef = useRef(false);

  useEffect(() => {
    if (!dataLoaded) return;
    accountsLoadedRef.current = true;
    dataVersionRef.current++;
  }, [dataLoaded, transactionRevision]);

  // The first time a profile opens in a new calendar month, every account's
  // balance rolls forward into a fresh baseline and each sinking-fund bucket
  // gets its automatic contribution, and today's point is left on the value
  // chart. That housekeeping runs in the backend as the profile opens (see
  // `startup::after_profile_opened`), so this page never starts a write on its
  // own; it only shows the one-time notes the backend kept for it, and nothing
  // the second time.
  const showMaintenanceSummary = useCallback(async () => {
    const summary = await invoke<MaintenanceSummary>("take_maintenance_summary");
    if (summary.rolled.length > 0) {
      const names = summary.rolled.map((r) => r.account_name).join(", ");
      setStatus(`Rolled forward this month's starting balance for ${summary.rolled.length} account(s): ${names}.`, "success");
    }
    if (summary.contributions.length > 0) {
      const names = summary.contributions.map((a) => a.bucket_name).join(", ");
      setStatus(`Added this month's automatic contribution for ${summary.contributions.length} bucket(s): ${names}.`, "success");
    }
    if (summary.warnings.length > 0) {
      setStatus(summary.warnings.join(" "));
    }
  }, []);

  const refreshBuckets = useCallback(async () => {
    setBuckets(await invoke<Bucket[]>("list_buckets"));
    bucketsLoadedRef.current = true;
    dataVersionRef.current++;
  }, []);

  // A goal that follows an account's balance gets its figure from the backend
  // as of when the goals were read, so when the accounts are re-read (a
  // transaction added, edited or deleted) its card has to be read again too —
  // otherwise Goals keeps the old total until the app is reopened.
  useEffect(() => {
    if (!bucketsLoadedRef.current || !buckets.some((b) => b.tracks_account)) return;
    refreshBuckets().catch((e) => setStatus(errorMessage(e)));
    // Deliberately keyed on `accounts` alone: `refreshBuckets` replaces `buckets`.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [accounts]);

  const checkSinkingFundContributions = useCallback(async () => {
    const applied = await invoke<SinkingFundContribution[]>("check_sinking_fund_contributions");
    if (applied.length > 0) {
      const names = applied.map((a) => a.bucket_name).join(", ");
      setStatus(`Added this month's automatic contribution for ${applied.length} bucket(s): ${names}.`, "success");
    }
  }, []);

  const refreshReport = useCallback(async () => {
    setReport(await invoke<Report>("get_report"));
  }, []);

  const refreshRecurring = useCallback(async () => {
    setRecurring(await invoke<Recurring[]>("list_recurring"));
    dataVersionRef.current++;
  }, []);

  const refreshRecurringMatches = useCallback(async () => {
    setRecurringMatches(await invoke<RecurringMatch[]>("recurring_matches"));
  }, []);

  // Matches depend on the transactions as much as on the recurring list, so
  // they're re-read whenever a screen that shows them opens rather than
  // tracked through every import and edit.
  useEffect(() => {
    if (activeTab === "recurring" || activeTab === "dashboard") {
      refreshRecurringMatches().catch((e) => setStatus(errorMessage(e)));
    }
  }, [activeTab, refreshRecurringMatches, transactionRevision]);

  const refreshRecurringTotals = useCallback(async () => {
    setRecurringTotals(await invoke<RecurringTotals>("recurring_totals"));
    dataVersionRef.current++;
  }, []);

  const refreshRecurringCandidates = useCallback(async () => {
    setRecurringCandidates(await invoke<RecurringCandidate[]>("list_recurring_candidates"));
    dataVersionRef.current++;
  }, []);

  useEffect(() => {
    if (activeTab === "recurring" && dataLoaded) refreshRecurringCandidates().catch(e => setStatus(errorMessage(e)));
  }, [activeTab, dataLoaded, transactionRevision, refreshRecurringCandidates]);

  const refreshAssets = useCallback(async () => {
    setAssets(await invoke<Asset[]>("list_assets"));
    dataVersionRef.current++;
  }, []);

  const refreshHoldings = useCallback(async () => {
    setHoldings(await invoke<Holding[]>("list_holdings"));
    setPortfolioHistory(await invoke<PortfolioPoint[]>("portfolio_history"));
    setAllocationTargets(await invoke<AllocationTarget[]>("list_allocation_targets"));
    holdingsLoadedRef.current = true;
    dataVersionRef.current++;
  }, []);

  // A pinned account/bucket/investment-account widget outlives the record
  // it points at — deleting that account or bucket (or losing its last
  // holding) shouldn't leave a dead, invisible entry sitting in the saved
  // layout forever, so drop it here once the data confirms it's gone.
  useEffect(() => {
    if (!accountsLoadedRef.current || !bucketsLoadedRef.current || !holdingsLoadedRef.current) return;
    const accountIds = new Set(accounts.map((a) => a.id));
    const bucketIds = new Set(buckets.map((b) => b.id));
    const investmentAccountNames = new Set(holdings.map((h) => h.account_name));
    const pruned = layoutWidgets.filter((id) => {
      const parsed = parseWidgetId(id);
      if (parsed.kind === "account") return accountIds.has(parsed.targetId);
      if (parsed.kind === "bucket") return bucketIds.has(parsed.targetId);
      if (parsed.kind === "investment") return investmentAccountNames.has(parsed.accountName);
      return true;
    });
    if (pruned.length !== layoutWidgets.length) setLayoutWidgets(pruned);
  }, [accounts, buckets, holdings, layoutWidgets]);

  const [cashFlow, setCashFlow] = useState<CashFlow | null>(null);
  // Defaults to the shorter preset so a newer account (with only a month or
  // two of real history) doesn't open Cash Flow to a chart that's mostly
  // empty months — a user with a longer history can still switch to 6.
  const [cashFlowRange, setCashFlowRange] = useState(3);
  const [compareLastYear, setCompareLastYear] = useState(false);
  const [yoyCashFlow, setYoyCashFlow] = useState<YoyCashFlow | null>(null);

  const refreshCashFlow = useCallback(async (months: number) => {
    setCashFlow(await invoke<CashFlow>("get_cash_flow", { months }));
  }, []);

  // Same trailing window get_cash_flow already shows, paired against the
  // identical span exactly one year earlier.
  const refreshYoy = useCallback(async (months: number) => {
    const today = new Date();
    const toYear = today.getFullYear();
    const toMonth = today.getMonth() + 1;
    let fromYear = toYear;
    let fromMonth = toMonth - (months - 1);
    while (fromMonth <= 0) {
      fromMonth += 12;
      fromYear -= 1;
    }
    setYoyCashFlow(await invoke<YoyCashFlow>("year_over_year_cash_flow", { fromYear, fromMonth, toYear, toMonth }));
  }, []);

  const [monthDetail, setMonthDetail] = useState<MonthExpenseDetail | null>(null);

  async function handleMonthClick(year: number, month: number) {
    try {
      setMonthDetail(await invoke<MonthExpenseDetail>("month_expense_detail", { year, month }));
    } catch (e) {
      setStatus(errorMessage(e));
    }
  }

  // "Top categories"/"Top merchants" are scoped to one month at a time —
  // deliberately separate from the bar chart's trailing 3/6-month window
  // above, and defaulting to the current month rather than that window's
  // aggregate. `cash_flow_for_range` already computes both for an
  // arbitrary month range; passing the same month as both ends of the
  // range gets exactly one month's breakdown with no new backend code.
  const topCategoriesNow = new Date();
  const [topCategoriesMonth, setTopCategoriesMonth] = useState({
    year: topCategoriesNow.getFullYear(),
    month: topCategoriesNow.getMonth() + 1,
  });
  const [topCategoriesData, setTopCategoriesData] = useState<CashFlow | null>(null);
  // Uncapped per-category spend for the month right before the one being
  // viewed — a category can be in the *current* month's top 6 without
  // having been in the *prior* month's, so this can't come from that
  // month's own (also-capped) top_categories list.
  const [previousMonthCategorySpending, setPreviousMonthCategorySpending] = useState<CategoryAmount[]>([]);

  const refreshTopCategories = useCallback(async (year: number, month: number) => {
    let prevYear = year;
    let prevMonth = month - 1;
    if (prevMonth < 1) {
      prevMonth = 12;
      prevYear -= 1;
    }
    const [current, previous] = await Promise.all([
      invoke<CashFlow>("cash_flow_for_range", { fromYear: year, fromMonth: month, toYear: year, toMonth: month }),
      invoke<CategoryAmount[]>("category_spending_for_month", { year: prevYear, month: prevMonth }),
    ]);
    setTopCategoriesData(current);
    setPreviousMonthCategorySpending(previous);
  }, []);

  const [forecastDays, setForecastDays] = useState(30);
  const [forecastData, setForecastData] = useState<BillAwareForecast | null>(null);

  const refreshForecast = useCallback(async (days: number) => {
    setForecastData(await invoke<BillAwareForecast>("bill_aware_forecast", { days }));
  }, []);

  // The Dashboard's "Safe to spend" needs a horizon long enough to reach the
  // next paycheck (monthly pay is up to ~35 days out) — its own fetch, since
  // the Cash Flow tab's forecast window is whatever 30/60/90 the user picked.
  const [safeToSpendForecast, setSafeToSpendForecast] = useState<BillAwareForecast | null>(null);
  useEffect(() => {
    if (!appSettingsLoaded || !appSettings.safe_to_spend_enabled || activeTab !== "dashboard" || !layoutWidgets.includes("safe_to_spend")) return;
    let cancelled = false;
    invoke<BillAwareForecast>("bill_aware_forecast", { days: 45 })
      .then((f) => {
        if (!cancelled) setSafeToSpendForecast(f);
      })
      .catch(() => {
        /* the widget just doesn't render — never worth an error banner */
      });
    return () => {
      cancelled = true;
    };
  }, [activeTab, appSettingsLoaded, appSettings.safe_to_spend_enabled, layoutWidgets, transactions, recurring, accounts]);

  useEffect(() => {
    if (activeTab === "cashflow") {
      refreshCashFlow(cashFlowRange).catch((e) => setStatus(errorMessage(e)));
      if (compareLastYear) refreshYoy(cashFlowRange).catch((e) => setStatus(errorMessage(e)));
      refreshForecast(forecastDays).catch((e) => setStatus(errorMessage(e)));
    }
    // "Top merchants" also needs this data when pinned to the Dashboard —
    // same fetch, just triggered from a second tab, and it always shows
    // `topCategoriesMonth`'s (default: current month) figures either way.
    if (activeTab === "cashflow" || (activeTab === "dashboard" && layoutWidgets.includes("top_merchants"))) {
      refreshTopCategories(topCategoriesMonth.year, topCategoriesMonth.month).catch((e) => setStatus(errorMessage(e)));
    }
  }, [
    activeTab,
    cashFlowRange,
    transactionRevision,
    compareLastYear,
    topCategoriesMonth,
    forecastDays,
    layoutWidgets,
    refreshCashFlow,
    refreshYoy,
    refreshTopCategories,
    refreshForecast,
  ]);

  const [netWorthHistory, setNetWorthHistory] = useState<NetWorthPoint[]>([]);
  const [accountContributionDeltas, setAccountContributionDeltas] = useState<AccountContributionDelta[]>([]);
  const [spendingThisMonth, setSpendingThisMonth] = useState<CategoryAmount[]>([]);
  const [dashboardBudgetAlerts, setDashboardBudgetAlerts] = useState<BudgetAlert[]>([]);
  const [dashboardInsights, setDashboardInsights] = useState<Insight[]>([]);
  const [avgMonthlySpend, setAvgMonthlySpend] = useState("0");

  // Declared here (rather than alongside the rest of the Budget tab's
  // state, further down) specifically so `refreshDashboard` below can
  // read them — a `useCallback` dependency array is evaluated immediately
  // as part of the call expression, not deferred like the callback body
  // itself, so referencing a `const` declared later in the component
  // would be a genuine temporal-dead-zone error, not just a style choice.
  const now = new Date();
  const [budgetYear, setBudgetYear] = useState(now.getFullYear());
  const [budgetMonthNum, setBudgetMonthNum] = useState(now.getMonth() + 1);

  // Dashboard may reuse alerts from a completed Budget snapshot for the
  // same month and accepted transaction revision. Budget always reads its
  // own coherent aggregate; it never consumes this independent alert cache.
  const currentMonthAlertsRef = useRef<{ month: string; alerts: BudgetAlert[]; revision: string } | null>(null);

  const refreshDashboard = useCallback(async () => {
    const today = new Date();
    const todayYear = today.getFullYear();
    const todayMonth = today.getMonth() + 1;
    const monthKey = `${todayYear}-${todayMonth}`;
    const cachedAlerts = currentMonthAlertsRef.current?.month === monthKey && currentMonthAlertsRef.current.revision === transactionRevision ? currentMonthAlertsRef.current.alerts : null;

    const [nw, spend, alerts, insights, avgSpend] = await Promise.all([
      invoke<NetWorthPoint[]>("net_worth_history", { months: 6 }),
      invoke<CategoryAmount[]>("spending_this_month"),
      cachedAlerts ? Promise.resolve(cachedAlerts) : invoke<BudgetAlert[]>("budget_alerts_for_month", { year: todayYear, month: todayMonth }),
      invoke<Insight[]>("dashboard_insights"),
      invoke<string>("average_monthly_spend"),
    ]);
    currentMonthAlertsRef.current = { month: monthKey, alerts, revision: transactionRevision };
    setNetWorthHistory(nw);
    setSpendingThisMonth(spend);
    setDashboardBudgetAlerts(alerts);
    setDashboardInsights(insights);
    setAvgMonthlySpend(avgSpend);
    // Budget owns one coherent snapshot; Dashboard cannot replace its alerts independently.
    // "What changed" behind each stat card's trend, over the same span the
    // sparkline itself covers — a follow-up call (not part of the
    // Promise.all above) since it needs the history's own endpoint dates.
    if (nw.length >= 2) {
      invoke<AccountContributionDelta[]>("account_contribution_deltas", {
        from: nw[0].as_of,
        to: nw[nw.length - 1].as_of,
      })
        .then(setAccountContributionDeltas)
        .catch((e) => setStatus(errorMessage(e)));
    } else {
      setAccountContributionDeltas([]);
    }
  }, [budgetYear, budgetMonthNum, transactionRevision]);

  // -1 so the very first Dashboard visit always fetches (dataVersionRef
  // starts at 0, which would otherwise look identical to "nothing's
  // changed" on a version-less first render).
  const lastDashboardFetchVersionRef = useRef(-1);
  useEffect(() => {
    if (activeTab === "dashboard" && dataVersionRef.current !== lastDashboardFetchVersionRef.current) {
      lastDashboardFetchVersionRef.current = dataVersionRef.current;
      refreshDashboard().catch((e) => setStatus(errorMessage(e)));
      refreshReport().catch((e) => setStatus(errorMessage(e)));
    }
  }, [activeTab, refreshDashboard, refreshReport, transactionRevision]);

  // Launch-time bill-due check — not a background reminder (this only runs
  // when the app is actually open), and deliberately no backend command:
  // it filters `recurring` data the app already loaded. Deduped per
  // install via localStorage (same pattern as theme/nav-order/welcome-seen)
  // so a bill isn't re-notified every single launch on the same day.
  useEffect(() => {
    if (recurring.length === 0) return;
    // With background reminders on the backend sends these (once per due
    // date, window open or not), so this launch-time path steps aside — and
    // waits until it knows which case it's in.
    if (backgroundSettings === null || backgroundSettings.tray_enabled) return;
    const DUE_SOON_DAYS = 3;

    (async () => {
      const todayIso = toLocalIsoDate();
      const today = new Date(todayIso);
      const dueSoon = recurring.filter((r) => {
        if (parseFloat(r.amount) >= 0) return false; // bills only, not income
        const daysUntil = (new Date(r.next_date).getTime() - today.getTime()) / (1000 * 60 * 60 * 24);
        return daysUntil >= 0 && daysUntil <= DUE_SOON_DAYS;
      });
      if (dueSoon.length === 0) return;

      const generation = await ensureUiStateMigrated().catch(() => getCurrentGeneration().catch(() => 0));
      let notified: Record<string, string> = {};
      try {
        notified = JSON.parse((await getProfileUiState("notified_bills")) ?? "{}");
      } catch {
        notified = {};
      }
      const toNotify = dueSoon.filter((r) => notified[String(r.id)] !== todayIso);
      if (toNotify.length === 0) return;

      let granted = await isPermissionGranted();
      if (!granted) {
        granted = (await requestPermission()) === "granted";
      }
      if (!granted) return;

      const isPasswordProtected = profiles.find((p) => p.is_active)?.is_password_protected ?? false;
      const showNames = !isPasswordProtected || showBillNamesInReminders;
      for (const r of toNotify) {
        const body = showNames ? `${r.merchant} — ${formatAmount(r.amount)} due ${formatDisplayDate(r.next_date)}` : "A bill is due soon.";
        sendNotification({ title: "Upcoming bill", body });
        notified[String(r.id)] = todayIso;
      }
      try {
        await setProfileUiState("notified_bills", JSON.stringify(notified), generation);
      } catch {
        // a missed dedup write just means this bill might notify again next launch, not a
        // functional failure worth surfacing to the user.
      }
    })();
  }, [recurring, backgroundSettings, profiles, showBillNamesInReminders]);

  const budgetRead = useFinancialRead<BudgetSnapshot>();
  const loadBudget = budgetRead.refresh;
  const budgetMonthKey = `${budgetYear}-${budgetMonthNum}`;
  const budgetSnapshot = budgetRead.data?.key === budgetMonthKey ? budgetRead.data.value : null;
  const budgetMonthActuals = budgetSnapshot?.actuals ?? [];
  const budgetMonthFlow = budgetSnapshot?.flow ?? null;
  const budgetAlerts = budgetSnapshot?.alerts ?? [];
  const memberBudgetActuals = budgetSnapshot?.members ?? [];
  const refreshBudgetMonthActuals = useCallback(async (year: number, month: number) => {
    try {
      const next = await loadBudget(`${year}-${month}`, client => client.budget(year, month));
      currentMonthAlertsRef.current = { month: `${year}-${month}`, alerts: next.alerts, revision: transactionRevision };
      dataVersionRef.current++;
    } catch (error) {
      if (error && typeof error === "object" && "code" in error && error.code === "superseded") return;
      throw error;
    }
  }, [loadBudget, transactionRevision]);
  const refreshMemberBudgetActuals = refreshBudgetMonthActuals;

  // Memoized so `BudgetRow`'s fetch-on-mount effect (keyed on this
  // function's identity, see BudgetView.tsx) only refires when the viewed
  // month actually changes — not on every unrelated App re-render.
  const handleFetchBudgetTrend = useCallback(
    async (category: string): Promise<{ month: string; actual: string }[]> => {
      try {
        return await invoke<{ month: string; actual: string }[]>("budget_actuals_trend", {
          category,
          year: budgetYear,
          month: budgetMonthNum,
          months: 4,
        });
      } catch {
        return []; // decorative sparkline only — swallow errors rather than interrupting the row
      }
    },
    [budgetYear, budgetMonthNum],
  );

  useEffect(() => {
    // The housekeeping already ran before this page mounted, so the reads below
    // don't have to wait for it.
    showMaintenanceSummary().catch((e) => setStatus(errorMessage(e)));
    refresh().catch((e) => setStatus(errorMessage(e)));
    refreshBuckets().catch((e) => setStatus(errorMessage(e)));
    refreshRecurring().catch((e) => setStatus(errorMessage(e)));
    refreshRecurringTotals().catch((e) => setStatus(errorMessage(e)));
    refreshHoldings().catch((e) => setStatus(errorMessage(e)));
    refreshAssets().catch((e) => setStatus(errorMessage(e)));
  }, [
    showMaintenanceSummary,
    refresh,
    refreshBuckets,
    refreshRecurring,
    refreshRecurringTotals,
    refreshHoldings,
    refreshAssets,
  ]);

  useEffect(() => {
    // the report aggregates transaction/bucket/budget data, so refetch it fresh
    // whenever the user actually looks at that tab, rather than tracking
    // every mutation that could affect one of its numbers
    if (activeTab === "reports") {
      refreshReport().catch((e) => setStatus(errorMessage(e)));
    }
  }, [activeTab, refreshReport, transactionRevision]);

  useEffect(() => {
    // the Budget tab browses arbitrary months, independent of Reports'
    // fixed "current month" view — refetch whenever the tab is open or
    // the selected month changes
    if (activeTab === "budget") {
      refreshBudgetMonthActuals(budgetYear, budgetMonthNum).catch((e) => setStatus(errorMessage(e)));
    }
  }, [activeTab, budgetYear, budgetMonthNum, refreshBudgetMonthActuals, transactionRevision]);

  useEffect(() => {
    // Household reuses Budget's own month cursor rather than a second
    // independent one, so the two tabs always agree on which month is
    // being looked at.
    if (activeTab === "household") {
      refreshMemberBudgetActuals(budgetYear, budgetMonthNum).catch((e) => setStatus(errorMessage(e)));
    }
  }, [activeTab, budgetYear, budgetMonthNum, refreshMemberBudgetActuals, transactionRevision]);

  function handlePrevBudgetMonth() {
    if (budgetMonthNum === 1) {
      setBudgetYear((y) => y - 1);
      setBudgetMonthNum(12);
    } else {
      setBudgetMonthNum((m) => m - 1);
    }
  }

  function handleNextBudgetMonth() {
    if (budgetMonthNum === 12) {
      setBudgetYear((y) => y + 1);
      setBudgetMonthNum(1);
    } else {
      setBudgetMonthNum((m) => m + 1);
    }
  }

  const budgetMonthLabel = new Date(budgetYear, budgetMonthNum - 1, 1).toLocaleDateString("en-US", {
    month: "long",
    year: "numeric",
  });

  // The Budget tab's month-nav'd period ("YYYY-MM") — every set/delete
  // below is scoped to exactly this month, on purpose: editing a budget
  // must never move a different month's numbers (see BudgetView).
  const budgetPeriod = `${budgetYear}-${String(budgetMonthNum).padStart(2, "0")}`;

  async function handleSetBudget(category: string, monthlyAmount: string, budgetGroup: string) {
    try {
      await callTransaction("set_budget", { category, period: budgetPeriod, monthlyAmount, budgetGroup });
      await refreshBudgetMonthActuals(budgetYear, budgetMonthNum);
    } catch (e) {
      setStatus(errorMessage(e));
    }
  }

  // ---- Month-end review -------------------------------------------------
  const [reviewedMonths, setReviewedMonths] = useState<string[]>([]);
  const [monthReview, setMonthReview] = useState<MonthReview | null>(null);
  const refreshReviewedMonths = useCallback(async () => {
    setReviewedMonths(await invoke<string[]>("list_reviewed_months"));
  }, []);
  useEffect(() => {
    refreshReviewedMonths().catch((e) => setStatus(errorMessage(e)));
  }, [refreshReviewedMonths]);
  const monthReviewOffer = useMemo(
    () => monthReviewDue({ today: new Date(), reviewedMonths, transactions }),
    [reviewedMonths, transactions],
  );

  async function handleOpenMonthReview(year: number, month: number) {
    try {
      setMonthReview(await invoke<MonthReview>("month_review", { year, month }));
    } catch (e) {
      setStatus(errorMessage(e));
    }
  }

  async function handleFinishMonthReview() {
    if (!monthReview) return;
    try {
      await invoke("set_month_reviewed", { year: monthReview.year, month: monthReview.month });
      await refreshReviewedMonths();
      setStatus(`${new Date(monthReview.year, monthReview.month - 1, 1).toLocaleDateString("en-US", { month: "long" })} review finished.`, "success");
      setMonthReview(null);
    } catch (e) {
      setStatus(errorMessage(e));
    }
  }

  function handleReviewCategorize() {
    if (!monthReview) return;
    const mm = String(monthReview.month).padStart(2, "0");
    const lastDay = new Date(monthReview.year, monthReview.month, 0).getDate();
    setFilterCategory(UNCATEGORIZED_FILTER);
    setFilterFrom(`${monthReview.year}-${mm}-01`);
    setFilterTo(`${monthReview.year}-${mm}-${String(lastDay).padStart(2, "0")}`);
    setMonthReview(null);
    setActiveTab("ledger");
  }

  // ---- Import review inbox ---------------------------------------------
  // `inboxRequest`: ids to open the inbox on once the data behind them has
  // loaded (null = nothing pending). `inbox`: the fixed list the open dialog
  // works through.
  const [inboxRequest, setInboxRequest] = useState<Set<number> | null>(null);
  const [inbox, setInbox] = useState<InboxItem[] | null>(null);
  const importReview = useImportReview({
    call: callTransaction,
    accounts,
    busy,
    setBusy,
    setStatus,
    refresh: async () => { await refresh(); },
    onImported: (ids) => setInboxRequest(new Set(ids)),
  });
  const inboxCount = useMemo(() => buildInbox({ transactions, flags: anomalyFlags, scopeIds: null }).length, [transactions, anomalyFlags]);
  useEffect(() => {
    if (!inboxRequest) return;
    const loaded = new Set(transactions.map((t) => t.id));
    if (![...inboxRequest].every((id) => loaded.has(id))) return; // the import hasn't been read back yet
    setInboxRequest(null);
    const items = buildInbox({ transactions, flags: anomalyFlags, scopeIds: inboxRequest });
    if (items.length > 0) setInbox(items);
  }, [inboxRequest, transactions, anomalyFlags]);

  function openInbox() {
    const items = buildInbox({ transactions, flags: anomalyFlags, scopeIds: null });
    if (items.length > 0) setInbox(items);
  }

  async function handleInboxSetCategory(id: number, category: string) {
    try {
      await callTransaction("correct_category", { id, category });
    } catch (e) {
      setStatus(errorMessage(e));
      throw e;
    }
  }

  async function handleInboxDelete(id: number) {
    try {
      const deleted = await callTransaction<number[]>("bulk_delete_transactions", { ids: [id] });
      setUndoToast({ text: `Deleted ${deleted.length} transaction(s).`, ids: deleted });
    } catch (e) {
      setStatus(errorMessage(e));
      throw e;
    }
  }

  async function handleInboxDismiss(id: number, kinds: ("large" | "duplicate")[]) {
    try {
      for (const kind of kinds) await callTransaction("dismiss_anomaly_flag", { transactionId: id, kind });
    } catch (e) {
      setStatus(errorMessage(e));
      throw e;
    }
  }

  async function closeInbox() {
    setInbox(null);
    await refresh(); // the edits were made one at a time behind the dialog
  }

  // ---- Command palette + keyboard shortcuts ------------------------------
  const [accountDetailId, setAccountDetailId] = useState<number | null>(null);
  const accountDetail = accountDetailId === null ? null : (accounts.find((a) => a.id === accountDetailId) ?? null);
  // Set when a Details page was opened from another tab (the Investments summary), so Back returns there.
  const [detailReturnTab, setDetailReturnTab] = useState<Tab | null>(null);
  // Set when an account row's "Reconcile with a statement…" opened the page: it opens at that card.
  const [detailFocus, setDetailFocus] = useState<"reconcile" | null>(null);
  useEffect(() => {
    // The account page belongs to the Accounts tab; leaving it closes the page.
    if (activeTab !== "accounts") {
      setAccountDetailId(null);
      setDetailReturnTab(null);
    }
  }, [activeTab]);
  const [paletteOpen, setPaletteOpen] = useState(false);
  const [shortcutsOpen, setShortcutsOpen] = useState(false);

  function focusTransactionSearch() {
    setActiveTab("ledger");
    // The Transactions filters mount with the tab; give them a moment.
    window.setTimeout(() => document.querySelector<HTMLInputElement>('input[aria-label="Search description"]')?.focus(), 60);
  }

  useEffect(() => {
    function isTyping(target: EventTarget | null): boolean {
      const el = target as HTMLElement | null;
      return !!el && (el.tagName === "INPUT" || el.tagName === "TEXTAREA" || el.tagName === "SELECT" || el.isContentEditable);
    }
    function onKeyDown(e: KeyboardEvent) {
      const dialogOpen = document.querySelector('[role="dialog"]') !== null;
      if ((e.ctrlKey || e.metaKey) && e.key.toLowerCase() === "k") {
        e.preventDefault();
        // Another dialog is up: leave it alone. The palette itself toggles off.
        if (!dialogOpen || paletteOpen) setPaletteOpen((open) => !open);
        return;
      }
      if (e.ctrlKey || e.metaKey || e.altKey || dialogOpen || isTyping(e.target)) return;
      if (e.key === "n" || e.key === "N") {
        e.preventDefault();
        setNewTransactionOpen(true);
      } else if (e.key === "/") {
        e.preventDefault();
        focusTransactionSearch();
      } else if (e.key === "?") {
        e.preventDefault();
        setShortcutsOpen(true);
      }
    }
    document.addEventListener("keydown", onKeyDown);
    return () => document.removeEventListener("keydown", onKeyDown);
  }, [paletteOpen, setNewTransactionOpen]);

  // Recent transactions only — the palette filters on every keystroke.
  const paletteEntries = useMemo<PaletteEntry[]>(() => {
    const entries: PaletteEntry[] = [];
    for (const item of [...orderedNavItems, ...PINNED_NAV_ITEMS]) {
      entries.push({ id: `tab:${item.id}`, kind: "tab", label: item.label });
    }
    entries.push(
      { id: "action:add", kind: "action", label: "Add transaction…", keywords: "new create expense income" },
      { id: "action:import", kind: "action", label: "Import transactions…", keywords: "csv ofx qfx qif file bank statement" },
      { id: "action:privacy", kind: "action", label: privacyPrefs.hidden ? "Show amounts" : "Hide amounts", keywords: "privacy mask hide blur" },
      { id: "action:review", kind: "action", label: "Review last month…", keywords: "month end close out check-in" },
      { id: "action:backup", kind: "action", label: "Back up now", keywords: "backup save copy data" },
      { id: "action:shortcuts", kind: "action", label: "Keyboard shortcuts", keywords: "keys help hotkeys" },
    );
    // Locking only makes sense for a profile that actually has a password to unlock it again — a
    // locked-but-unprotected profile has no way back in except Switch profile, so this is never
    // offered unless the active profile really is protected.
    if (profiles.find((p) => p.is_active)?.is_password_protected) {
      entries.push({ id: "action:lock", kind: "action", label: "Lock profile", keywords: "password protected security signout" });
    }
    if (inboxCount > 0) {
      entries.push({ id: "action:inbox", kind: "action", label: `Review inbox (${inboxCount})`, keywords: "triage uncategorized duplicates large" });
    }
    for (const a of accounts) entries.push({ id: `account:${a.id}`, kind: "account", label: a.name, hint: accountTypeLabel(a.account_type) });
    for (const b of buckets) entries.push({ id: `goal:${b.id}`, kind: "goal", label: b.name, hint: "Goal" });
    for (const t of transactions.slice(0, 3000)) {
      entries.push({
        id: `txn:${t.id}`,
        kind: "transaction",
        label: t.description,
        hint: `${formatDisplayDate(t.date)} · ${formatAmount(t.amount)}`,
        keywords: t.category ?? undefined,
      });
    }
    return entries;
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [orderedNavItems.map((i) => i.id).join(","), privacyPrefs.hidden, inboxCount, accounts, buckets, transactions, profiles]);

  function runPaletteEntry(entry: PaletteEntry) {
    setPaletteOpen(false);
    const [kind, ...rest] = entry.id.split(":");
    const key = rest.join(":");
    if (kind === "tab") {
      setActiveTab(key as Tab);
    } else if (kind === "account") {
      setActiveTab("accounts");
      setAccountDetailId(Number(key));
    } else if (kind === "goal") {
      setActiveTab("buckets");
    } else if (kind === "txn") {
      const t = transactions.find((x) => x.id === Number(key));
      if (t) {
        setSearchText(t.description);
        setFilterCategory("all");
        setFilterAccountIds("all");
        setFilterFrom("");
        setFilterTo("");
      }
      setActiveTab("ledger");
    } else if (entry.id === "action:add") {
      setNewTransactionOpen(true);
    } else if (entry.id === "action:import") {
      setActiveTab("ledger");
      void handleImport();
    } else if (entry.id === "action:privacy") {
      setPrivacyPrefs((p) => ({ ...p, hidden: !p.hidden }));
    } else if (entry.id === "action:review") {
      const last = new Date(new Date().getFullYear(), new Date().getMonth() - 1, 1);
      void handleOpenMonthReview(last.getFullYear(), last.getMonth() + 1);
    } else if (entry.id === "action:backup") {
      void handleCreateBackupNow();
    } else if (entry.id === "action:shortcuts") {
      setShortcutsOpen(true);
    } else if (entry.id === "action:inbox") {
      openInbox();
    } else if (entry.id === "action:lock") {
      void handleLockProfile();
    }
  }

  async function handleSuggestBudgets(): Promise<BudgetSuggestions | null> {
    try {
      return await invoke<BudgetSuggestions>("suggest_budgets", { year: budgetYear, month: budgetMonthNum });
    } catch (e) {
      setStatus(errorMessage(e));
      return null;
    }
  }

  async function handleApplyBudgetSuggestions(rows: { category: string; amount: string; group: string }[]) {
    try {
      for (const row of rows) {
        await callTransaction("set_budget", { category: row.category, period: budgetPeriod, monthlyAmount: row.amount, budgetGroup: row.group });
      }
      await refreshBudgetMonthActuals(budgetYear, budgetMonthNum);
      setStatus(`Set ${rows.length} budget${rows.length === 1 ? "" : "s"} for ${budgetMonthLabel}.`);
    } catch (e) {
      setStatus(errorMessage(e));
    }
  }

  async function handleSetCap(category: string, capEnabled: boolean) {
    try {
      await callTransaction("set_budget_cap", { category, period: budgetPeriod, capEnabled });
      await refreshBudgetMonthActuals(budgetYear, budgetMonthNum);
    } catch (e) {
      setStatus(errorMessage(e));
    }
  }

  async function handleSetRollover(category: string, rolloverEnabled: boolean) {
    try {
      await callTransaction("set_budget_rollover", { category, period: budgetPeriod, rolloverEnabled });
      // A category's carry changes what counts as over budget — don't reuse cached alerts.
      currentMonthAlertsRef.current = null;
      await refreshBudgetMonthActuals(budgetYear, budgetMonthNum);
    } catch (e) {
      setStatus(errorMessage(e));
    }
  }

  async function handleDeleteBudget(category: string) {
    try {
      await callTransaction("delete_budget", { category, period: budgetPeriod });
      await refreshBudgetMonthActuals(budgetYear, budgetMonthNum);
    } catch (e) {
      setStatus(errorMessage(e));
    }
  }

  const [categoryTransactions, setCategoryTransactions] = useState<{
    category: string;
    items: CategoryTransaction[];
  } | null>(null);

  async function handleCategoryClick(category: string) {
    try {
      const items = await invoke<CategoryTransaction[]>("transactions_for_category", {
        category,
        year: budgetYear,
        month: budgetMonthNum,
      });
      setCategoryTransactions({ category, items });
    } catch (e) {
      setStatus(errorMessage(e));
    }
  }

  // Reconciling a miscategorized transaction from the drill-down dialog —
  // same command the Transactions tab's own category dropdown uses. Refreshes the
  // dialog's own list too (the corrected transaction no longer belongs to
  // the category being viewed, so it should drop out immediately) as well
  // as everywhere else a category total is shown, same as renaming/
  // deleting a category already does.
  // Shared tail end of both handlers below: everywhere a category total
  // or this dialog's own list is shown needs to catch up after either a
  // single or bulk correction from it.
  async function refreshAfterCategoryDialogEdit() {
    await Promise.all([refresh(), refreshBudgetMonthActuals(budgetYear, budgetMonthNum)]);
    if (categoryTransactions) {
      const items = await invoke<CategoryTransaction[]>("transactions_for_category", {
        category: categoryTransactions.category,
        year: budgetYear,
        month: budgetMonthNum,
      });
      setCategoryTransactions({ category: categoryTransactions.category, items });
    }
  }

  async function handleCorrectCategoryFromDialog(transactionId: number, value: string) {
    if (value === "__new__") {
      const custom = await askNewCategory();
      if (!custom) return;
      value = custom;
    }
    try {
      await callTransaction("correct_category", { id: transactionId, category: value });
      await refreshAfterCategoryDialogEdit();
    } catch (e) {
      setStatus(errorMessage(e));
    }
  }

  async function handleBulkCorrectCategoryFromDialog(transactionIds: number[], value: string): Promise<boolean> {
    if (value === "__new__") {
      const custom = await askNewCategory();
      if (!custom) return false;
      value = custom;
    }
    try {
      await callTransaction("bulk_correct_category", { ids: transactionIds, category: value });
      await refreshAfterCategoryDialogEdit();
      return true;
    } catch (e) {
      setStatus(errorMessage(e));
      return false;
    }
  }

  async function handleSetStartingBalance(accountId: number, balance: string) {
    try {
      await invoke("set_account_starting_balance", { id: accountId, balance });
      await refresh();
    } catch (e) {
      setStatus(errorMessage(e));
    }
  }

  async function handleSetBalanceOverride(accountId: number, balance: string) {
    try {
      await invoke("set_account_balance_override", { id: accountId, balance });
      await refresh();
    } catch (e) {
      setStatus(errorMessage(e));
    }
  }

  async function handleUpdateAccountType(accountId: number, accountType: string) {
    try {
      await invoke("update_account_type", { id: accountId, accountType });
      await refresh();
    } catch (e) {
      setStatus(errorMessage(e));
    }
  }

  async function handleSetAccountIcon(accountId: number, iconKey: string | null) {
    try {
      await invoke("set_account_icon", { id: accountId, iconKey });
      await refresh();
    } catch (e) {
      setStatus(errorMessage(e));
    }
  }

  async function handleDeleteAccount(accountId: number) {
    try {
      const removed = await invoke<number>("delete_account", { id: accountId });
      await refresh();
      setStatus(`Deleted account and ${removed} transaction(s).`, "success");
    } catch (e) {
      setStatus(errorMessage(e));
    }
  }

  async function handleSetAccountDetails(accountId: number, institution: string | null, mask: string | null) {
    try {
      await invoke("set_account_details", { id: accountId, institution, mask });
      await refresh();
    } catch (e) {
      setStatus(errorMessage(e));
    }
  }

  async function handleSetAccountInterestRate(accountId: number, rate: string | null) {
    try {
      await invoke("set_account_interest_rate", { id: accountId, rate });
      await refresh();
    } catch (e) {
      setStatus(errorMessage(e));
    }
  }

  async function handleSetAccountExcludedFromDebtPayoff(accountId: number, excluded: boolean) {
    try {
      await invoke("set_account_excluded_from_debt_payoff", { id: accountId, excluded });
      await refresh();
    } catch (e) {
      setStatus(errorMessage(e));
    }
  }

  async function handleCalculateDebtPayoff(
    strategy: string,
    extraPayment: string,
    minimums: { accountId: number; minimumPayment: string }[],
  ): Promise<DebtPayoffPlan | null> {
    try {
      return await invoke<DebtPayoffPlan>("debt_payoff_projection", {
        strategy,
        extraPayment,
        minimums: minimums.map((m) => ({ account_id: m.accountId, minimum_payment: m.minimumPayment })),
      });
    } catch (e) {
      setStatus(errorMessage(e));
      return null;
    }
  }

  async function handleCreateBucket(
    name: string,
    targetAmount: string | null,
    targetDate: string | null,
    accountId: number | null,
    memberId: number | null,
    sinkingAmount: string | null,
    color: string | null,
    iconKey: string | null,
    tracksAccount: boolean,
  ) {
    try {
      const id = await invoke<number>("create_bucket", {
        name,
        targetAmount,
        targetDate,
        accountId,
        sinkingAmount,
        color,
        iconKey,
      });
      if (memberId !== null) {
        await invoke("set_bucket_member", { id, memberId });
      }
      if (tracksAccount && accountId !== null) {
        await invoke("set_bucket_tracks_account", { id, tracksAccount });
      }
      await refreshBuckets();
      // A brand-new auto-contribute bucket didn't exist yet the last time
      // this month's contributions were checked (at launch) — check again
      // now so it doesn't sit at $0 until the app is next reopened.
      if (sinkingAmount !== null) {
        await checkSinkingFundContributions();
        await refreshBuckets();
      }
    } catch (e) {
      setStatus(errorMessage(e));
    }
  }

  async function handleUpdateBucketDetails(
    id: number,
    targetAmount: string | null,
    targetDate: string | null,
    accountId: number | null,
    sinkingAmount: string | null,
    color: string | null,
    iconKey: string | null,
    tracksAccount: boolean,
  ) {
    try {
      await invoke("update_bucket_details", { id, targetAmount, targetDate, accountId, sinkingAmount, color, iconKey });
      await invoke("set_bucket_tracks_account", { id, tracksAccount: tracksAccount && accountId !== null });
      await refreshBuckets();
      // Same reasoning as handleCreateBucket: a sinking amount just added
      // (or changed) here was invisible to the launch-time check, so catch
      // it up immediately rather than making the user reload.
      if (sinkingAmount !== null) {
        await checkSinkingFundContributions();
        await refreshBuckets();
      }
    } catch (e) {
      setStatus(errorMessage(e));
    }
  }

  async function handleAddContribution(bucketId: number, date: string, amount: string, note: string | null) {
    try {
      await invoke("add_bucket_contribution", { bucketId, date, amount, note });
      await refreshBuckets();
    } catch (e) {
      setStatus(errorMessage(e));
    }
  }

  async function handleDeleteBucket(id: number) {
    try {
      await invoke("delete_bucket", { id });
      await refreshBuckets();
    } catch (e) {
      setStatus(errorMessage(e));
    }
  }

  async function handleCreateRecurring(
    merchant: string,
    category: string | null,
    amount: string,
    cadence: string,
    anchorDate: string,
    accountId: number | null,
    memberId: number | null,
  ) {
    try {
      const id = await invoke<number>("create_recurring", { merchant, category, amount, cadence, anchorDate, accountId });
      if (memberId !== null) {
        await invoke("set_recurring_member", { id, memberId });
      }
      await Promise.all([refreshRecurring(), refreshRecurringTotals()]);
    } catch (e) {
      setStatus(errorMessage(e));
    }
  }

  async function handleUpdateRecurring(
    id: number,
    merchant: string,
    category: string | null,
    amount: string,
    cadence: string,
    anchorDate: string,
    accountId: number | null,
    memberId: number | null,
  ) {
    try {
      await invoke("update_recurring", { id, merchant, category, amount, cadence, anchorDate, accountId });
      await invoke("set_recurring_member", { id, memberId });
      await Promise.all([refreshRecurring(), refreshRecurringTotals()]);
    } catch (e) {
      setStatus(errorMessage(e));
    }
  }

  async function handleDeleteRecurring(id: number) {
    try {
      await invoke("delete_recurring", { id });
      await Promise.all([refreshRecurring(), refreshRecurringTotals()]);
    } catch (e) {
      setStatus(errorMessage(e));
    }
  }

  async function handleSetRecurringStatus(id: number, status: "keep" | "reviewing" | "canceled") {
    try {
      await invoke("set_recurring_status", { id, status });
      await refreshRecurring();
    } catch (e) {
      setStatus(errorMessage(e));
    }
  }

  async function handleAddRecurringCandidate(candidate: RecurringCandidate) {
    try {
      await invoke("create_recurring", {
        merchant: candidate.merchant,
        category: candidate.category,
        amount: candidate.amount,
        cadence: candidate.cadence,
        anchorDate: candidate.anchor_date,
        accountId: null,
      });
      await Promise.all([refreshRecurring(), refreshRecurringTotals(), refreshRecurringCandidates()]);
    } catch (e) {
      setStatus(errorMessage(e));
    }
  }

  async function handleDismissRecurringCandidate(candidate: RecurringCandidate) {
    try {
      await invoke("dismiss_recurring_candidate", {
        merchant: candidate.merchant,
        amount: candidate.amount,
        cadence: candidate.cadence,
      });
      await refreshRecurringCandidates();
    } catch (e) {
      setStatus(errorMessage(e));
    }
  }

  async function handleIgnoreRecurringPriceChange(id: number, from: string, to: string) {
    try {
      await invoke("dismiss_recurring_price_change", { id, from, to });
      await refreshRecurringMatches();
    } catch (e) {
      setStatus(errorMessage(e));
    }
  }

  async function handleCreateHolding(
    accountId: number,
    symbol: string,
    name: string,
    shares: string,
    price: string,
    costBasis: string,
    assetClass: string | null,
  ) {
    try {
      await invoke("create_holding", { accountId, symbol, name, shares, price, costBasis, assetClass });
      await refreshHoldings();
    } catch (e) {
      setStatus(errorMessage(e));
    }
  }

  async function handleUpdateHoldingPrice(id: number, price: string) {
    try {
      await invoke("update_holding_price", { id, price });
      await refreshHoldings();
    } catch (e) {
      setStatus(errorMessage(e));
    }
  }

  async function handleSetAllocationTargets(targets: { assetClass: string; percent: string }[]) {
    try {
      for (const t of targets) {
        await invoke("set_allocation_target", { assetClass: t.assetClass, percent: t.percent });
      }
      await refreshHoldings();
      setStatus("Target allocation saved.", "success");
    } catch (e) {
      setStatus(errorMessage(e));
    }
  }

  async function handleSaveProjectionAsGoal(name: string, targetAmount: string, targetDate: string) {
    await handleCreateBucket(name, targetAmount, targetDate, null, null, null, null, null, false);
    setStatus(`Saved "${name}" as a goal — it's on the Goals page.`, "success");
  }

  async function handleDeleteHolding(id: number) {
    try {
      await invoke("delete_holding", { id });
      await refreshHoldings();
    } catch (e) {
      setStatus(errorMessage(e));
    }
  }

  async function handleCreateAsset(
    name: string,
    assetType: string,
    value: string,
    valuedOn: string,
    notes: string | null,
    memberId: number | null,
  ) {
    try {
      const id = await invoke<number>("create_asset", { name, assetType, value, valuedOn, notes });
      if (memberId !== null) {
        await invoke("set_asset_member", { id, memberId });
      }
      await refreshAssets();
    } catch (e) {
      setStatus(errorMessage(e));
    }
  }

  async function handleUpdateAssetValue(id: number, value: string, valuedOn: string) {
    try {
      await invoke("update_asset_value", { id, value, valuedOn });
      await refreshAssets();
    } catch (e) {
      setStatus(errorMessage(e));
    }
  }

  async function handleSetAssetMember(id: number, memberId: number | null) {
    try {
      await invoke("set_asset_member", { id, memberId });
      await refreshAssets();
    } catch (e) {
      setStatus(errorMessage(e));
    }
  }

  async function handleSetAccountMember(accountId: number, memberId: number | null) {
    try {
      await invoke("set_account_member", { id: accountId, memberId });
      await refresh();
    } catch (e) {
      setStatus(errorMessage(e));
    }
  }

  async function handleDeleteAsset(id: number) {
    try {
      await invoke("delete_asset", { id });
      await refreshAssets();
    } catch (e) {
      setStatus(errorMessage(e));
    }
  }

  useEffect(() => {
    // Keep the selection valid as accounts come and go. Prefer whichever
    // account was last actually used (see LAST_USED_ACCOUNT_STORAGE_KEY);
    // failing that, an everyday account (see pickDefaultAccountId) — not
    // just whichever sorts first alphabetically, which was often a loan.
    if (selectedAccountId === null || !accounts.some((a) => a.id === selectedAccountId)) {
      setSelectedAccountId(pickDefaultAccountId(accounts, getLastUsedAccountId()));
    }
  }, [accounts, selectedAccountId]);

  async function handleNewAccount(): Promise<number | null> {
    const result = await askNewAccount();
    if (!result) return null;

    try {
      const id = await invoke<number>("create_account", {
        name: result.name,
        accountType: result.accountType,
        startingBalance: result.startingBalance,
        institution: result.institution,
        mask: result.mask,
        iconKey: result.iconKey,
      });
      if (result.memberId !== null) {
        await invoke("set_account_member", { id, memberId: result.memberId });
      }
      await refresh();
      setSelectedAccountId(id);
      return id;
    } catch (e) {
      setStatus(errorMessage(e));
      return null;
    }
  }

  function handleAccountSelectChange(value: string) {
    if (value === "__new__") {
      handleNewAccount();
      return;
    }
    const id = Number(value);
    setSelectedAccountId(id);
    setLastUsedAccountId(id);
  }

  async function handleImport() {
    let accountId = selectedAccountId;
    if (accountId === null) {
      accountId = await handleNewAccount();
      if (accountId === null) return; // user cancelled account creation
    }

    const path = await open({
      multiple: false,
      filters: [{ name: "Transactions", extensions: ["csv", "ofx", "qfx", "qif"] }],
    });
    if (!path || Array.isArray(path)) return;

    // Offer the answer this account's last import used, or flipping for a credit card file that is mostly
    // positive (charges shown as positive). Reading ahead is only a hint, so a file it can't read asks plainly.
    const account = accounts.find((a) => a.id === accountId);
    const counts = await invoke<ImportSignCounts>("count_import_signs", { path }).catch(() => null);
    const invertAmounts = await askConfirmInvert(account?.name, importSignSuggestion(account, counts));

    await importReview.begin(path, invertAmounts, accountId);
  }

  /** A category fix just saved a rule for each of these merchants (one for a
   * row's dropdown, possibly several for the bulk "Set category to…" bar); if
   * other transactions from them are still sitting in a different category
   * (and weren't categorized by hand), offer to fix those in one click.
   * Purely a convenience — a failure here is never worth surfacing. */

  function openManageCategories() {
    setManageCategoriesOpen(true);
  }

  function openManageFamilyMembers() {
    setManageFamilyMembersOpen(true);
  }

  async function handleCreateFamilyMember(name: string) {
    try {
      await invoke("create_family_member", { name });
      await refresh();
    } catch (e) {
      setStatus(errorMessage(e));
    }
  }

  async function handleRenameFamilyMember(id: number, newName: string) {
    try {
      await invoke("rename_family_member", { id, newName });
      await refresh();
    } catch (e) {
      setStatus(errorMessage(e));
    }
  }

  async function handleDeleteFamilyMember(id: number) {
    try {
      await invoke("delete_family_member", { id });
      await refresh();
    } catch (e) {
      setStatus(errorMessage(e));
    }
  }

  async function handleCreateCategory(name: string, iconKey: string | null) {
    try {
      await invoke("create_category", { name, iconKey });
      await refresh();
    } catch (e) {
      setStatus(errorMessage(e));
    }
  }

  async function handleSetCategoryIcon(name: string, iconKey: string | null) {
    try {
      await invoke("set_category_icon", { name, iconKey });
      await refresh();
    } catch (e) {
      setStatus(errorMessage(e));
    }
  }

  async function handleRenameCategory(oldName: string, newName: string) {
    try {
      await invoke("rename_category", { oldName, newName });
      await Promise.all([refresh(), refreshReport(), refreshBudgetMonthActuals(budgetYear, budgetMonthNum)]);
    } catch (e) {
      setStatus(errorMessage(e));
    }
  }

  async function handleDeleteCategory(name: string) {
    try {
      await invoke("delete_category", { name });
      await Promise.all([refresh(), refreshReport(), refreshBudgetMonthActuals(budgetYear, budgetMonthNum)]);
    } catch (e) {
      setStatus(errorMessage(e));
    }
  }

  async function handleDownloadSetupTemplate() {
    const path = await save({
      defaultPath: "vaultspend-setup-template.csv",
      filters: [{ name: "CSV", extensions: ["csv"] }],
    });
    if (!path) return;
    try {
      await invoke("write_text_file", { path, content: buildSetupTemplate() });
      setStatus(`Setup template saved to ${path} — fill it in, then use "Import setup data…".`, "success");
    } catch (e) {
      setStatus(errorMessage(e));
    }
  }

  async function handleImportSetupData() {
    const path = await open({ multiple: false, filters: [{ name: "CSV", extensions: ["csv"] }] });
    if (!path || Array.isArray(path)) return;
    try {
      const preview = await invoke<SetupImportPreview>("preview_setup_import", { path });
      const total =
        preview.accounts.length +
        preview.categories.length +
        preview.budgets.length +
        preview.buckets.length +
        preview.holdings.length;
      if (total === 0) {
        setStatus(
          preview.row_errors > 0
            ? `Nothing importable found — ${preview.row_errors} row(s) had errors.`
            : "Nothing importable found in that file — is it a filled-in setup template?",
          preview.row_errors > 0 ? "error" : "info",
        );
        return;
      }
      // Duplicates start unchecked, same convention as the transaction
      // import's review screen; budget "will update" rows stay checked
      // since updating an existing budget line is usually the intent.
      // Holdings with an unresolved account start unchecked too — checking
      // one would just get silently skipped at commit time anyway.
      setPendingSetupImport({
        path,
        preview,
        includedAccounts: new Set(preview.accounts.filter((r) => !r.already_exists).map((r) => r.index)),
        includedCategories: new Set(preview.categories.filter((r) => !r.already_exists).map((r) => r.index)),
        includedBudgets: new Set(preview.budgets.map((r) => r.index)),
        includedBuckets: new Set(preview.buckets.filter((r) => !r.already_exists).map((r) => r.index)),
        includedHoldings: new Set(preview.holdings.filter((r) => r.account_found).map((r) => r.index)),
      });
    } catch (e) {
      setStatus(errorMessage(e));
    }
  }

  function toggleSetupIncluded(
    section: "includedAccounts" | "includedCategories" | "includedBudgets" | "includedBuckets" | "includedHoldings",
    index: number,
  ) {
    setPendingSetupImport((prev) => {
      if (!prev) return prev;
      const next = new Set(prev[section]);
      if (next.has(index)) next.delete(index);
      else next.add(index);
      return { ...prev, [section]: next };
    });
  }

  async function confirmSetupImport() {
    if (!pendingSetupImport) return;
    setBusy(true);
    try {
      const summary = await invoke<SetupImportSummary>("commit_setup_import", {
        path: pendingSetupImport.path,
        includedAccounts: Array.from(pendingSetupImport.includedAccounts),
        includedCategories: Array.from(pendingSetupImport.includedCategories),
        includedBudgets: Array.from(pendingSetupImport.includedBudgets),
        includedBuckets: Array.from(pendingSetupImport.includedBuckets),
        includedHoldings: Array.from(pendingSetupImport.includedHoldings),
      });
      setPendingSetupImport(null);
      await Promise.all([refresh(), refreshBuckets(), refreshReport(), refreshHoldings()]);
      const parts = [
        `${summary.accounts_created} account(s)`,
        `${summary.categories_created} categor${summary.categories_created === 1 ? "y" : "ies"}`,
        `${summary.budgets_set} budget line(s)`,
        `${summary.buckets_created} goal(s)`,
        `${summary.holdings_created} holding(s)`,
      ];
      let message = `Setup import done: ${parts.join(", ")}.`;
      if (summary.skipped.length > 0) message += ` Skipped: ${summary.skipped.join("; ")}.`;
      if (summary.row_errors > 0) message += ` ${summary.row_errors} row(s) had errors and were ignored.`;
      setStatus(message, summary.row_errors > 0 ? "error" : "success");
    } catch (e) {
      setStatus(errorMessage(e));
    } finally {
      setBusy(false);
    }
  }

  async function handleExportReportsCsv() {
    if (profiles.find((p) => p.is_active)?.is_password_protected && !(await askCsvExportWarning())) return;
    const path = await save({
      defaultPath: `reports-export-${toLocalIsoDate()}.csv`,
      filters: [{ name: "CSV", extensions: ["csv"] }],
    });
    if (!path) return;
    try {
      const accountsCsv = toCsv(
        ["Account", "Type", "Balance / Limit", "Current Balance"],
        accounts.map((a) => [a.name, a.account_type, a.starting_balance, a.current_balance]),
        ["text", "text", "decimal", "decimal"],
      );
      const budgetCsv = toCsv(
        ["Category", "Group", "Budgeted", "Actual"],
        (report?.budget_actuals ?? []).map((b) => [b.category, b.budget_group, b.budgeted, b.actual]),
        ["text", "text", "decimal", "decimal"],
      );
      const csv = `Accounts\r\n${accountsCsv}\r\n${report?.month_label ?? ""}'s Budget\r\n${budgetCsv}`;
      await invoke("write_text_file", { path, content: csv });
      setStatus(`Exported reports to ${path}.`, "success");
    } catch (e) {
      setStatus(errorMessage(e));
    }
  }

  const handleExportLedgerCsv = createTransactionExporter({ rows: sortedTransactions, isProtected: profiles.some(p => p.is_active && p.is_password_protected), confirmPlaintext: askCsvExportWarning, call: callTransaction, onStatus: setStatus });

  // No dedicated bulk backend command — `add_tag` is already a cheap
  // single-row insert, so a client-side loop plus one shared `refresh()`
  // at the end (same shape as `handleBulkMemberChange`/
  // `handleBulkCategoryChange`) is simpler than adding a new command for
  // what's still, in total, a handful of rows.

  // Rows imported the wrong way round (a card export with charges as positive, imported with "Keep as-is").

  return (
    <div className={sidebarExpanded ? "app-shell sidebar-expanded" : "app-shell"}>
      {showWelcome && (
        <WelcomeDialog onExploreHelp={handleExploreHelpFromWelcome} onGetStarted={dismissWelcome} />
      )}
      {!showWelcome && whatsNewVersion && (
        <WhatsNewDialog version={whatsNewVersion} notes={CHANGELOG[whatsNewVersion]} onClose={dismissWhatsNew} />
      )}
      <aside className="sidebar" id="app-sidebar" ref={sidebarRef} onBlur={handleSidebarBlur}>
        {/* Only this part scrolls, so the controls below never cover a tab. */}
        <div className="sidebar-scroll">
          <button
            type="button"
            className="sidebar-expand"
            data-sidebar-expand
            aria-expanded={sidebarExpanded}
            aria-controls="app-sidebar"
            aria-label={sidebarExpanded ? "Hide names" : "Show names"}
            title={sidebarExpanded ? "Hide names" : "Show names"}
            onClick={() => setSidebarExpanded((v) => !v)}
          >
            <span aria-hidden="true">☰</span>
          </button>
          <div className="brand">
            <img className="brand-mark" src={vaultSpendIcon} alt="" />
            <span className="brand-word">Vault Spend</span>
          </div>
          <ProfileSwitcher
            profiles={profiles}
            onSwitchProfile={handleSwitchProfile}
            onManageProfiles={() => {
              setActiveTab("settings");
              setSidebarExpanded(false);
            }}
            onLock={profiles.find((p) => p.is_active)?.is_password_protected ? handleLockProfile : undefined}
          />
          <SidebarNav
            items={orderedNavItems}
            iconOnly={sidebarIconOnly}
            activeTab={activeTab}
            dragNavTab={dragNavTab}
            onSelect={(tab) => {
              setActiveTab(tab);
              setSidebarExpanded(false);
            }}
            onDragStartItem={setDragNavTab}
            onDragEndItem={() => setDragNavTab(null)}
            onDropItem={handleNavDrop}
            onMoveItem={moveNavItem}
          />
        </div>
        <div className="sidebar-foot">
          <SidebarControls
            privacyHidden={privacyPrefs.hidden}
            onTogglePrivacy={() => setPrivacyPrefs((p) => ({ ...p, hidden: !p.hidden }))}
            theme={theme}
            onSetTheme={setTheme}
          />
          {appVersion && <p className="sidebar-version">v{appVersion}</p>}
        </div>
      </aside>

      <div className="main" ref={mainScrollRef}>
        <div className={activeTab === "ledger" ? "page page-ledger" : "page"} role="main">

          <UpdateBanner />
          {/* Body level, like the dialogs: `position: fixed` inside `.page` is laid out
          against the whole page under the Transparent style's backdrop-filter. */}
          {createPortal(
            <div className="toast-stack">
              {status && <StatusBanner text={status.text} kind={status.kind} onDismiss={() => setStatusState(null)} />}
              {undoToast && (
                <StatusBanner
                  text={undoToast.text}
                  kind="info"
                  action={{ label: "Undo", onClick: handleUndoBulkDelete }}
                  onDismiss={() => setUndoToast(null)}
                />
              )}
              {dismissUndoToast && (
                <StatusBanner
                  text={dismissUndoToast.text}
                  kind="info"
                  action={{ label: "Undo", onClick: handleUndoDismissTransferCandidates }}
                  onDismiss={() => setDismissUndoToast(null)}
                />
              )}
              {similarToast && (
                <StatusBanner
                  text={similarToast.text}
                  kind="info"
                  action={{ label: `Apply to ${similarToast.count}`, onClick: handleApplyToSimilar }}
                  onDismiss={() => setSimilarToast(null)}
                />
              )}
            </div>,
            document.body,
          )}

          {dataLoaded && <TransactionReadState initial={false} loading={transactionData.loading} error={transactionData.error?.message ?? null} onRetry={() => void refresh().catch(() => {})} />}
          {!dataLoaded && activeTab !== "settings" && activeTab !== "help" ? (
            transactionData.error ? <TransactionReadState initial loading={false} error={transactionData.error.message} onRetry={() => void refresh().catch(() => {})} /> : <DataLoading />
          ) : (
          <>
          {activeTab === "dashboard" && (
            <Suspense fallback={null}>
              <DashboardView
                onOpenHelp={openHelpFor}
                accounts={accounts}
                netWorthHistory={netWorthHistory}
                accountContributionDeltas={accountContributionDeltas}
                spendingThisMonth={spendingThisMonth}
                report={report}
                recurring={recurring}
                recurringMatches={recurringMatches}
                monthReviewOffer={monthReviewOffer}
                onOpenMonthReview={handleOpenMonthReview}
                transactions={transactions}
                budgetAlerts={dashboardBudgetAlerts}
                insights={dashboardInsights}
                avgMonthlySpend={avgMonthlySpend}
                assetsTotal={sumMoney(assets.map((a) => a.value))}
                assets={assets}
                holdings={holdings}
                familyMembers={familyMembers}
                buckets={buckets}
                categories={usedCategories}
                categoryIconMap={categoryIconMap}
                topCategoriesData={topCategoriesData}
                layoutWidgets={layoutWidgets}
                onSetLayoutWidgets={setLayoutWidgets}
                onOpenAddWidget={() => setAddWidgetModalOpen(true)}
                onOpenLedger={() => setActiveTab("ledger")}
                onOpenRecurring={() => setActiveTab("recurring")}
                onOpenBudget={() => setActiveTab("budget")}
                onOpenCashFlow={() => setActiveTab("cashflow")}
                onOpenInvestments={() => setActiveTab("investments")}
                onOpenReports={() => setActiveTab("reports")}
                onOpenAccounts={() => setActiveTab("accounts")}
                onOpenBuckets={() => setActiveTab("buckets")}
                onOpenUncategorized={() => {
                  setFilterCategory(UNCATEGORIZED_FILTER);
                  setActiveTab("ledger");
                }}
                safeToSpendForecast={safeToSpendForecast}
                safeToSpendEnabled={appSettingsLoaded && appSettings.safe_to_spend_enabled}
                onAddTransaction={() => setNewTransactionOpen(true)}
                onAddAccount={handleNewAccount}
              />
            </Suspense>
          )}

          {activeTab === "ledger" && (
            <div className="page-top">
              <div>
                <div className="view-title-row">
                  <h1 className="view-title">Transactions</h1>
                  <HelpLink tab="ledger" onOpen={openHelpFor} />
                </div>
                <p className="view-sub" data-ledger-subtitle>
                  {transactions.length} transaction{transactions.length === 1 ? "" : "s"} across {accounts.length} account
                  {accounts.length === 1 ? "" : "s"}.
                  {/* The counts the old tiles showed, kept here. */}
                  {stats && (stats.auto_categorized > 0 || stats.user_confirmed > 0)
                    ? ` ${stats.auto_categorized} sorted automatically, ${stats.user_confirmed} by you.`
                    : null}
                </p>
              </div>
              <div className="page-actions">
                {inboxCount > 0 && (
                  <button type="button" className="modal-secondary" onClick={openInbox} data-inbox-open>
                    Review inbox ({inboxCount})
                  </button>
                )}
                <LedgerPageActions
                  accounts={accounts}
                  selectedAccountId={selectedAccountId}
                  handleAccountSelectChange={handleAccountSelectChange}
                  busy={busy}
                  importReview={importReview}
                  dataLoaded={dataLoaded}
                  handleImport={handleImport}
                  setNewTransactionOpen={setNewTransactionOpen}
                  moreMenuRef={moreMenuRef}
                  setMoreMenuOpen={setMoreMenuOpen}
                  moreMenuOpen={moreMenuOpen}
                  moreMenuShouldRender={moreMenuShouldRender}
                  moreMenuClosing={moreMenuClosing}
                  openManageCategories={openManageCategories}
                  openManageFamilyMembers={openManageFamilyMembers}
                  handleRecategorize={handleRecategorize}
                  handleExportLedgerCsv={handleExportLedgerCsv}
                />
              </div>
            </div>
          )}

          {/* Pop-ups over whichever tab started them, so they are in front of the person wherever
              they had scrolled (the setup-data one is started from Settings). */}
          <ImportReviewDialog review={importReview} accounts={accounts} categoryOptions={categoryOptions} busy={busy} />
          {pendingSetupImport && (
            <SetupImportReviewDialog
              pending={pendingSetupImport}
              busy={busy}
              onToggle={toggleSetupIncluded}
              onCancel={() => setPendingSetupImport(null)}
              onConfirm={confirmSetupImport}
            />
          )}

          {activeTab === "ledger" && reviewIds && reviewIds.size > 0 && (
            <RecategorizedReviewPanel
              reviewIds={reviewIds}
              transactions={transactions}
              handleCategoryChange={handleCategoryChange}
              categoryOptions={categoryOptions}
              setReviewIds={setReviewIds}
            />
          )}

          {activeTab === "ledger" && stats && (
            <LedgerNeedsCategory
              count={stats.uncategorized}
              active={filterCategory === UNCATEGORIZED_FILTER}
              onToggle={() => setFilterCategory((c) => (c === UNCATEGORIZED_FILTER ? "all" : UNCATEGORIZED_FILTER))}
            />
          )}

          {activeTab === "ledger" && (
            <LedgerFilterBar
              searchText={searchText}
              setSearchText={setSearchText}
              categoryFilterOptions={categoryFilterOptions}
              filterCategory={filterCategory}
              setFilterCategory={setFilterCategory}
              accounts={accounts}
              filterAccountIds={filterAccountIds}
              setFilterAccountIds={setFilterAccountIds}
              familyMembers={familyMembers}
              filterMemberIds={filterMemberIds}
              setFilterMemberIds={setFilterMemberIds}
              filterFrom={filterFrom}
              setFilterFrom={setFilterFrom}
              filterTo={filterTo}
              setFilterTo={setFilterTo}
              filterTag={filterTag}
              allTags={allTags}
              setFilterTag={setFilterTag}
            />
          )}

          {activeTab === "ledger" && (
            <LedgerSavedFilters
              savedFilters={savedFilters}
              applySavedFilter={applySavedFilter}
              deleteSavedFilter={deleteSavedFilter}
              savingFilter={savingFilter}
              saveCurrentFilter={saveCurrentFilter}
              newFilterName={newFilterName}
              setNewFilterName={setNewFilterName}
              setSavingFilter={setSavingFilter}
              transferCandidatePairs={transferCandidatePairs}
              setTransferReviewOpen={setTransferReviewOpen}
              autoLinkedPairs={autoLinkedPairs}
              setAutoLinkReviewOpen={setAutoLinkReviewOpen}
            />
          )}

          {activeTab === "ledger" && selectedIds.size > 0 && selectAllMessage && (
            <p className="select-all-note" role="status" data-select-all-note>
              {selectAllMessage}
            </p>
          )}
          {activeTab === "ledger" && selectedIds.size > 0 && (
            <LedgerBulkActions
              selectedIds={selectedIds}
              handleBulkCategoryChange={handleBulkCategoryChange}
              categoryOptions={categoryOptions}
              handleAddSelectedToRecurring={handleAddSelectedToRecurring}
              familyMembers={familyMembers}
              handleBulkMemberChange={handleBulkMemberChange}
              allTags={allTags}
              bulkTagText={bulkTagText}
              setBulkTagText={setBulkTagText}
              handleBulkAddTag={handleBulkAddTag}
              confirmingBulkDelete={confirmingBulkDelete}
              setConfirmingBulkDelete={setConfirmingBulkDelete}
              handleBulkDelete={handleBulkDelete}
              confirmingBulkFlip={confirmingBulkFlip}
              selectedAccountNames={selectedAccountNames}
              setConfirmingBulkFlip={setConfirmingBulkFlip}
              handleBulkFlipSigns={handleBulkFlipSigns}
              selectedPairForLink={selectedPairForLink}
              handleLinkSelectedAsTransfer={handleLinkSelectedAsTransfer}
              setSelectedIds={setSelectedIds}
            />
          )}

          {activeTab === "ledger" && (
            <>
              {ledgerNarrow && (
                <div className="ledger-sort-by">
                  <label className="labeled-field">
                    <span className="labeled-field-label">Sort by</span>
                    <MenuSelect
                      ariaLabel="Sort by"
                      value={sortColumn}
                      onChange={(v) => setSortColumn(v as LedgerSortColumn)}
                      options={[
                        { value: "date", label: "Date" },
                        { value: "description", label: "Description" },
                        { value: "amount", label: "Amount" },
                        { value: "account", label: "Account" },
                        { value: "category", label: "Category" },
                        { value: "source", label: "Sorted by" },
                      ]}
                    />
                  </label>
                  <button
                    type="button"
                    className="modal-secondary"
                    onClick={() => setSortDirection((d) => (d === "asc" ? "desc" : "asc"))}
                    aria-label={`Sort direction: ${sortDirection === "asc" ? "ascending" : "descending"}`}
                  >
                    {sortDirection === "asc" ? "▲ Ascending" : "▼ Descending"}
                  </button>
                </div>
              )}
              <LedgerTable
              setLedgerScrollEl={setLedgerScrollEl}
              ledgerDensity={ledgerDensity}
              ledgerNarrow={ledgerNarrow}
              showMemberCol={showMemberCol}
              appSettings={appSettings}
              selectAllBatch={selectAllBatch}
              selectedIds={selectedIds}
              toggleSelectAll={toggleSelectAll}
              sortColumn={sortColumn}
              sortDirection={sortDirection}
              toggleSort={toggleSort}
              pagedTransactions={pagedTransactions}
              inLegByOutId={inLegByOutId}
              highlightedPaymentRow={highlightedPaymentRow}
              toggleSelectedMany={toggleSelectedMany}
              handleUnlinkTransfer={handleUnlinkTransfer}
              setNotesDialogFor={setNotesDialogFor}
              detailsOpenId={detailsOpenId}
              setDetailsOpenId={setDetailsOpenId}
              accounts={accounts}
              handleAccountChangeForTransaction={handleAccountChangeForTransaction}
              familyMembers={familyMembers}
              handleMemberChangeForTransaction={handleMemberChangeForTransaction}
              categoryOptions={categoryOptions}
              handleCategoryChange={handleCategoryChange}
              toggleSplitEditor={toggleSplitEditor}
              editingPrincipalId={editingPrincipalId}
              principalDraft={principalDraft}
              setPrincipalDraft={setPrincipalDraft}
              handleSetPrincipalAmount={handleSetPrincipalAmount}
              setEditingPrincipalId={setEditingPrincipalId}
              handleResetPrincipalAmount={handleResetPrincipalAmount}
              startEditingPrincipal={startEditingPrincipal}
              handleUnapplyDebtPayment={handleUnapplyDebtPayment}
              applyingDebtId={applyingDebtId}
              applyDebtForm={applyDebtForm}
              setApplyDebtForm={setApplyDebtForm}
              debtAccounts={debtAccounts}
              handleApplyDebtPayment={handleApplyDebtPayment}
              setApplyingDebtId={setApplyingDebtId}
              startApplyingDebtPayment={startApplyingDebtPayment}
              toggleSelected={toggleSelected}
              editingDate={editingDate}
              setEditingDate={setEditingDate}
              commitDateEdit={commitDateEdit}
              categoryIconMap={categoryIconMap}
              editingDescription={editingDescription}
              setEditingDescription={setEditingDescription}
              commitDescriptionEdit={commitDescriptionEdit}
              anomalyFlagsByTransaction={anomalyFlagsByTransaction}
              handleRemoveTag={handleRemoveTag}
              allTags={allTags}
              newTagText={newTagText}
              setNewTagText={setNewTagText}
              handleAddTag={handleAddTag}
              taggingId={taggingId}
              setTaggingId={setTaggingId}
              editingAmount={editingAmount}
              setEditingAmount={setEditingAmount}
              commitAmountEdit={commitAmountEdit}
              confirmingDeleteId={confirmingDeleteId}
              setConfirmingDeleteId={setConfirmingDeleteId}
              handleDeleteTransaction={handleDeleteTransaction}
              ledgerColumnCount={ledgerColumnCount}
              expandedSplitId={expandedSplitId}
              splitLines={splitLines}
              updateSplitLine={updateSplitLine}
              removeSplitLine={removeSplitLine}
              addSplitLine={addSplitLine}
              splitRemaining={splitRemaining}
              saveSplits={saveSplits}
              clearSplits={clearSplits}
              setExpandedSplitId={setExpandedSplitId}
              filteredTransactions={filteredTransactions}
              transactions={transactions}
            />
            </>
          )}

          {activeTab === "ledger" && filteredTransactions.length > 0 && (
            <div className="ledger-pagination">
              <label className="ledger-page-size">
                Show
                <MenuSelect
                  ariaLabel="Rows at a time"
                  value={String(pageSize)}
                  onChange={(v) => setPageSize(Number(v))}
                  options={LEDGER_STEPS.map((step) => ({ value: String(step), label: String(step) }))}
                />
                at a time
              </label>
              <span className="ledger-page-count" aria-live="polite" data-ledger-shown>
                {ledgerShownLabel(shownTransactions.shown, shownTransactions.total)}
              </span>
              {showMoreLabel(shownCount, displayTransactions.length, pageSize) && (
                <button type="button" className="modal-secondary" onClick={() => setShownCount((count) => count + pageSize)} data-ledger-show-more>
                  {showMoreLabel(shownCount, displayTransactions.length, pageSize)}
                </button>
              )}
            </div>
          )}

          {activeTab === "buckets" && (
            <Suspense fallback={null}>
              <BucketsView
                onOpenHelp={openHelpFor}
                avgMonthlySpend={avgMonthlySpend}
                buckets={buckets}
                accounts={accounts}
                familyMembers={familyMembers}
                onCreateBucket={handleCreateBucket}
                onUpdateBucketDetails={handleUpdateBucketDetails}
                onAddContribution={handleAddContribution}
                onDeleteBucket={handleDeleteBucket}
              />
            </Suspense>
          )}

          {activeTab === "budget" && (
            <Suspense fallback={null}>
              <BudgetView
                onOpenHelp={openHelpFor}
                readReady={budgetSnapshot !== null}
                readLoading={budgetRead.state?.key === budgetMonthKey ? budgetRead.state.loading : !budgetSnapshot}
                readError={budgetRead.state?.key === budgetMonthKey ? budgetRead.state.error?.message ?? null : null}
                onRetryRead={() => void refreshBudgetMonthActuals(budgetYear, budgetMonthNum).catch(() => {})}
                categories={usedCategories}
                budgetActuals={budgetMonthActuals}
                monthFlow={budgetMonthFlow}
                budgetAlerts={budgetAlerts}
                monthLabel={budgetMonthLabel}
                year={budgetYear}
                month={budgetMonthNum}
                onPrevMonth={handlePrevBudgetMonth}
                onNextMonth={handleNextBudgetMonth}
                onSetBudget={handleSetBudget}
                onSetCap={handleSetCap}
                onSetRollover={handleSetRollover}
                envelopeCapsEnabled={appSettings.envelope_caps_enabled}
                rolloverEnabled={appSettings.rollover_enabled}
                onDeleteBudget={handleDeleteBudget}
                onCategoryClick={handleCategoryClick}
                onFetchTrend={handleFetchBudgetTrend}
                onSuggest={handleSuggestBudgets}
                onApplySuggestions={handleApplyBudgetSuggestions}
                onOpenMonthReview={() => void handleOpenMonthReview(budgetYear, budgetMonthNum)}
                amountsHidden={amountsHidden}
              />
            </Suspense>
          )}

          {activeTab === "household" && <FinancialReadState label="Household budget totals" initial={!budgetSnapshot} loading={budgetRead.state?.key === budgetMonthKey ? budgetRead.state.loading : !budgetSnapshot} error={budgetRead.state?.key === budgetMonthKey ? budgetRead.state.error?.message ?? null : null} onRetry={() => void refreshBudgetMonthActuals(budgetYear, budgetMonthNum).catch(() => {})} />}
          {activeTab === "household" && (
            <Suspense fallback={null}>
              <HouseholdView
                onOpenHelp={openHelpFor}
                transactions={transactions}
                accounts={accounts}
                assets={assets}
                familyMembers={familyMembers}
                memberBudgetActuals={memberBudgetActuals}
                budgetReadReady={!!budgetSnapshot}
                monthLabel={budgetMonthLabel}
                year={budgetYear}
                month={budgetMonthNum}
                onPrevMonth={handlePrevBudgetMonth}
                onNextMonth={handleNextBudgetMonth}
                onManageMembers={openManageFamilyMembers}
              />
            </Suspense>
          )}

          {categoryTransactions && (
            <CategoryTransactionsDialog
              category={categoryTransactions.category}
              monthLabel={budgetMonthLabel}
              transactions={categoryTransactions.items}
              categoryOptions={categoryOptions}
              onCorrectCategory={handleCorrectCategoryFromDialog}
              onBulkCorrectCategory={handleBulkCorrectCategoryFromDialog}
              onClose={() => setCategoryTransactions(null)}
            />
          )}

          {activeTab === "recurring" && (
            <Suspense fallback={null}>
              <RecurringView
                onOpenHelp={openHelpFor}
                recurring={recurring}
                matches={recurringMatches}
                totals={recurringTotals}
                candidates={recurringCandidates}
                accounts={accounts}
                familyMembers={familyMembers}
                categoryIconMap={categoryIconMap}
                onCreate={handleCreateRecurring}
                onUpdate={handleUpdateRecurring}
                onDelete={handleDeleteRecurring}
                onSetStatus={handleSetRecurringStatus}
                onAddCandidate={handleAddRecurringCandidate}
                onDismissCandidate={handleDismissRecurringCandidate}
                onIgnorePriceChange={handleIgnoreRecurringPriceChange}
              />
            </Suspense>
          )}

          {activeTab === "investments" && (
            <Suspense fallback={null}>
              <InvestmentsView
                onOpenHelp={openHelpFor}
                holdings={holdings}
                accounts={accounts}
                onCreate={handleCreateHolding}
                onImportSaved={async (count, account) => {
                  try {
                    await refresh();
                    await refreshHoldings();
                    await refreshReport();
                    setStatus(`Added ${count} holdings to ${account}.`, "success");
                  } catch (e) {
                    setStatus(`Holdings were saved. Could not refresh totals: ${errorMessage(e)}`);
                  }
                }}
                onUpdatePrice={handleUpdateHoldingPrice}
                onDelete={handleDeleteHolding}
                livePricesEnabled={livePriceSettings?.enabled ?? false}
                onFetchQuote={handleFetchLiveQuote}
                layoutWidgets={layoutWidgets}
                onPinWidget={(id) => addWidgetToDashboard(id, true)}
                portfolioHistory={portfolioHistory}
                allocationTargets={allocationTargets}
                onSetAllocationTargets={handleSetAllocationTargets}
                onSaveProjectionAsGoal={handleSaveProjectionAsGoal}
                onOpenAccountDetail={(id) => {
                  setAccountDetailId(id);
                  setDetailReturnTab("investments");
                  setActiveTab("accounts");
                }}
              />
            </Suspense>
          )}

          {activeTab === "help" && (
            <Suspense fallback={null}>
              <HelpView focusTab={helpFocus} />
            </Suspense>
          )}

          {activeTab === "cashflow" && (
            <Suspense fallback={null}>
              <CashFlowView
                onOpenHelp={openHelpFor}
                cashFlow={cashFlow}
                range={cashFlowRange}
                onSetRange={setCashFlowRange}
                compareLastYear={compareLastYear}
                onToggleCompareLastYear={() => setCompareLastYear((v) => !v)}
                yoyCashFlow={yoyCashFlow}
                onMonthClick={handleMonthClick}
                topCategoriesData={topCategoriesData}
                topCategoriesMonth={topCategoriesMonth}
                onSetTopCategoriesMonth={(year, month) => {
                  setTopCategoriesData(null);
                  setTopCategoriesMonth({ year, month });
                }}
                previousMonthCategorySpending={previousMonthCategorySpending}
                forecastData={forecastData}
                forecastDays={forecastDays}
                onSetForecastDays={setForecastDays}
                accounts={accounts}
                onSetAccountInterestRate={handleSetAccountInterestRate}
                onCalculateDebtPayoff={handleCalculateDebtPayoff}
                onSetAccountExcludedFromDebtPayoff={handleSetAccountExcludedFromDebtPayoff}
                layoutWidgets={layoutWidgets}
                onPinWidget={(id) => addWidgetToDashboard(id, true)}
              />
            </Suspense>
          )}

          {monthDetail && <MonthExpenseDetailDialog detail={monthDetail} onClose={() => setMonthDetail(null)} />}

          {activeTab === "accounts" && accountDetail && (
            <AccountDetailView
              key={accountDetail.id}
              account={accountDetail}
              onBack={() => {
                if (detailReturnTab) setActiveTab(detailReturnTab);
                else setAccountDetailId(null);
              }}
              backLabel={detailReturnTab === "investments" ? "← Investments" : undefined}
              onOpenTransactions={() => setActiveTab("ledger")}
              onOpenPayment={openPayment}
              onMessage={(text, kind) => setStatus(text, kind)}
              focus={detailFocus}
            />
          )}

          {activeTab === "accounts" && !accountDetail && (
            <Suspense fallback={null}>
              <AccountsView
                onOpenHelp={openHelpFor}
                accounts={accounts}
                manualAssetsTotal={sumMoney(assets.map((a) => a.value))}
                netWorthHistory={netWorthHistory}
                accountContributionDeltas={accountContributionDeltas}
                onSetStartingBalance={handleSetStartingBalance}
                onSetBalanceOverride={handleSetBalanceOverride}
                onUpdateAccountType={handleUpdateAccountType}
                onDeleteAccount={handleDeleteAccount}
                onSetAccountDetails={handleSetAccountDetails}
                familyMembers={familyMembers}
                onSetAccountMember={handleSetAccountMember}
                onSetAccountIcon={handleSetAccountIcon}
                onAddAccount={handleNewAccount}
                onOpenAccountDetail={(id, focus) => {
                  setDetailFocus(focus ?? null);
                  setAccountDetailId(id);
                }}
                assets={assets}
                onCreateAsset={handleCreateAsset}
                onUpdateAssetValue={handleUpdateAssetValue}
                onSetAssetMember={handleSetAssetMember}
                onDeleteAsset={handleDeleteAsset}
              />
            </Suspense>
          )}

          {activeTab === "reports" && !pendingSetupImport && (
            <Suspense fallback={null}>
              <ReportsView
                onOpenHelp={openHelpFor}
                accounts={accounts}
                transactions={transactions}
                assets={assets}
                familyMembers={familyMembers}
                dataRevision={transactionRevision}
                onExportCsv={handleExportReportsCsv}
                onPrint={() => window.print()}
                onOpenBudget={() => setActiveTab("budget")}
                layoutWidgets={layoutWidgets}
                onPinWidget={(id) => addWidgetToDashboard(id, true)}
              />
            </Suspense>
          )}

          {activeTab === "settings" && (
            <Suspense fallback={null}>
              <SettingsView
                onOpenHelp={openHelpFor}
                appVersion={appVersion}
                dataFileLocation={dataFileLocation}
                onRelocateDataFile={handleRelocateDataFile}
                onExportDatabase={handleExportDatabase}
                backups={backups}
                onCreateBackupNow={handleCreateBackupNow}
                onRestoreBackup={handleRestoreBackup}
                backupCopyDir={backupCopyDir}
                onSetBackupCopyDir={handleSetBackupCopyDir}
                onBrowseBackupCopyDir={handleBrowseBackupCopyDir}
                profiles={profiles}
                onCreateProfile={handleCreateProfile}
                onUseExistingDataFile={handlePickExistingDataFile}
                onSwitchProfile={handleSwitchProfile}
                onRenameProfile={handleRenameProfile}
                onSetProfileIcon={handleSetProfileIcon}
                onDeleteProfile={handleDeleteProfile}
                onProtected={() => void refreshProtectionState()}
                livePriceSettings={livePriceSettings}
                onSetLivePriceApiKey={handleSetLivePriceApiKey}
                onRefreshLivePrices={handleRefreshLivePrices}
                appSettings={appSettings}
                onSetApplyToDebtEnabled={handleSetApplyToDebtEnabled}
                onSetSplitPurchasesEnabled={handleSetSplitPurchasesEnabled}
                onSetEnvelopeCapsEnabled={handleSetEnvelopeCapsEnabled}
                onSetRolloverEnabled={handleSetRolloverEnabled}
                onSetAutoLinkTransfers={handleSetAutoLinkTransfers}
                onSetSafeToSpendEnabled={handleSetSafeToSpendEnabled}
                themeStyle={themeStyle}
                onSetThemeStyle={setThemeStyle}
                appearance={appearance}
                onSetAppearance={setAppearance}
                theme={theme}
                onSetTheme={setTheme}
                resolvedTheme={resolvedTheme}
                privacyAutoHide={privacyPrefs.autoHide}
                onSetPrivacyAutoHide={(autoHide) => setPrivacyPrefs((p) => ({ ...p, autoHide }))}
                onDownloadSetupTemplate={handleDownloadSetupTemplate}
                onImportSetupData={handleImportSetupData}
                backgroundSettings={backgroundSettings}
                onSetTray={handleSetTray}
                onSetAutostart={handleSetAutostart}
                onSendTestReminder={handleSendTestReminder}
                showBillNamesInReminders={showBillNamesInReminders}
                onSetShowBillNamesInReminders={handleSetShowBillNamesInReminders}
                categories={usedCategories}
                onRulesApplied={() => void refresh()}
                onMessage={(text, kind) => setStatus(text, kind)}
              />
            </Suspense>
          )}
          </>
          )}

          {dialog?.kind === "newAccount" && (
            <NewAccountDialog
              familyMembers={familyMembers}
              existingAccountNames={accounts.map((a) => a.name)}
              onCancel={() => {
                dialog.resolve(null);
                setDialog(null);
              }}
              onSubmit={(name, accountType, startingBalance, institution, mask, memberId, iconKey) => {
                dialog.resolve({ name, accountType, startingBalance, institution, mask, memberId, iconKey });
                setDialog(null);
              }}
            />
          )}
          {dialog?.kind === "newCategory" && (
            <NewCategoryDialog
              onCancel={() => {
                dialog.resolve(null);
                setDialog(null);
              }}
              onSubmit={async (name, iconKey) => {
                try {
                  await invoke("create_category", { name, iconKey });
                  await refresh();
                } catch (e) {
                  setStatus(errorMessage(e));
                }
                dialog.resolve(name);
                setDialog(null);
              }}
            />
          )}
          {dialog?.kind === "confirmInvert" && (
            <ConfirmInvertDialog
              accountName={dialog.accountName}
              suggestion={dialog.suggestion}
              onCancel={() => {
                dialog.resolve(false);
                setDialog(null);
              }}
              onConfirm={() => {
                dialog.resolve(true);
                setDialog(null);
              }}
            />
          )}
          {dialog?.kind === "csvExportWarning" && (
            <CsvExportWarningDialog
              onCancel={() => {
                dialog.resolve(false);
                setDialog(null);
              }}
              onConfirm={() => {
                dialog.resolve(true);
                setDialog(null);
              }}
            />
          )}
          {addWidgetModalOpen && (
            <AddWidgetDialog
              currentWidgets={layoutWidgets}
              accounts={accounts}
              buckets={buckets}
              holdings={holdings}
              safeToSpendEnabled={appSettingsLoaded && appSettings.safe_to_spend_enabled}
              onAdd={(id) => addWidgetToDashboard(id, false)}
              onCancel={() => setAddWidgetModalOpen(false)}
            />
          )}
          {manageCategoriesOpen && (
            <ManageCategoriesDialog
              categories={usedCategories}
              categoryIconMap={categoryIconMap}
              onCancel={() => setManageCategoriesOpen(false)}
              onCreate={handleCreateCategory}
              onSetIcon={handleSetCategoryIcon}
              onRename={handleRenameCategory}
              onDelete={handleDeleteCategory}
            />
          )}
          {paletteOpen && <CommandPalette entries={paletteEntries} onRun={runPaletteEntry} onClose={() => setPaletteOpen(false)} />}
          {manualLock.needsConfirmation && (
            <ModalShell title="Lock this profile?" onCancel={manualLock.cancel}>
              <p className="modal-message">Locking now will discard anything you haven't saved.</p>
              <div className="modal-actions">
                <button type="button" className="modal-secondary" autoFocus onClick={manualLock.cancel}>Keep editing</button>
                <button type="button" onClick={() => void manualLock.confirm()}>Discard and lock</button>
              </div>
            </ModalShell>
          )}
          {shortcutsOpen && <ShortcutsDialog onClose={() => setShortcutsOpen(false)} />}
          {inbox && (
            <ImportInboxDialog
              items={inbox}
              categories={usedCategories}
              onSetCategory={handleInboxSetCategory}
              onDelete={handleInboxDelete}
              onDismiss={handleInboxDismiss}
              onClose={() => void closeInbox()}
            />
          )}
          {monthReview && (
            <MonthReviewDialog
              review={monthReview}
              goals={buckets}
              onCategorize={handleReviewCategorize}
              onFinish={() => void handleFinishMonthReview()}
              onCancel={() => setMonthReview(null)}
            />
          )}
          {transferReviewOpen && (
            <TransferReviewDialog
              pairs={transferCandidatePairs}
              onLink={handleLinkTransfers}
              onDismiss={handleDismissTransferCandidates}
              onDismissAll={handleDismissAllTransferCandidates}
              onCancel={() => setTransferReviewOpen(false)}
            />
          )}
          {notesDialogFor && (
            <TransactionNotesDialog
              transaction={notesDialogFor}
              onSave={(notes) => handleSaveNotes(notesDialogFor.id, notes)}
              onClose={() => setNotesDialogFor(null)}
            />
          )}
          {autoLinkReviewOpen && (
            <AutoLinkedReviewDialog
              pairs={autoLinkedPairs}
              onUnlink={(outId) => void handleUnlinkTransfer(outId)}
              onLooksRight={(outIds) => void handleMarkAutoLinksReviewed(outIds)}
              onClose={() => setAutoLinkReviewOpen(false)}
            />
          )}

          {manageFamilyMembersOpen && (
            <ManageFamilyMembersDialog
              members={familyMembers}
              onCancel={() => setManageFamilyMembersOpen(false)}
              onCreate={handleCreateFamilyMember}
              onRename={handleRenameFamilyMember}
              onDelete={handleDeleteFamilyMember}
            />
          )}
          {choosingExistingSource && (
            <ChooseExistingDataSourceDialog
              onCancel={() => setChoosingExistingSource(false)}
              onDatabase={() => void handlePickExistingDatabase()}
              onPackage={() => void handlePickProtectedPackage()}
            />
          )}
          {pendingExistingDbPath && (
            <UseExistingDataFileDialog
              path={pendingExistingDbPath}
              isProtectedPackage={pendingExistingIsProtected}
              requiresPassword={pendingExistingRequiresPassword}
              onCancel={() => {
                setPendingExistingDbPath(null);
                setPendingExistingIsProtected(false);
                setPendingExistingRequiresPassword(false);
              }}
              onSubmit={handleAddExistingProfile}
            />
          )}
          {pendingProtectedSwitch && (
            <SwitchToProtectedProfileDialog
              profileName={pendingProtectedSwitch.name}
              onCancel={() => setPendingProtectedSwitch(null)}
              onSubmit={async (password) => {
                // unlock_profile only ever resolves once it has already hot-swapped the live backend
                // connection to the new profile — onDataFileChanged (not the profile-lock-state-changed
                // broadcast, which StartupGate alone listens to) is what actually remounts this App
                // instance so it refetches everything for the newly-active profile: StartupGate stays on
                // its own "open" status across this whole switch, so its event subscription never fires
                // a re-render that would change what it renders.
                await unlockProfile(pendingProtectedSwitch.id, password);
                const name = pendingProtectedSwitch.name;
                setPendingProtectedSwitch(null);
                onDataFileChanged(`Switched to "${name}".`);
              }}
            />
          )}
          {newTransactionOpen && (
            <NewTransactionDialog
              accounts={accounts}
              categories={categoryOptions}
              familyMembers={familyMembers}
              defaultAccountId={selectedAccountId}
              budgetActuals={report?.budget_actuals ?? []}
              onCancel={() => setNewTransactionOpen(false)}
              onSubmit={handleCreateManualTransaction}
            />
          )}
        </div>
      </div>
    </div>
  );
}

/** Forces a full re-fetch of every piece of app state after the data file
 * underneath it changes (relocate/restore) — remounting under a fresh `key`
 * re-runs every one of `App`'s mount-time effects from scratch, the same as
 * a real app restart would, without ever closing or reopening the native
 * window. A real restart (via `tauri-plugin-process`'s `relaunch()`) was
 * tried first and dropped: on Windows it occasionally raced the outgoing
 * WebView2 instance's teardown against the new one's startup, leaving the
 * relaunched window stuck on a native "can't reach this page" error. */
function VaultSpendApp() {
  const [reloadKey, setReloadKey] = useState(0);
  const [initialStatus, setInitialStatus] = useState("");

  return (
    <><MobilePairingPrompt /><App
      key={reloadKey}
      initialStatus={initialStatus}
      onDataFileChanged={(message) => {
        setInitialStatus(message);
        setReloadKey((k) => k + 1);
      }}
    /></>
  );
}

export default VaultSpendApp;
