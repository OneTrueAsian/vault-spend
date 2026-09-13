import { flatIconEntry, IconEntryGlyph, type IconEntry } from "./iconEntry";

/** Keyed by the raw `account_type` string (`ACCOUNT_TYPE_OPTIONS` in
 * Modal.tsx: checking/savings/credit/loan/investment/other) rather than
 * `groupOf()`'s coarser cash/credit/loan/investment/other grouping, so
 * checking and savings — both "cash" to `groupOf` — still get visually
 * distinct icons. Checking/savings/credit/investment each have a direct,
 * user-picked full-color icon (see `flatIcons.ts`); loan and other don't
 * (no "-acct" file was provided for either), so they borrow the closest
 * neutral icon from the same set — debt-dash's bar chart for loan (a loan
 * *is* debt) and net-worth-dash's balance scale for other (a generic
 * "your finances" glyph) — rather than mixing in an unrelated monochrome
 * icon. Only used when the account has no explicit `icon_key` (see
 * `ACCOUNT_ICON_OPTIONS` below) — the picker lets a user override this
 * guess, but leaves it as the default for anyone who doesn't bother. */
const ACCOUNT_TYPE_ICONS: Record<string, IconEntry> = {
  checking: flatIconEntry("money-checkings-acct"),
  savings: flatIconEntry("savings-money-acct"),
  credit: flatIconEntry("credit-card-acct"),
  loan: flatIconEntry("debt-dash"),
  investment: flatIconEntry("investment-acct"),
  other: flatIconEntry("net-worth-dash"),
};

const FALLBACK_ICON: IconEntry = ACCOUNT_TYPE_ICONS.other;

export type AccountIconKey = "checking" | "savings" | "credit" | "loan" | "investment" | "other" | "car" | "mortgage";

/** Every icon the picker offers, in display order — one swatch per
 * `account_type`, all pointing at the same full-color icons the automatic
 * guess above uses, plus "car" and "mortgage" as extra explicit picks for a
 * loan account more specific than the generic debt-dash bar chart
 * (reusing the same bundled images `categoryIcons.tsx`/`bucketIcons.tsx`
 * use, not new assets). The automatic type-based guess still only ever
 * lands on the 6 base icons above — nothing about an account's type or
 * name distinguishes "auto loan" from "mortgage" — so these two only ever
 * apply when a user picks one explicitly. */
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
