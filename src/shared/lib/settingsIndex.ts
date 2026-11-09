export type SettingsGroupId = "quick" | "display" | "profiles" | "data" | "features" | "about";
type ListedGroupId = Exclude<SettingsGroupId, "quick">;

/** The groups the Settings list shows under Quick settings, in order. */
export const SETTINGS_GROUPS: { id: ListedGroupId; name: string; subline: string }[] = [
  { id: "display", name: "Display", subline: "Colors, style, and what shows on screen." },
  { id: "profiles", name: "Profiles & security", subline: "Who uses this app and how it is locked." },
  { id: "data", name: "Data", subline: "Where your data is saved and how it is backed up." },
  { id: "features", name: "Features", subline: "Turn tools on or off and teach the app your habits." },
  { id: "about", name: "About", subline: "Version, what is new, and credits." },
];

/** One setting a person can search for, add to Quick settings, or be taken to. `id` is the `data-setting` (or
 * `data-setting-card`) value on the page; `label` is the visible name exactly as the page shows it; `card` is the
 * visible card title. `conditional` marks a card that is only sometimes on screen, so search and the picker skip it. */
export type SettingEntry = {
  id: string;
  group: ListedGroupId;
  card: string;
  label: string;
  description: string;
  keywords: string;
  conditional?: true;
};

