import { NOUN_ICONS } from "./nounIcons";

/** Attribution for every bundled Noun Project icon — shown in Settings ▸
 * Icon credits. Derived directly from `NOUN_ICONS` rather than kept as a
 * separate hand-maintained list, so it's structurally impossible for an
 * icon to be added or removed without its credit following along. */
export type IconCredit = {
  name: string;
  description: string;
  nounProjectId: string;
  author: string;
};

export const ICON_CREDITS: IconCredit[] = Object.entries(NOUN_ICONS)
  .map(([name, { description, nounProjectId, author }]) => ({ name, description, nounProjectId, author }))
  .sort((a, b) => a.name.localeCompare(b.name));
