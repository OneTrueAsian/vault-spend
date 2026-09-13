/** Every icon this app uses, pulled from one place. Four kinds live here,
 * each with its own file since their shapes genuinely differ:
 *
 * - `nounIcons.ts` / `credits.ts` — bundled Noun Project raster images
 *   (asset + CC BY 3.0 credit together), monochrome by license. Used by
 *   the lookup tables below, plus the derived Settings ▸ Icon credits list.
 * - `flatIcons.ts` — bundled full-color icons the user hand-picked
 *   specifically for their color (a different source/license than the
 *   Noun Project set, so deliberately not part of Icon credits).
 * - `navIcons.tsx` — hand-drawn SVG paths for the sidebar, with separate
 *   default/futuristic variants (no images, no credits needed).
 * - `accountIcons.tsx` / `categoryIcons.tsx` / `bucketIcons.tsx` /
 *   `budgetGroupIcons.tsx` / `profileIcons.tsx` — the domain-specific
 *   "which icon for this account/category/bucket/budget-group/profile"
 *   lookups, each resolving to a Noun Project image, a full-color image,
 *   or a Lucide vector icon (`iconEntry.tsx`).
 *
 * Import from `"./icons"` (this file) rather than reaching into one of the
 * files above directly. */
export { NavIcon } from "./navIcons";
export {
  AccountTypeIcon,
  iconForAccount,
  isAccountIconKey,
  ACCOUNT_ICON_OPTIONS,
  type AccountIconKey,
} from "./accountIcons";
export {
  CategoryIcon,
  iconForCategory,
  isCategoryIconKey,
  CATEGORY_ICON_OPTIONS,
  type CategoryIconKey,
} from "./categoryIcons";
export { BucketIcon, iconForBucket, isBucketIconKey, BUCKET_ICON_OPTIONS, type BucketIconKey } from "./bucketIcons";
export {
  ProfileIcon,
  iconForProfile,
  isProfileIconKey,
  PROFILE_ICON_OPTIONS,
  type ProfileIconKey,
} from "./profileIcons";
export { BudgetGroupIcon, iconForBudgetGroup } from "./budgetGroupIcons";
export { ICON_CREDITS, type IconCredit } from "./credits";
export { NOUN_ICONS, type NounIconId, type NounIcon } from "./nounIcons";
export { FLAT_ICONS, type FlatIconId, type FlatIcon } from "./flatIcons";
export { IconEntryGlyph, IconPicker, nounIconEntry, flatIconEntry, type IconEntry } from "./iconEntry";
