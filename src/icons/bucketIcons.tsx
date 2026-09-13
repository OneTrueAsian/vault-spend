import { Flag } from "lucide-react";
import { nounIconEntry, flatIconEntry, IconEntryGlyph, type IconEntry } from "./iconEntry";

/** Keyword → icon, checked in order (first match wins) against a bucket's
 * name — same keyword-matched convention `categoryIcons.tsx` uses for
 * transaction categories, since a bucket's "kind" is likewise free text
 * (whatever the user typed when creating it, see BucketsView's
 * `NewBucketForm`), not a fixed enum. Only used when the bucket has no
 * explicit `icon_key` (see `BUCKET_ICON_OPTIONS` below) — the picker lets a
 * user override this guess, but leaves it as the default for anyone who
 * doesn't bother. */
const BUCKET_ICON_RULES: [RegExp, IconEntry][] = [
  [/mortgage/i, flatIconEntry("mortgage-category")],
  [/(travel|vacation|trip|holiday)/i, flatIconEntry("travel-category")],
  [/(housing|household)/i, flatIconEntry("house-category")],
  [/(home|house|renovation)/i, nounIconEntry("home-goal")],
  [/(health|medical|dental)/i, flatIconEntry("health-category")],
  [/gift/i, flatIconEntry("gifts-category")],
  [/(laptop|computer|pc\b)/i, flatIconEntry("computer-goal")],
  [/(beauty|makeup|spa|salon)/i, flatIconEntry("beauty-goal")],
  [/(car|vehicle|auto\b)/i, flatIconEntry("car-goal")],
];

const FALLBACK_ICON: IconEntry = { kind: "lucide", Icon: Flag };

export type BucketIconKey = "flag" | "travel" | "housing" | "mortgage" | "health" | "gift" | "laptop" | "beauty" | "car";

/** Every icon the picker offers, in display order — "flag" first as the
 * explicit "use the generic default" choice, matching the mockup's picker
 * (Flag swatch plus every full-color image already bundled — the same
 * bundled category images `categoryIcons.tsx` uses, reused here rather
 * than adding new image assets for goals specifically). The older
 * monochrome Noun Project "home" image is deliberately not offered here —
 * the user asked for that dropped as a manual pick — but it's kept as the
 * automatic keyword-guess fallback in `BUCKET_ICON_RULES` above, and the
 * bundled asset/attribution in `nounIcons.ts` is untouched, so a goal
 * already carrying it as an explicit `icon_key` simply falls back to that
 * same keyword guess (see `iconForBucket`) rather than losing its icon.
 * "laptop" and "beauty" use dedicated full-color goal images rather than
 * the category ones. */
export const BUCKET_ICON_OPTIONS: { key: BucketIconKey; entry: IconEntry }[] = [
  { key: "flag", entry: FALLBACK_ICON },
  { key: "travel", entry: flatIconEntry("travel-category") },
  { key: "housing", entry: flatIconEntry("house-category") },
  { key: "mortgage", entry: flatIconEntry("mortgage-category") },
  { key: "health", entry: flatIconEntry("health-category") },
  { key: "gift", entry: flatIconEntry("gifts-category") },
  { key: "laptop", entry: flatIconEntry("computer-goal") },
  { key: "beauty", entry: flatIconEntry("beauty-goal") },
  { key: "car", entry: flatIconEntry("car-goal") },
];

const BUCKET_ICON_BY_KEY: Record<BucketIconKey, IconEntry> = Object.fromEntries(
  BUCKET_ICON_OPTIONS.map((o) => [o.key, o.entry]),
) as Record<BucketIconKey, IconEntry>;

export function isBucketIconKey(key: string): key is BucketIconKey {
  return key in BUCKET_ICON_BY_KEY;
}

/** `iconKey` (a bucket's stored `icon_key`, if the user picked one
 * explicitly) always wins over the name-guessed default below — `null`/
 * `undefined`/an unrecognized value all fall back to the guess, so a
 * bucket created before this picker existed keeps looking exactly as it
 * did. */
export function iconForBucket(name: string, iconKey?: string | null): IconEntry {
  if (iconKey && isBucketIconKey(iconKey)) return BUCKET_ICON_BY_KEY[iconKey];
  for (const [pattern, entry] of BUCKET_ICON_RULES) {
    if (pattern.test(name)) return entry;
  }
  return FALLBACK_ICON;
}

export function BucketIcon({
  name,
  iconKey,
  className,
}: {
  name: string;
  iconKey?: string | null;
  className?: string;
}) {
  return <IconEntryGlyph entry={iconForBucket(name, iconKey)} className={className} />;
}
