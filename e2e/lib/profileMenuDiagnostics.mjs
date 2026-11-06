// Diagnostics for the profile menu in desktop specs (spec 286). Observation only: nothing here clicks, waits or retries.
// The recorder and the snapshot run inside the page. They record element kinds (tag, class names, data-attribute names, role), counts and flags,
// never text typed by the user, profile names or profile ids, so the log is safe to keep in CI output.

/** Runs in the page. Idempotent. Records focus, pointer, key, window and menu open/close events with a millisecond clock. */
export function installMenuRecorder() {
  if (window.__menuLog) return;
  const start = performance.now();
  const log = (window.__menuLog = []);
  const mark = (kind, detail) => { if (log.length < 400) log.push({ t: Math.round(performance.now() - start), kind, ...detail }); };
  const describe = el => {
    if (!(el instanceof Element)) return { tag: el === document ? "document" : el === window ? "window" : "none" };
    return {
      tag: el.tagName.toLowerCase(), cls: String(el.className || "").slice(0, 60), role: el.getAttribute("role") || undefined,
      data: el.getAttributeNames().filter(n => n.startsWith("data-")).join(" ") || undefined,
      inDialog: Boolean(el.closest(".modal-panel")), inSwitcher: Boolean(el.closest(".profile-switcher")),
    };
  };
  for (const type of ["focusin", "focusout", "mousedown", "click"]) document.addEventListener(type, e => mark(type, { target: describe(e.target) }), true);
  document.addEventListener("keydown", e => mark("keydown", { key: ["Escape", "Tab", "Enter"].includes(e.key) ? e.key : "other", target: describe(e.target) }), true);
  window.addEventListener("blur", () => mark("window-blur", {}));
  window.addEventListener("focus", () => mark("window-focus", {}));
  document.addEventListener("visibilitychange", () => mark("visibility", { state: document.visibilityState }));
  const hasPanel = node => node.nodeType === 1 && (node.matches(".profile-switcher-panel") || Boolean(node.querySelector(".profile-switcher-panel")));
  const hasSwitcher = node => node.nodeType === 1 && (node.matches(".profile-switcher") || Boolean(node.querySelector(".profile-switcher")));
  new MutationObserver(records => {
    for (const r of records) {
      if (r.type === "attributes") { if (r.target.matches?.(".profile-switcher-toggle")) mark("aria-expanded", { from: r.oldValue, to: r.target.getAttribute("aria-expanded") }); continue; }
      for (const n of r.addedNodes) { if (hasPanel(n)) mark("panel-added", {}); if (hasSwitcher(n)) mark("switcher-added", {}); }
      for (const n of r.removedNodes) { if (hasPanel(n)) mark("panel-removed", {}); if (hasSwitcher(n)) mark("switcher-removed", {}); }
    }
  }).observe(document.body, { childList: true, subtree: true, attributes: true, attributeOldValue: true, attributeFilter: ["aria-expanded"] });
  mark("recorder-installed", {});
}

/** Runs in the page. Adds a labelled marker to the recorder's log. */
export function markMenuSite(site) {
  window.__menuLog?.push({ t: null, kind: "site", site });
}

/** Runs in the page. The menu, dialogs, focus and window state right now, plus the tail of the recorder's log. */
export function menuSnapshot() {
  const describe = el => el instanceof Element
    ? { tag: el.tagName.toLowerCase(), id: el.id || undefined, cls: String(el.className || "").slice(0, 60), type: el.getAttribute("type") || undefined,
        data: el.getAttributeNames().filter(n => n.startsWith("data-")).join(" ") || undefined, inDialog: Boolean(el.closest(".modal-panel")), inSwitcher: Boolean(el.closest(".profile-switcher")) }
    : { tag: "none" };
  const toggle = document.querySelector(".profile-switcher-toggle");
  const panel = document.querySelector(".profile-switcher-panel");
  const kind = b => b.hasAttribute("data-profile-switcher-lock") ? "lock" : b.className.includes("manage") ? "manage" : b.className.includes("option") ? "option" : "other";
  return {
    toggleExists: Boolean(toggle), ariaExpanded: toggle?.getAttribute("aria-expanded") ?? null, panelExists: Boolean(panel),
    panelEntries: panel ? [...panel.querySelectorAll("button")].map(kind) : [],
    dialogs: [...document.querySelectorAll(".modal-panel")].map(p => ({
      cls: String(p.className).slice(0, 60), role: p.getAttribute("role"), ariaModal: p.getAttribute("aria-modal"),
      heading: (p.querySelector("h1, h2, h3")?.textContent || "").trim().slice(0, 40), containsFocus: p.contains(document.activeElement),
    })),
    activeElement: describe(document.activeElement), documentHasFocus: document.hasFocus(), visibility: document.visibilityState,
    log: window.__menuLog ? window.__menuLog.slice(-40) : null,
  };
}

/** Which profile is active and whether it is protected, without names or ids: an index, counts and flags. */
export async function profileSummary(invoke, browser) {
  const result = await invoke(browser, "list_profiles");
  if (!Array.isArray(result.ok)) return { error: "list_profiles did not return a list" };
  const profiles = result.ok;
  const activeIndex = profiles.findIndex(p => p.is_active);
  return {
    count: profiles.length, activeIndex, activeIsDefault: activeIndex >= 0 && profiles[activeIndex].id === "default",
    activeProtected: activeIndex >= 0 ? Boolean(profiles[activeIndex].is_password_protected) : null,
    protectedCount: profiles.filter(p => p.is_password_protected).length,
  };
}

/** Prints one DIAGNOSTIC line for a menu opening that did not show Lock profile. Never throws: a failed capture is reported as such. */
export async function reportMenuFailure(browser, invoke, site, step, print = console.log) {
  let snapshot, profile;
  try { snapshot = await browser.execute(menuSnapshot); } catch (error) { snapshot = { error: `snapshot failed: ${String(error).slice(0, 120)}` }; }
  try { profile = await profileSummary(invoke, browser); } catch (error) { profile = { error: `profile summary failed: ${String(error).slice(0, 120)}` }; }
  print(`DIAGNOSTIC profile-menu site=${site} step=${step} ${JSON.stringify({ snapshot, profile })}`);
}
