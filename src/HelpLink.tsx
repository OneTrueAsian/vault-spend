import { NAV_ITEMS, PINNED_NAV_ITEMS, type Tab } from "./appTypes";

const TAB_NAMES = new Map([...NAV_ITEMS, ...PINNED_NAV_ITEMS].map((item) => [item.id, item.label]));

/** The ? beside a page's title: opens Help at that page's own section. */
export function HelpLink({ tab, onOpen }: { tab: Tab; onOpen: (tab: Tab) => void }) {
  const name = TAB_NAMES.get(tab) ?? tab;
  return (
    <button type="button" className="help-link" aria-label={`Help for ${name}`} title={`Help for ${name}`} onClick={() => onOpen(tab)}>
      ?
    </button>
  );
}
