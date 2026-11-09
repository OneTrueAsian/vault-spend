import { House, TrendingUp } from "lucide-react";
import { flatIconEntry, IconEntryGlyph, type IconEntry } from "./iconEntry";

/** Type-based defaults; a saved explicit picker choice still takes precedence.
 * House and rising-line glyphs identify loans and investments directly. */
const ACCOUNT_TYPE_ICONS: Record<string, IconEntry> = {
  checking: flatIconEntry("money-checkings-acct"),
  savings: flatIconEntry("savings-money-acct"),
  credit: flatIconEntry("credit-card-acct"),
  loan: { kind: "lucide", Icon: House },
  investment: { kind: "lucide", Icon: TrendingUp },
  other: flatIconEntry("net-worth-dash"),
};

const FALLBACK_ICON: IconEntry = ACCOUNT_TYPE_ICONS.other;

export type AccountIconKey = "checking" | "savings" | "credit" | "loan" | "investment" | "other" | "car" | "mortgage";

/** Choices reuse the bundled images and theme-colored line glyphs. Keys stay
 * stable, so existing saved choices continue to override the type default. */
export const ACCOUNT_ICON_OPTIONS: { key: AccountIconKey; entry: IconEntry }[] = [
  { key: "checking", entry: ACCOUNT_TYPE_ICONS.checking },
  { key: "savings", entry: ACCOUNT_TYPE_ICONS.savings },
  { key: "credit", entry: ACCOUNT_TYPE_ICONS.credit },
  { key: "loan", entry: ACCOUNT_TYPE_ICONS.loan },
  { key: "investment", entry: ACCOUNT_TYPE_ICONS.investment },
  { key: "other", entry: ACCOUNT_TYPE_ICONS.other },
  { key: "car", entry: flatIconEntry("car-goal") },
  { key: "mortgage", entry: flatIconEntry("mortgage-category") },
];

const ACCOUNT_ICON_BY_KEY: Record<AccountIconKey, IconEntry> = Object.fromEntries(
  ACCOUNT_ICON_OPTIONS.map((o) => [o.key, o.entry]),
) as Record<AccountIconKey, IconEntry>;

export function isAccountIconKey(key: string): key is AccountIconKey {
  return key in ACCOUNT_ICON_BY_KEY;
}

/** `iconKey` (an account's stored `icon_key`, if the user picked one
 * explicitly) always wins over the type-guessed default below — `null`/
 * `undefined`/an unrecognized value all fall back to the guess, so an
 * account created before this picker existed keeps looking exactly as it
 * did. Same convention as `iconForBucket`/`iconForCategory`. */
export function iconForAccount(accountType: string, iconKey?: string | null): IconEntry {
  if (iconKey && isAccountIconKey(iconKey)) return ACCOUNT_ICON_BY_KEY[iconKey];
  return ACCOUNT_TYPE_ICONS[accountType] ?? FALLBACK_ICON;
}

export function AccountTypeIcon({
  accountType,
  iconKey,
  className,
}: {
  accountType: string;
  iconKey?: string | null;
  className?: string;
}) {
  return <IconEntryGlyph entry={iconForAccount(accountType, iconKey)} className={className} />;
}