/** Every setting on the Settings page, in page order. SettingsView.test.tsx keeps this and the page in step. */
export const SETTING_ENTRIES: SettingEntry[] = [
  { id: "theme", group: "display", card: "Appearance", label: "Light or dark", description: "Use a light screen, a dark screen, or match your computer.", keywords: "dark light night mode system theme colour color" },
  { id: "style", group: "display", card: "Appearance", label: "Style", description: "Choose how Vault Spend looks: Default, Futuristic or Retro.", keywords: "theme look design default futuristic retro neon glow transparent colour color appearance" },
  { id: "reduce-motion", group: "display", card: "Appearance", label: "Reduce motion", description: "Turn off sliding and fading effects.", keywords: "animation accessibility effects movement" },
  { id: "hide-when-away", group: "display", card: "Privacy", label: "Also hide amounts when this window isn't in front", description: "Cover your amounts with dots when you switch to another window.", keywords: "privacy hide amounts mask blur screen numbers away" },
  { id: "profiles", group: "profiles", card: "Profiles", label: "Profiles", description: "Switch, add, rename or remove the people or households using this app.", keywords: "user family person household switch add create rename delete icon picture avatar" },
  { id: "password-protection", group: "profiles", card: "Password protection", label: "Password protection", description: "Ask for a password when this profile is opened, and keep its data file scrambled.", keywords: "password lock locked encrypt secure security recovery key protect" },
  { id: "automatic-locking", group: "profiles", card: "Password protection", label: "Automatic locking", description: "Ask for the password again after the app has been idle for a while.", keywords: "lock timeout idle sleep password security" },
  { id: "protection-leftovers", group: "profiles", card: "Plaintext files left behind", label: "Plaintext files left behind", description: "Find and delete readable copies left over after turning on a password.", keywords: "leftover old copies delete clean up readable password", conditional: true },
  { id: "data-file", group: "data", card: "Data file", label: "Data file", description: "See where your data is saved, copy its location, move it, save a copy, or open another data file.", keywords: "folder location path copy move relocate where export save open existing" },
  { id: "backups", group: "data", card: "Automatic backups", label: "Automatic backups", description: "Back up now. Vault Spend also backs up once a day when you open it.", keywords: "backup save copy daily automatic" },
  { id: "backup-copy", group: "data", card: "Second copy", label: "Second copy", description: "Also save each backup to another folder, like a cloud folder or a USB drive.", keywords: "backup second folder usb cloud onedrive dropbox mirror" },
  { id: "backup-history", group: "data", card: "Backup history", label: "Backup history", description: "See earlier backups and restore one.", keywords: "restore recover undo earlier old backups list" },
  { id: "setup-data", group: "data", card: "Setup data", label: "Setup data", description: "Download a blank spreadsheet to fill in your accounts, then import it.", keywords: "import template spreadsheet csv excel bulk start" },
  { id: "mobile-snapshots", group: "data", card: "Mobile snapshots", label: "Mobile snapshots", description: "View your data on your phone over your home Wi-Fi, and manage approved phones.", keywords: "phone iphone android qr code wifi network pairing viewer mobile" },
  { id: "apply-to-debt", group: "features", card: "Feature toggles", label: "Apply to Debt", description: "Let a payment also lower a loan or credit card balance.", keywords: "loan credit card payment pay down toggle" },
  { id: "split-purchases", group: "features", card: "Feature toggles", label: "Split purchases", description: "Divide one purchase across several categories.", keywords: "split categories receipt divide toggle" },
  { id: "envelope-caps", group: "features", card: "Feature toggles", label: "Envelope Caps", description: "Warn at 90% of a budget category instead of the usual 80%.", keywords: "warn warning budget limit cap envelope toggle" },
  { id: "rollover-unspent", group: "features", card: "Feature toggles", label: "Rollover unspent", description: "Carry what a budget category did not spend into next month.", keywords: "carry over leftover budget month toggle" },
  { id: "link-transfers", group: "features", card: "Feature toggles", label: "Link matching transfers automatically", description: "Pair up money moved between your own accounts as soon as it arrives.", keywords: "transfer match link accounts automatic toggle" },
  { id: "safe-to-spend", group: "features", card: "Feature toggles", label: "Safe to spend", description: "Show the Safe to spend card on the Dashboard.", keywords: "dashboard card widget buffer toggle" },
  { id: "keep-running-in-tray", group: "features", card: "Background reminders", label: "Keep Vault Spend running in the tray", description: "Keep checking for due bills even when the window is closed.", keywords: "tray background close minimize reminders bills notification" },
  { id: "start-when-i-sign-in", group: "features", card: "Background reminders", label: "Start Vault Spend when I sign in", description: "Open quietly in the background when you sign in to your computer.", keywords: "startup boot login autostart sign in reminders" },
  { id: "show-bill-names", group: "features", card: "Background reminders", label: "Show bill names in reminders", description: "Turn off to keep bill names private in reminders.", keywords: "notification privacy bill names reminders" },
  { id: "test-reminder", group: "features", card: "Background reminders", label: "Send a test reminder", description: "See what a reminder looks like.", keywords: "notification test reminders" },
  { id: "live-prices", group: "features", card: "Live stock prices", label: "Live stock prices", description: "Add a free price service key so stock prices fill in and stay current.", keywords: "api key investments stocks quote price provider refresh holdings" },
  { id: "categorization-rules", group: "features", card: "Categorization rules", label: "Categorization rules", description: "Teach the app which category a store or description belongs to.", keywords: "rules categories categorize merchant store import auto sort" },
  { id: "statement-layouts", group: "features", card: "Statements the app knows how to read", label: "Statements the app knows how to read", description: "See, rename or remove the banks whose statements the app has learned.", keywords: "statement bank layout pdf csv import reconcile" },
  { id: "release-notes", group: "about", card: "Release notes", label: "Release notes", description: "Read what changed in each version.", keywords: "changelog whats new version updates" },
  { id: "icon-credits", group: "about", card: "Icon credits", label: "Icon credits", description: "See who made the icons and how they are licensed.", keywords: "attribution license artist noun project credits" },
  { id: "about", group: "about", card: "About Vault Spend", label: "About Vault Spend", description: "What Vault Spend is and who makes it.", keywords: "version legal independent open source" },
];

export const isKnownSettingId = (id: string): boolean => SETTING_ENTRIES.some((e) => e.id === id);

/** Plain substring search (never a pattern), case-insensitive, over name, description, keywords and card title.
 * A name match ranks 0 and anything else 1; within a rank the page order is kept. Conditional cards are skipped. */
export function searchSettings(query: string): { entry: SettingEntry; rank: 0 | 1 }[] {
  const q = query.trim().toLowerCase();
  if (!q) return [];
  const hits: { entry: SettingEntry; rank: 0 | 1 }[] = [];
  for (const entry of SETTING_ENTRIES) {
    if (entry.conditional) continue;
    if (entry.label.toLowerCase().includes(q)) hits.push({ entry, rank: 0 });
    else if ([entry.description, entry.keywords, entry.card].some((text) => text.toLowerCase().includes(q))) hits.push({ entry, rank: 1 });
  }
  return hits.sort((a, b) => a.rank - b.rank);
}
