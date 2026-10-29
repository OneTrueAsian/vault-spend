import { useCallback, useEffect, useMemo, useRef, useState, type ReactNode } from "react";
import { MenuSelect } from "./MenuSelect";
import { QuickSettingsContext } from "./SettingStar";
import { useQuickSettings } from "./quickSettings";
import { readSettingsGroup, writeSettingsGroup } from "./settingsGroupPref";
import { SETTINGS_GROUPS, SETTING_ENTRIES, isKnownSettingId, searchSettings, type SettingEntry, type SettingsGroupId } from "./settingsIndex";

const FLASH_MS = 2200;

/** Category navigation: the sidebar gives way to tabs at this frame width (the container query in SettingsPage.css),
 * and the tabs give way to the category selector when they stop fitting (or in any case at the narrowest width). */
const NAV_TABS_AT_MOST = 760;
const NAV_SELECT_AT_MOST = 560;
/** Spare room the tabs need before they replace the selector again, so a resize does not flip back and forth. */
const NAV_FIT_MARGIN = 16;

/** The last jump request acted on. Settings is mounted afresh each time it is opened, and the app keeps handing it
 * the same request, so without this a later visit would be thrown back to the requested group. */
let lastHandledJump: number | undefined;

const groupName = (id: SettingEntry["group"]) => SETTINGS_GROUPS.find((g) => g.id === id)!.name;
/** The category a setting is in; the card is added only when it has a different name from the setting itself. */
const pathOf = (entry: SettingEntry) => (entry.card === entry.label ? groupName(entry.group) : `${groupName(entry.group)} › ${entry.card}`);

/** The matched text wrapped in <mark>, built from slices so nothing typed is ever read as markup. */
function highlight(text: string, query: string): ReactNode {
  const at = query ? text.toLowerCase().indexOf(query.toLowerCase()) : -1;
  if (at < 0) return text;
  return (
    <>
      {text.slice(0, at)}
      <mark>{text.slice(at, at + query.length)}</mark>
      {text.slice(at + query.length)}
    </>
  );
}

/** The Settings page frame: a list of Quick settings and five groups (one shown at a time), a search box, and the
 * Quick settings tab. Every group's cards stay mounted and are only hidden, so nothing half-done is lost by moving
 * between groups. `jumpRequest` lets another part of the app open a group (a new `nonce` asks again). */
