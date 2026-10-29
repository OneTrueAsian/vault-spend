import { createContext, useContext } from "react";
import { SETTING_ENTRIES } from "./settingsIndex";

/** What the Settings page lends its sections: whether a setting is in Quick settings, and a way to add or remove it.
 * Null outside the page, so a section shown on its own simply has no star. */
export const QuickSettingsContext = createContext<{ has: (id: string) => boolean; toggle: (id: string) => void } | null>(null);

/** Put on the element that holds one setting (a toggle row, a block) so Quick settings and search can take the person
 * to it: the id comes from `settingsIndex.ts`, and -1 lets the jump focus it. */
export const settingAttr = (id: string) => ({ "data-setting": id, tabIndex: -1 });

/** The same for a setting that is a whole card. */
export const cardAttr = (id: string) => ({ "data-setting-card": id, tabIndex: -1 });

/** The ☆ / ★ button that adds a setting to Quick settings or removes it. */
export function SettingStar({ id }: { id: string }) {
  const quick = useContext(QuickSettingsContext);
  if (!quick) return null;
  const entry = SETTING_ENTRIES.find((e) => e.id === id);
  if (!entry) throw new Error(`SettingStar: "${id}" is not in settingsIndex.ts`);
  const on = quick.has(id);
  const name = on ? `Remove ${entry.label} from Quick settings` : `Add ${entry.label} to Quick settings`;
  return (
    <button type="button" className="setting-star" aria-pressed={on} aria-label={name} title={name} onClick={() => quick.toggle(id)}>
      <span aria-hidden="true">{on ? "★" : "☆"}</span>
    </button>
  );
}
