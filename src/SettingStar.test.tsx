// @vitest-environment jsdom
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { act } from "react";
import { createRoot, type Root } from "react-dom/client";

const getProfileUiState = vi.hoisted(() => vi.fn());
const setProfileUiState = vi.hoisted(() => vi.fn());
vi.mock("./profileUiState", () => ({ getProfileUiState, setProfileUiState, getCurrentGeneration: vi.fn().mockResolvedValue(1) }));
vi.mock("./ProtectionSetupDialog", () => ({ ProtectionSetupDialog: () => null }));
vi.mock("./RulesManager", () => ({ RulesManager: () => null }));
vi.mock("./StatementLayoutsSection", () => ({ StatementLayoutsSection: () => null }));
vi.mock("./MobileSettings", () => ({ MobileSettings: () => null }));
vi.mock("./ProfileProtectionSection", () => ({ ProfileProtectionSection: () => null }));
vi.mock("./ProtectionLeftovers", () => ({ ProtectionLeftovers: () => null }));

import { QuickSettingsContext, SettingStar, cardAttr, settingAttr } from "./SettingStar";
import { AppearanceSection, SettingsView } from "./SettingsView";
import { SETTING_ENTRIES } from "./settingsIndex";
import { DEFAULT_APPEARANCE_PREFS } from "./themeBootstrap";