export function SettingsPage({
  title,
  panels,
  jumpRequest,
}: {
  title: ReactNode;
  panels: Record<Exclude<SettingsGroupId, "quick">, ReactNode>;
  jumpRequest?: { group: SettingsGroupId; nonce: number };
}) {
  const [group, setGroup] = useState<SettingsGroupId>(readSettingsGroup);
  const [query, setQuery] = useState("");
  const [pendingJump, setPendingJump] = useState<string | null>(null);
  const [pickerOpen, setPickerOpen] = useState(false);
  const [pickQuery, setPickQuery] = useState("");
  const quick = useQuickSettings(isKnownSettingId);
  const pageRef = useRef<HTMLDivElement>(null);
  const contentRef = useRef<HTMLDivElement>(null);
  const navRef = useRef<HTMLDivElement>(null);
  const neededTabsWidth = useRef(0);
  const [navMode, setNavMode] = useState<"tabs" | "select">("tabs");
  const flash = useRef<{ el: HTMLElement; timer: number } | null>(null);
  const searchRef = useRef<HTMLInputElement>(null);
  const searching = query.trim() !== "";

  const chooseGroup = useCallback((id: SettingsGroupId) => {
    setGroup(id);
    setQuery("");
    writeSettingsGroup(id);
  }, []);

  const jumpTo = useCallback((id: string) => {
    const entry = SETTING_ENTRIES.find((e) => e.id === id);
    if (!entry) return;
    chooseGroup(entry.group);
    setPendingJump(id);
  }, [chooseGroup]);

  useEffect(() => {
    if (jumpRequest && jumpRequest.nonce !== lastHandledJump) {
      lastHandledJump = jumpRequest.nonce;
      chooseGroup(jumpRequest.group);
    }
  }, [jumpRequest?.nonce]); // eslint-disable-line react-hooks/exhaustive-deps

  // A newly chosen group, or a new search, starts at the top of the content; a jump to a setting reveals it instead.
  useEffect(() => {
    if (!pendingJump && contentRef.current) contentRef.current.scrollTop = 0;
  }, [group, searching]); // eslint-disable-line react-hooks/exhaustive-deps

  // Once the group is showing: scroll to the setting, focus it, and highlight it for a moment.
  useEffect(() => {
    if (!pendingJump) return;
    const el = pageRef.current?.querySelector<HTMLElement>(`[data-setting="${pendingJump}"], [data-setting-card="${pendingJump}"]`);
    setPendingJump(null);
    if (!el) return;
    if (flash.current) {
      window.clearTimeout(flash.current.timer);
      flash.current.el.classList.remove("settings-flash");
    }
    reveal(el);
    el.focus({ preventScroll: true });
    el.classList.add("settings-flash");
    const timer = window.setTimeout(() => {
      el.classList.remove("settings-flash");
      flash.current = null;
    }, FLASH_MS);
    flash.current = { el, timer };
  }, [pendingJump]);
  useEffect(() => () => {
    if (flash.current) window.clearTimeout(flash.current.timer);
  }, []);

  /** Brings a setting into view by scrolling the content scroller and nothing else: `scrollIntoView` also scrolls every
   * scrollable ancestor, which can carry the title row and the search box out of the window. With no scroller (a very
   * short window shows the whole page scrolling instead) the browser's own scrolling is the right tool. */
  function reveal(el: HTMLElement) {
    const box = contentRef.current;
    if (!box || box.scrollHeight <= box.clientHeight) {
      el.scrollIntoView({ block: "center" });
      return;
    }
    const target = el.getBoundingClientRect();
    const inside = target.top - box.getBoundingClientRect().top + box.scrollTop;
    const room = box.clientHeight - target.height;
    const wanted = room > 0 ? inside - room / 2 : inside - 16;
    box.scrollTop = Math.max(0, Math.min(box.scrollHeight - box.clientHeight, wanted));
  }

  // The frame measures its own space: how far the scroller's scrollbar takes from the cards (so the search box can end
  // where the cards end) and whether the category tabs still fit (otherwise the category selector takes over).
  useEffect(() => {
    const frame = pageRef.current;
    if (!frame) return;
    const box = contentRef.current;
    const strip = navRef.current;
    const measure = () => {
      if (box) frame.style.setProperty("--settings-scrollbar", `${Math.max(0, box.offsetWidth - box.clientWidth)}px`);
      const width = frame.clientWidth;
      if (width === 0 || width > NAV_TABS_AT_MOST) {
        setNavMode("tabs");
        return;
      }
      if (strip && strip.clientWidth > 0) neededTabsWidth.current = strip.scrollWidth;
      setNavMode((current) => {
        if (width <= NAV_SELECT_AT_MOST) return "select";
        if (current === "select") return width >= neededTabsWidth.current + NAV_FIT_MARGIN ? "tabs" : "select";
        return strip && strip.scrollWidth > strip.clientWidth + 1 ? "select" : "tabs";
      });
    };
    measure();
    if (typeof ResizeObserver === "undefined") return;
    const observer = new ResizeObserver(measure);
    observer.observe(frame);
    if (box) observer.observe(box);
    if (strip) observer.observe(strip);
    return () => observer.disconnect();
  }, []);

  const { has, add, remove } = quick;
  const context = useMemo(() => ({ has, toggle: (id: string) => (has(id) ? remove(id) : add(id)) }), [has, add, remove]);

  function clearSearch() {
    setQuery("");
    searchRef.current?.focus();
  }

  const results = searching ? searchSettings(query) : [];
  const pickable = (pickQuery.trim() ? searchSettings(pickQuery).map((h) => h.entry) : SETTING_ENTRIES.filter((e) => !e.conditional)).filter((e) => !quick.has(e.id));
  const quickEntries = (quick.ids ?? []).map((id) => SETTING_ENTRIES.find((e) => e.id === id)).filter((e): e is SettingEntry => !!e);

  return (
    <QuickSettingsContext.Provider value={context}>
      <div className="settings-page" ref={pageRef} data-nav={navMode}>
        <div className="page-top settings-top">
          <div>{title}</div>
          <div className="settings-search" role="search">
            <input ref={searchRef} type="search" aria-label="Search settings" placeholder="Search settings" autoComplete="off" value={query} onChange={(e) => setQuery(e.target.value)} onKeyDown={(e) => { if (e.key === "Escape") setQuery(""); }} />
          </div>
        </div>
        <div className="settings-body">
          <div className="settings-nav" role="navigation" aria-label="Settings groups" ref={navRef}>
            <button type="button" className="settings-nav-item" aria-current={!searching && group === "quick" ? "true" : undefined} onClick={() => chooseGroup("quick")}>
              <span aria-hidden="true">★</span> Quick settings
            </button>
            <div className="settings-nav-sep" role="separator" />
            {SETTINGS_GROUPS.map((g) => (
              <button key={g.id} type="button" className="settings-nav-item" aria-current={!searching && group === g.id ? "true" : undefined} onClick={() => chooseGroup(g.id)}>
                {g.name}
              </button>
            ))}
          </div>
          <div className="settings-select" data-settings-select>
            <MenuSelect
              ariaLabel="Settings group"
              value={searching ? "" : group}
              placeholder="Choose a group"
              options={[{ value: "quick", label: "Quick settings" }, ...SETTINGS_GROUPS.map((g) => ({ value: g.id, label: g.name }))]}
              onChange={(value) => chooseGroup(value as SettingsGroupId)}
              fill
              showName
            />
          </div>
          <div className="settings-content" ref={contentRef}>
            {searching && (
              <div role="region" aria-label="Search results" className="settings-results">
                <h2 className="settings-group-head">{results.length ? `${results.length} ${results.length === 1 ? "setting matches" : "settings match"} “${query.trim()}”` : "Search"}</h2>
                {results.length ? (
                  <div className="card settings-result-list">
                    {results.map(({ entry }) => (
                      <button key={entry.id} type="button" className="settings-result-item" onClick={() => jumpTo(entry.id)}>
                        <span className="settings-path">{highlight(pathOf(entry), query.trim())}</span>
                        <span className="settings-result-label">{highlight(entry.label, query.trim())}</span>
                        <span className="modal-message-secondary">{highlight(entry.description, query.trim())}</span>
                      </button>
                    ))}
                  </div>
                ) : (
                  <div className="card settings-empty">
                    <p>No settings match “{query.trim()}”. Try a shorter word, like “backup” or “color”.</p>
                    <button type="button" className="modal-secondary" onClick={clearSearch}>Clear search</button>
                  </div>
                )}
              </div>
            )}

            <div data-settings-panel="quick" hidden={searching || group !== "quick"}>
              <h2 className="settings-group-head">Quick settings</h2>
              <p className="settings-group-sub">Shortcuts to the settings you use most. Click one to go straight to it.</p>
              {quick.error && <p role="alert" className="settings-error">{quick.error}</p>}
              {quick.ids !== null && (
                <>
                  {quickEntries.length ? (
                    <div className="card settings-quick-list">
                      {quickEntries.map((entry) => (
                        <div key={entry.id} className="settings-quick-entry" data-quick-entry={entry.id}>
                          <button type="button" className="settings-quick-go" data-quick-go onClick={() => jumpTo(entry.id)}>
                            <span className="settings-path">{pathOf(entry)}</span>
                            <span className="settings-result-label">{entry.label}</span>
                          </button>
                          <span className="settings-quick-cue" aria-hidden="true">Go to setting →</span>
                          <button type="button" className="settings-quick-remove" aria-label={`Remove ${entry.label} from Quick settings`} title="Remove" onClick={() => quick.remove(entry.id)}>
                            ×
                          </button>
                        </div>
                      ))}
                    </div>
                  ) : (
                    <div className="card settings-empty">Nothing here yet. Use “Add a setting” below, or click the ☆ beside any setting.</div>
                  )}
                  {pickerOpen ? (
                    <div className="card settings-picker" data-quick-picker>
                      <div className="settings-picker-head">
                        <input type="search" aria-label="Search for a setting to add" placeholder="Search for a setting to add" autoComplete="off" value={pickQuery} onChange={(e) => setPickQuery(e.target.value)} />
                        <button type="button" className="modal-secondary" data-quick-done onClick={() => { setPickerOpen(false); setPickQuery(""); }}>
                          Done
                        </button>
                      </div>
                      <div className="settings-picker-list">
                        {pickable.length ? (
                          pickable.slice(0, 30).map((entry) => (
                            <button key={entry.id} type="button" className="settings-picker-item" data-quick-add={entry.id} onClick={() => quick.add(entry.id)}>
                              <span>
                                <span className="settings-path">{pathOf(entry)}</span>
                                <span className="settings-result-label">{entry.label}</span>
                              </span>
                              <span className="settings-picker-add">Add</span>
                            </button>
                          ))
                        ) : (
                          <div className="settings-empty">No more settings match.</div>
                        )}
                      </div>
                    </div>
                  ) : (
                    <div>
                      <button type="button" className="modal-secondary" data-quick-add-open onClick={() => setPickerOpen(true)}>
                        Add a setting
                      </button>
                    </div>
                  )}
                </>
              )}
            </div>

            {SETTINGS_GROUPS.map((g) => (
              <div key={g.id} data-settings-panel={g.id} hidden={searching || group !== g.id}>
                <h2 className="settings-group-head">{g.name}</h2>
                <p className="settings-group-sub">{g.subline}</p>
                {panels[g.id]}
              </div>
            ))}
          </div>
        </div>
      </div>
    </QuickSettingsContext.Provider>
  );
}
