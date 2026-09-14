import {
  Baby,
  Dumbbell,
  GraduationCap,
  Heart,
  HeartHandshake,
  Receipt,
  Shield,
  Tag,
  TrendingUp,
  UtensilsCrossed,
} from "lucide-react";
import { nounIconEntry, flatIconEntry, IconEntryGlyph, type IconEntry } from "./iconEntry";

/** Keyword → icon, checked in order (first match wins) against a
 * transaction/budget category name. Deliberately keyword-matched rather
 * than an exact-name lookup table: user-created categories are free text
 * (see CategoryPicker/`set_category`), so there's no fixed enum to key
 * off — this covers the app's own built-in categorization rules (see
 * core/src/rules.rs's default RuleSet) plus common variants, and falls
 * back to a generic tag icon for anything else rather than guessing.
 *
 * A mix of bundled full-color icons (`flatIcons.ts`, the set specifically
 * hand-picked for its color), bundled monochrome Noun Project images
 * (`nounIcons.ts`), and Lucide vector icons for categories with no bundled
 * image at all — more specific rules are ordered before the broader ones
 * they were carved out of (e.g. "mortgage" before general housing,
 * "car insurance" before general insurance) so first-match-wins still
 * resolves correctly. */
const CATEGORY_ICON_RULES: [RegExp, IconEntry][] = [
  [/pet/i, flatIconEntry("dog-category")],
  [/business/i, flatIconEntry("business-category")],
  [/mortgage/i, flatIconEntry("mortgage-category")],
  [/(housing|household)/i, flatIconEntry("house-category")],
  [/rent/i, flatIconEntry("real-estate-rent-category")],
  [/grocer/i, flatIconEntry("groceries-category")],
  [/(fuel|gas station)/i, flatIconEntry("gas-category")],
  [/restaurant/i, flatIconEntry("restaurants-category")],
  [/(dining|coffee|cafe|takeout)/i, { kind: "lucide", Icon: UtensilsCrossed }],
  [/(transport|auto\b|parking)/i, nounIconEntry("transport")],
  [/electric/i, nounIconEntry("electric")],
  [/water/i, nounIconEntry("water")],
  [/(internet|wifi)/i, nounIconEntry("internet")],
  [/phone/i, nounIconEntry("phone")],
  [/utilit/i, flatIconEntry("utilty-category")],
  [/streaming/i, nounIconEntry("streaming")],
  [/music/i, nounIconEntry("music")],
  [/(entertainment|movie|cinema)/i, flatIconEntry("entertainment-category")],
  [/shopping/i, flatIconEntry("shopping-category")],
  [/(health|medical|doctor|pharmacy|dental)/i, flatIconEntry("health-category")],
  [/(car insurance|auto insurance)/i, nounIconEntry("car-insurance")],
  [/insurance/i, { kind: "lucide", Icon: Shield }],
  [/travel/i, flatIconEntry("travel-category")],
  [/(education|tuition|school)/i, { kind: "lucide", Icon: GraduationCap }],
  [/subscription/i, flatIconEntry("subscription-category")],
  [/(personal care|beauty|salon)/i, flatIconEntry("beauty-category")],
  [/gift/i, flatIconEntry("gifts-category")],
  [/(salary|paycheck)/i, nounIconEntry("salary")],
  [/(income|payroll|interest)/i, flatIconEntry("income-category")],
  [/fee/i, { kind: "lucide", Icon: Receipt }],
  [/transfer/i, flatIconEntry("transfer-category")],
  [/(loan|debt)/i, nounIconEntry("credit-card")],
  [/(invest|brokerage|retirement)/i, { kind: "lucide", Icon: TrendingUp }],
  [/(child|kid|daycare)/i, { kind: "lucide", Icon: Baby }],
  [/(gym|fitness)/i, { kind: "lucide", Icon: Dumbbell }],
  [/(charity|donation)/i, { kind: "lucide", Icon: HeartHandshake }],
  [/love|romance/i, { kind: "lucide", Icon: Heart }],
];

/** The generic "no match" fallback, and the picker's explicit "keep
 * guessing from the name" swatch — same role `BUCKET_ICON_OPTIONS`'
 * "flag" entry plays. Plain Lucide tag rather than a bundled image: none
 * of the icons this app bundles is a generic catch-all. */
