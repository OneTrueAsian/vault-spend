import { User } from "lucide-react";
import { flatIconEntry, IconEntryGlyph, type IconEntry } from "./iconEntry";
import type { FlatIconId } from "./flatIcons";

/** The 15-avatar set (`account-avatar-profile-1` .. `-15`) a user can pick
 * as a picture for one of their database profiles (see `ProfileSwitcher.tsx`/
 * `SettingsView.tsx`'s Profiles section) — purely cosmetic, just a distinct
 * face to tell profiles apart at a glance. Despite the asset filename
 * ("account-avatar-profile-…"), these belong to *profiles*, not accounts —
 * `accountIcons.tsx` has its own, unrelated icon set. */
const AVATAR_KEYS = [
  "account-avatar-profile-1",
  "account-avatar-profile-2",
  "account-avatar-profile-3",
  "account-avatar-profile-4",
  "account-avatar-profile-5",
  "account-avatar-profile-6",
  "account-avatar-profile-7",
  "account-avatar-profile-8",
  "account-avatar-profile-9",
  "account-avatar-profile-10",
  "account-avatar-profile-11",
  "account-avatar-profile-12",
  "account-avatar-profile-13",
  "account-avatar-profile-14",
  "account-avatar-profile-15",
] as const satisfies readonly FlatIconId[];

export type ProfileIconKey = (typeof AVATAR_KEYS)[number];

const FALLBACK_ICON: IconEntry = { kind: "lucide", Icon: User };

/** Every icon the picker offers — no "keep guessing" default the way
 * accounts/categories/buckets have, since a profile has no type or name to
 * guess an icon from; `iconForProfile` falls back to a plain generic
 * person icon instead. */
export const PROFILE_ICON_OPTIONS: { key: ProfileIconKey; entry: IconEntry }[] = AVATAR_KEYS.map((key) => ({
  key,
  entry: flatIconEntry(key),
}));

const PROFILE_ICON_BY_KEY: Record<ProfileIconKey, IconEntry> = Object.fromEntries(
  PROFILE_ICON_OPTIONS.map((o) => [o.key, o.entry]),
) as Record<ProfileIconKey, IconEntry>;

export function isProfileIconKey(key: string): key is ProfileIconKey {
  return key in PROFILE_ICON_BY_KEY;
}

/** `iconKey` (a profile's stored `icon_key`, if the user picked one) wins
 * when recognized; `null`/`undefined`/an unrecognized value all fall back
 * to a plain generic person icon, same "never error on a stale value"
 * convention as `iconForAccount`/`iconForCategory`/`iconForBucket`. */
export function iconForProfile(iconKey?: string | null): IconEntry {
  if (iconKey && isProfileIconKey(iconKey)) return PROFILE_ICON_BY_KEY[iconKey];
  return FALLBACK_ICON;
}

export function ProfileIcon({ iconKey, className }: { iconKey?: string | null; className?: string }) {
  return <IconEntryGlyph entry={iconForProfile(iconKey)} className={className} />;
}