(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

const norm = (s: string | null | undefined) => (s ?? "").replace(/\s+/g, " ").trim();

describe("SettingStar", () => {
  let container: HTMLDivElement;
  let root: Root;
  const toggle = vi.fn();

  beforeEach(() => {
    toggle.mockReset();
    container = document.createElement("div");
    document.body.append(container);
    root = createRoot(container);
  });
  afterEach(() => {
    act(() => root.unmount());
    container.remove();
  });

  it("renders nothing outside the Settings page", () => {
    act(() => root.render(<SettingStar id="backups" />));
    expect(container.querySelector("button")).toBeNull();
  });

  it("names the setting and the direction, and follows what is already added", () => {
    act(() =>
      root.render(
        <QuickSettingsContext.Provider value={{ has: (id) => id === "backups", toggle }}>
          <SettingStar id="backups" />
          <SettingStar id="theme" />
        </QuickSettingsContext.Provider>,
      ),
    );
    const [added, notAdded] = [...container.querySelectorAll("button")];
    expect(added.getAttribute("aria-label")).toBe("Remove Automatic backups from Quick settings");
    expect(added.getAttribute("aria-pressed")).toBe("true");
    expect(notAdded.getAttribute("aria-label")).toBe("Add Light or dark to Quick settings");
    expect(notAdded.getAttribute("aria-pressed")).toBe("false");
  });

  it("toggles by id when clicked", () => {
    act(() =>
      root.render(
        <QuickSettingsContext.Provider value={{ has: () => false, toggle }}>
          <SettingStar id="backups" />
        </QuickSettingsContext.Provider>,
      ),
    );
    act(() => container.querySelector("button")!.click());
    expect(toggle).toHaveBeenCalledWith("backups");
  });

  it("anchors carry the id and can take focus for a jump", () => {
    expect(settingAttr("backups")).toEqual({ "data-setting": "backups", tabIndex: -1 });
    expect(cardAttr("about")).toEqual({ "data-setting-card": "about", tabIndex: -1 });
  });
});


describe("Settings sections carry anchors, h2 titles and stars", () => {
  let container: HTMLDivElement;
  let root: Root;
  const toggle = vi.fn();

  const noop = vi.fn();
  async function renderView() {
    await act(async () =>
      root.render(
          <SettingsView
            onDownloadSetupTemplate={noop}
            onImportSetupData={noop}
            backgroundSettings={{ tray_enabled: false, autostart_enabled: false, autostart_supported: true }}
            onSetTray={noop}
            onSetAutostart={noop}
            onSendTestReminder={noop}
            showBillNamesInReminders={false}
            onSetShowBillNamesInReminders={noop}
            privacyAutoHide={false}
            onSetPrivacyAutoHide={noop}
            categories={[]}
            onRulesApplied={noop}
            onMessage={noop}
            appVersion="1.3.1"
            dataFileLocation="C:\\data.db"
            onRelocateDataFile={noop}
            onExportDatabase={noop}
            backups={[]}
            onCreateBackupNow={noop}
            onRestoreBackup={noop}
            backupCopyDir={null}
            onSetBackupCopyDir={noop}
            onBrowseBackupCopyDir={noop}
            profiles={[]}
            onCreateProfile={noop}
            onUseExistingDataFile={noop}
            onSwitchProfile={noop}
            onRenameProfile={noop}
            onSetProfileIcon={noop}
            onDeleteProfile={noop}
            onProtected={noop}
            livePriceSettings={null}
            onSetLivePriceApiKey={noop}
            onRefreshLivePrices={noop}
            appSettings={{ apply_to_debt_enabled: true, split_purchases_enabled: true, envelope_caps_enabled: false, rollover_enabled: false, auto_link_transfers: false, safe_to_spend_enabled: true }}
            onSetApplyToDebtEnabled={noop}
            onSetSplitPurchasesEnabled={noop}
            onSetEnvelopeCapsEnabled={noop}
            onSetRolloverEnabled={noop}
            onSetAutoLinkTransfers={noop}
            onSetSafeToSpendEnabled={noop}
            themeStyle="transparent"
            onSetThemeStyle={noop}
            appearance={DEFAULT_APPEARANCE_PREFS}
            onSetAppearance={noop}
            theme="system"
            onSetTheme={noop}
            resolvedTheme="light"
          />,
      ),
    );
  }

  beforeEach(async () => {
    toggle.mockReset();
    getProfileUiState.mockReset().mockResolvedValue("[]");
    setProfileUiState.mockReset().mockResolvedValue(undefined);
    container = document.createElement("div");
    document.body.append(container);
    root = createRoot(container);
    await renderView();
  });
  afterEach(() => {
    act(() => root.unmount());
    container.remove();
  });

  // The cards SettingsView owns itself; the five separate section components are covered where they live.
  const OWN_IDS = [
    "theme", "style", "reduce-motion", "hide-when-away", "profiles", "data-file", "backups", "setup-data",
    "apply-to-debt", "split-purchases", "envelope-caps", "rollover-unspent", "link-transfers", "safe-to-spend",
    "keep-running-in-tray", "start-when-i-sign-in", "show-bill-names", "test-reminder", "live-prices",
    "release-notes", "icon-credits", "about",
  ];
  const anchor = (id: string) => container.querySelectorAll<HTMLElement>(`[data-setting="${id}"], [data-setting-card="${id}"]`);

  it.each(OWN_IDS)("has exactly one anchor for %s, focusable, starting with its label", (id) => {
    const found = anchor(id);
    expect(found.length).toBe(1);
    expect(found[0].tabIndex).toBe(-1);
    expect(norm(found[0].textContent).startsWith(SETTING_ENTRIES.find((e) => e.id === id)!.label)).toBe(true);
  });

  it.each(OWN_IDS)("gives %s one star named for it, and clicking it adds it to Quick settings", async (id) => {
    const label = SETTING_ENTRIES.find((e) => e.id === id)!.label;
    const stars = [...anchor(id)[0].querySelectorAll<HTMLButtonElement>("button[aria-pressed]")].filter((b) => b.getAttribute("aria-label") === `Add ${label} to Quick settings`);
    expect(stars.length).toBe(1);
    await act(async () => stars[0].click());
    expect(setProfileUiState).toHaveBeenCalledWith("quick_settings", `["${id}"]`, 1);
  });

  // Anchors of the five separate section components are asserted where those components live (their own test files);
  // the one conditional card (Protection leftovers) is only on screen for a protected profile.
  const SEPARATE_IDS = ["password-protection", "automatic-locking", "mobile-snapshots", "categorization-rules", "statement-layouts"];

  it("keeps the page and the settings index in step, both ways", () => {
    const onPage = [...container.querySelectorAll<HTMLElement>("[data-setting], [data-setting-card]")].map((el) => el.dataset.setting ?? el.dataset.settingCard!);
    expect(new Set(onPage).size).toBe(onPage.length);
    const expected = SETTING_ENTRIES.filter((e) => !e.conditional && !SEPARATE_IDS.includes(e.id)).map((e) => e.id);
    expect([...onPage].sort()).toEqual([...expected].sort());
  });

  it("opens on Quick settings with the new subtitle, and every group's cards are on the page", () => {
    expect(container.querySelector(".view-sub")?.textContent).toBe("How the app looks, who uses it, and where your data lives.");
    expect(container.querySelector<HTMLElement>('[data-settings-panel="quick"]')!.hidden).toBe(false);
    expect(container.querySelectorAll("[data-settings-panel]").length).toBe(6);
  });

  it("makes every card title an h2 with the shared title class", () => {
    const titles = [...container.querySelectorAll(".card .reports-section-title")];
    expect(titles.length).toBeGreaterThan(5);
    expect(titles.every((t) => t.tagName === "H2")).toBe(true);
  });

  it("does not let a star rename the toggle it sits beside", () => {
    const toggleRow = container.querySelector<HTMLElement>('[data-feature-toggle="apply_to_debt_enabled"]')!;
    expect(toggleRow.querySelector("button")).toBeNull();
    expect(toggleRow.closest("[data-setting]")?.getAttribute("data-setting")).toBe("apply-to-debt");
  });

  it("gives the style picker one star and the Futuristic options none", () => {
    expect(anchor("style")[0].querySelectorAll("button[aria-pressed]").length).toBe(1);
    act(() =>
      root.render(
        <QuickSettingsContext.Provider value={{ has: () => false, toggle }}>
          <AppearanceSection themeStyle="futuristic" onSetThemeStyle={noop} appearance={DEFAULT_APPEARANCE_PREFS} onSetAppearance={noop} theme="system" onSetTheme={noop} resolvedTheme="light" />
        </QuickSettingsContext.Provider>,
      ),
    );
    const options = container.querySelector<HTMLElement>("[data-futuristic-options]")!;
    expect(options.querySelector("button[aria-pressed]")).toBeNull();
    expect(options.closest("[data-setting]")).toBeNull();
  });

});