const FALLBACK_ICON: IconEntry = { kind: "lucide", Icon: Tag };

export type CategoryIconKey =
  | "categories"
  | "pet"
  | "business"
  | "mortgage"
  | "housing"
  | "rent"
  | "groceries"
  | "fuel"
  | "restaurant"
  | "utilities"
  | "entertainment"
  | "shopping"
  | "health"
  | "travel"
  | "subscription"
  | "beauty"
  | "gift"
  | "income"
  | "transfer";

/** Every icon the picker offers, in display order — "categories" (the
 * generic tag) first as the explicit "keep guessing from the name" choice,
 * then every specific category already backed by a bundled full-color
 * image. The older monochrome Noun Project images (transport, electric,
 * water, internet, phone, streaming, music, car insurance, salary, credit
 * card) are deliberately not offered here — the user asked for those
 * dropped as manual picks now that most categories have a full-color
 * option instead, leaving these as visual outliers — but they're kept as
 * the automatic keyword-guess fallback in `CATEGORY_ICON_RULES` above, and
 * the bundled assets/attribution in `nounIcons.ts` are untouched, so a
 * category already carrying one of these as an explicit `icon_key` simply
 * falls back to that same keyword guess (see `iconForCategory`) rather
 * than losing its icon. Categories that only ever get a Lucide icon
 * (dining, education, fitness, etc.) aren't offered here either — there's
 * no bundled image for them — so those still rely entirely on the keyword
 * guess. */
export const CATEGORY_ICON_OPTIONS: { key: CategoryIconKey; entry: IconEntry }[] = [
  { key: "categories", entry: FALLBACK_ICON },
  { key: "pet", entry: flatIconEntry("dog-category") },
  { key: "business", entry: flatIconEntry("business-category") },
  { key: "mortgage", entry: flatIconEntry("mortgage-category") },
  { key: "housing", entry: flatIconEntry("house-category") },
  { key: "rent", entry: flatIconEntry("real-estate-rent-category") },
  { key: "groceries", entry: flatIconEntry("groceries-category") },
  { key: "fuel", entry: flatIconEntry("gas-category") },
  { key: "restaurant", entry: flatIconEntry("restaurants-category") },
  { key: "utilities", entry: flatIconEntry("utilty-category") },
  { key: "entertainment", entry: flatIconEntry("entertainment-category") },
  { key: "shopping", entry: flatIconEntry("shopping-category") },
  { key: "health", entry: flatIconEntry("health-category") },
  { key: "travel", entry: flatIconEntry("travel-category") },
  { key: "subscription", entry: flatIconEntry("subscription-category") },
  { key: "beauty", entry: flatIconEntry("beauty-category") },
  { key: "gift", entry: flatIconEntry("gifts-category") },
  { key: "income", entry: flatIconEntry("income-category") },
  { key: "transfer", entry: flatIconEntry("transfer-category") },
];

const CATEGORY_ICON_BY_KEY: Record<CategoryIconKey, IconEntry> = Object.fromEntries(
  CATEGORY_ICON_OPTIONS.map((o) => [o.key, o.entry]),
) as Record<CategoryIconKey, IconEntry>;

export function isCategoryIconKey(key: string): key is CategoryIconKey {
  return key in CATEGORY_ICON_BY_KEY;
}

/** `iconKey` (a category's stored `icon_key`, if the user picked one
 * explicitly) always wins over the keyword-guessed default below — `null`/
 * `undefined`/an unrecognized value all fall back to the guess, so a
 * category created before this picker existed keeps looking exactly as it
 * did. Same convention as `iconForBucket`/`iconForAccount`. */
export function iconForCategory(category: string | null | undefined, iconKey?: string | null): IconEntry {
  if (iconKey && isCategoryIconKey(iconKey)) return CATEGORY_ICON_BY_KEY[iconKey];
  if (!category) return FALLBACK_ICON;
  for (const [pattern, entry] of CATEGORY_ICON_RULES) {
    if (pattern.test(category)) return entry;
  }
  return FALLBACK_ICON;
}

export function CategoryIcon({
  category,
  iconKey,
  className,
}: {
  category: string | null | undefined;
  iconKey?: string | null;
  className?: string;
}) {
  return <IconEntryGlyph entry={iconForCategory(category, iconKey)} className={className} />;
}
