# 1.3.0 UI Review Pass Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Ship UI review suggestions 1–14 inside release 1.3.0, so the app is calmer, easier to scan and uses colour, dates and layout consistently. Suggestion 15 is excluded, and the Ask the Vault box stays big.

**Architecture:** Frontend only: React + CSS in `src/`, plus E2E specs in `e2e/`. Nothing in the Rust core or the Tauri commands changes. The plan adds a few shared building blocks first: a `⋯` row menu, a fixed-position panel hook, display-date and colour-status helpers, a measured-width chart hook and a `DateField`. The page-level tasks then reuse them. Each task ends green on its own tests (unit tests, plus the affected E2E specs) and gets its own commit.

**Tech Stack:** React 19 + TypeScript, Vite, Vitest (jsdom), ESLint, Tauri v2 (WebView2), WebdriverIO E2E via `tauri-driver`.

**Spec:** There is no separate spec file. The requirements are the published UI review https://claude.ai/artifact/AVrepX9PJynQTcamGopf5X (suggestions s1–s14) plus the owner's decisions below. Executors read both. The review's screenshots are in `E:\misc\Programming\Claude\Implementations\vault-spend-ui-review-2026-10-04\`.

### Owner decisions (2026-10-04), binding

- All of this goes into **release 1.3.0** (a major release), as **one plan broken into tasks**. Do not split it into separate redesigns or releases.
- Suggestions **1–14 approved**.
- **Suggestion 15 (Cash Flow vs Reports) rejected.** Do not change Cash Flow's or Reports' date ranges, sections or overlap. Both keep all their information.
- From **suggestion 6**: **do NOT shrink "Ask the Vault" into a small search-style field in the title row.** It stays a big, prominent feature, unchanged in size and in its place directly under the Dashboard title. The rest of s6 is approved.
- The owner is wary of changes that remove information users find useful (this is why s15 was rejected). Where a suggestion would drop information, this plan **moves it instead of deleting it**: counts go into the subtitle, settings go into a menu with a visible marker, and so on. Keep that principle whenever you make a judgement call.

## Global Constraints

- Branch: all work lands on `1.3.0`. No version bump, changelog entry, merge to `main`, tag or push in this plan. Those belong to the release runbook ("push out the new build"). **Ask the owner before any push.**
- Shared checkout: the main checkout `E:\misc\Programming\Budgeting App` holds another session's **uncommitted mobile work** (`core/src/*mobile*`, `src/Mobile*`, `src/mobile*`, `mobile/`, `tools/*mobile*`, `vite.mobile.config.ts`, plus edits to `.gitignore`, `core/src/lib.rs`, `core/src/store.rs`, `package.json`, `src-tauri/src/command_thread.rs`). **Never stage, edit, stash or revert any of it.** Do all work in a worktree (see "Before Task 1").
- Do not edit `package.json`; the mobile session has uncommitted changes in it. If a task truly needs a script, run it with `node tools/<file>.mjs` instead.
- Frontend only. No Rust or schema changes.
- Copy: plain language for people who are not financially literate. No jargon such as "tracked", "published", "sinking fund", "liabilities" or "ISO". `src/plainLanguage.test.ts` must pass. New on-screen strings go through it automatically.
- Every visual change must look right in all three styles: Default (`transparent`), Futuristic and Retro, each in Light and Dark. Use only existing CSS tokens (`var(--…)`). Never hard-code colours.
- Width: no sideways page scroll at 800px, 1280px or 1440px.
- "Hide amounts" (`data-privacy="on"`) masks text but **skips `<input>` values**. Any amount you newly show inside an input must be swapped for masked text while amounts are hidden.
- TDD: write or extend the failing test first, then implement. Before calling any task done, run the whole unit suite (`npm test`), not just the new tests.
- E2E: always use the parallel runner (`npm run e2e`, which is `node e2e/run-all.mjs`). Never loop over specs one by one. Rebuild first with `npx tauri build --debug --no-bundle`. Read `e2e/README.md` before changing specs. Never assert on a single read: use `waitUntilOrDiagnose`, `withFocusRetry`, `pickFromMenu` and `chooseMenuOption`.
- Fix, never defer. If you find a bug (including a reviewer's minor), fix it in the task you're in and record it in the commit message.
- Commit messages end with `Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>`.

## Review Focus

These are the five inputs or conditions the review implies but doesn't spell out, and that are most likely to hurt a real user. Each has a test in the task named.

1. **Icon-only sidebar loses names.** Below 1000px the sidebar labels are hidden. Screen readers and the E2E text selectors (`button*=Settings` appears 49 times) must still find each tab by name. The names must also appear on hover and focus. (Task 3)
2. **People who never customized the Dashboard.** Their saved layout is the old default order. They should get the new order. Anyone with a custom or named layout keeps theirs exactly. (Task 6)
3. **Habit of typing a minus sign.** With the new switch, someone types `-50` with "Money out" selected. The result must be −50, not +50. Typing `50` with "Money in" must give +50. A `0` must be refused. (Task 13)
4. **Hide amounts with the new always-visible budget field.** Inputs aren't masked, so a visible budget input would leak the figure. While amounts are hidden, the budget cell must show masked text, and clicking it must still allow editing. (Task 5)
5. **Row menu at the bottom of a scrolled list, or the row disappears.** The `⋯` menu on the last visible ledger row must open upward and stay inside the window. If the row is removed while its menu is open (deleted, filtered out, or changed by a bulk action), the menu must close and must not run the action against a stale row. (Task 1 and Task 4)

---

## Before Task 1: worktree and baseline (no commit)

The main checkout can't build cleanly while the mobile work is uncommitted, so work in a worktree on a side branch and fast-forward `1.3.0` at the end (Task 16).

- [ ] Create the worktree from `1.3.0`:

```powershell
git -C "E:\misc\Programming\Budgeting App" worktree add "$env:TEMP\vs-ui-pass" -b 1.3.0-ui-pass 1.3.0
cmd /c mklink /J "$env:TEMP\vs-ui-pass\node_modules" "E:\misc\Programming\Budgeting App\node_modules"
```

- [ ] Every command below runs from `$env:TEMP\vs-ui-pass` with `$env:CARGO_TARGET_DIR = "$env:TEMP\vs-verify-target"`.
- [ ] Baseline: `npm test` (expect about 1,042 passing), `npm run lint`, `npx tsc --noEmit`, `npx tauri build --debug --no-bundle`, `npm run e2e` (expect 164/164). Record the numbers. If anything is red before you start, fix it first, in its own commit.

---

### Task 1: Shared `⋯` row menu and fixed panel placement

Transactions (Task 4), Budget (Task 5) and Accounts (Task 10) all use this menu.

**Files:**
- Create: `src/useFixedPanel.ts` (positioning extracted from `RowFieldDropdown.tsx`)
- Modify: `src/RowFieldDropdown.tsx` (use the hook; behaviour unchanged)
- Create: `src/RowMenu.tsx`, `src/RowMenu.css`, `src/RowMenu.test.tsx`
- Modify: `e2e/harness.mjs` (add `chooseRowAction`), `e2e/harness.test.mjs` if it lists exports

**Interfaces:**
- Produces:
  - `useFixedPanel(open: boolean, triggerRef: RefObject<HTMLElement|null>, panelRef: RefObject<HTMLElement|null>, opts?: { minWidth?: number; align?: "start" | "end" }): void`
  - `type RowMenuItem = { kind?: "action"; label: string; onSelect: () => void; danger?: boolean; disabled?: boolean } | { kind: "check"; label: string; checked: boolean; onToggle: (next: boolean) => void; disabled?: boolean } | { kind: "divider" }`
  - `RowMenu(props: { label: string; items: (RowMenuItem | false | null | undefined)[]; className?: string })`. The trigger is `button.row-menu-toggle[data-row-menu]` with `aria-label={label}` and the text `⋯`. The panel is `div.row-menu-panel[role=menu]`. Items have role `menuitem` or `menuitemcheckbox`.
  - E2E: `chooseRowAction(browser, trigger, label)`, where `trigger` is a selector or an async function returning the row's `[data-row-menu]` button.

- [ ] **Step 1: Write the failing tests** in `src/RowMenu.test.tsx`:

```tsx
// @vitest-environment jsdom
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { RowMenu, type RowMenuItem } from "./RowMenu";

(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

describe("RowMenu", () => {
  let container: HTMLDivElement;
  let root: Root;
  beforeEach(() => {
    container = document.createElement("div");
    document.body.append(container);
    root = createRoot(container);
  });
  afterEach(() => {
    act(() => root.unmount());
    container.remove();
  });
  const render = (items: (RowMenuItem | false | null | undefined)[]) =>
    act(() => root.render(<RowMenu label='Actions for "Coffee"' items={items} />));
  const trigger = () => container.querySelector<HTMLButtonElement>("[data-row-menu]")!;
  const panel = () => document.body.querySelector<HTMLElement>(".row-menu-panel");
  const item = (label: string) =>
    Array.from(document.body.querySelectorAll<HTMLButtonElement>(".row-menu-panel [role^='menuitem']")).find((b) => b.textContent?.trim() === label)!;

  it("names the trigger and opens a menu with only the truthy items", () => {
    render([{ label: "Split…", onSelect: () => {} }, false, null, { kind: "divider" }, { label: "Delete…", onSelect: () => {}, danger: true }]);
    expect(trigger().getAttribute("aria-label")).toBe('Actions for "Coffee"');
    expect(trigger().getAttribute("aria-haspopup")).toBe("menu");
    act(() => trigger().click());
    expect(panel()?.getAttribute("role")).toBe("menu");
    expect(Array.from(panel()!.querySelectorAll("[role='menuitem']")).map((b) => b.textContent)).toEqual(["Split…", "Delete…"]);
    expect(item("Delete…").className).toContain("row-menu-item-danger");
  });

  it("runs an action once, closes, and gives focus back to the trigger", () => {
    const onSelect = vi.fn();
    render([{ label: "Split…", onSelect }]);
    act(() => trigger().click());
    act(() => item("Split…").click());
    expect(onSelect).toHaveBeenCalledTimes(1);
    expect(panel()).toBeNull();
    expect(document.activeElement).toBe(trigger());
  });

  it("shows a tick for a check item and flips it", () => {
    const onToggle = vi.fn();
    render([{ kind: "check", label: "Roll over unspent", checked: true, onToggle }]);
    act(() => trigger().click());
    const check = item("Roll over unspent");
    expect(check.getAttribute("role")).toBe("menuitemcheckbox");
    expect(check.getAttribute("aria-checked")).toBe("true");
    act(() => check.click());
    expect(onToggle).toHaveBeenCalledWith(false);
  });

  it("does nothing for a disabled item", () => {
    const onSelect = vi.fn();
    render([{ label: "Apply to a debt…", onSelect, disabled: true }]);
    act(() => trigger().click());
    act(() => item("Apply to a debt…").click());
    expect(onSelect).not.toHaveBeenCalled();
    expect(item("Apply to a debt…").getAttribute("aria-disabled")).toBe("true");
  });

  it("closes on Escape (focus back to trigger) and on a click outside", () => {
    render([{ label: "Split…", onSelect: () => {} }]);
    act(() => trigger().click());
    act(() => document.dispatchEvent(new KeyboardEvent("keydown", { key: "Escape" })));
    expect(panel()).toBeNull();
    expect(document.activeElement).toBe(trigger());
    act(() => trigger().click());
    act(() => document.body.dispatchEvent(new MouseEvent("mousedown", { bubbles: true })));
    expect(panel()).toBeNull();
  });

  it("moves focus with the arrow keys and wraps", () => {
    render([{ label: "A", onSelect: () => {} }, { label: "B", onSelect: () => {} }]);
    act(() => trigger().click());
    expect(document.activeElement).toBe(item("A"));
    act(() => panel()!.dispatchEvent(new KeyboardEvent("keydown", { key: "ArrowDown", bubbles: true })));
    expect(document.activeElement).toBe(item("B"));
    act(() => panel()!.dispatchEvent(new KeyboardEvent("keydown", { key: "ArrowDown", bubbles: true })));
    expect(document.activeElement).toBe(item("A"));
  });

  it("closes without running anything when its row unmounts while open (Review Focus 5)", () => {
    const onSelect = vi.fn();
    render([{ label: "Delete…", onSelect }]);
    act(() => trigger().click());
    act(() => root.render(<></>));
    expect(panel()).toBeNull();
    expect(onSelect).not.toHaveBeenCalled();
  });
});
```

- [ ] **Step 2:** Run `npx vitest run src/RowMenu.test.tsx`. Expected: FAIL, because `./RowMenu` doesn't exist yet.

- [ ] **Step 3: Extract `useFixedPanel`.** Move the `place()` logic out of the `useLayoutEffect` in `src/RowFieldDropdown.tsx` (lines 65–95 today) into `src/useFixedPanel.ts`:

```ts
import { useLayoutEffect, type RefObject } from "react";

/** Positions a portaled, `position: fixed` panel beside its trigger: below it, or above it
 * when there's more room there, never past the window edges. It follows scrolling and
 * resizing. This lets a row-level menu escape the ledger's clipping scroll container and
 * the Transparent style's backdrop-filter containing block (see RowFieldDropdown). */
export function useFixedPanel(
  open: boolean,
  triggerRef: RefObject<HTMLElement | null>,
  panelRef: RefObject<HTMLElement | null>,
  { minWidth = 220, align = "start" }: { minWidth?: number; align?: "start" | "end" } = {},
): void {
  useLayoutEffect(() => {
    const panel = panelRef.current;
    const trigger = triggerRef.current;
    if (!open || !panel || !trigger) return;
    function place() {
      if (!panel || !trigger) return;
      const rect = trigger.getBoundingClientRect();
      const below = window.innerHeight - rect.bottom - 12;
      const above = rect.top - 12;
      const wanted = Math.min(panel.scrollHeight + 2, 340);
      const useAbove = below < wanted && above > below;
      panel.style.maxHeight = `${Math.max(0, Math.min(wanted, useAbove ? above : below))}px`;
      panel.style.top = useAbove ? "auto" : `${rect.bottom + 6}px`;
      panel.style.bottom = useAbove ? `${window.innerHeight - rect.top + 6}px` : "auto";
      panel.style.minWidth = `${Math.max(align === "start" ? rect.width : 0, minWidth)}px`;
      let left = align === "end" ? rect.right - panel.offsetWidth : rect.left;
      const maxLeft = window.innerWidth - 8 - panel.offsetWidth;
      if (left > maxLeft) left = maxLeft;
      if (left < 8) left = 8;
      panel.style.left = `${left}px`;
    }
    place();
    window.addEventListener("resize", place);
    document.addEventListener("scroll", place, true);
    return () => {
      window.removeEventListener("resize", place);
      document.removeEventListener("scroll", place, true);
    };
  }, [open, triggerRef, panelRef, minWidth, align]);
}
```

In `RowFieldDropdown.tsx`, call `useFixedPanel(open, triggerRef, panelRef)`. Keep its focus-the-checked-item line in a small `useLayoutEffect` of its own. Run `npx vitest run src/RowFieldDropdown.test.tsx` and expect PASS (no behaviour change).

- [ ] **Step 4: Implement `src/RowMenu.tsx`.** Follow `RowFieldDropdown`'s structure: outside `mousedown` and `Escape` listeners while open, `createPortal` into `document.body`, and the panel class `row-menu-panel row-field-panel-fixed`. Call `useFixedPanel(open, triggerRef, panelRef, { minWidth: 200, align: "end" })`. On open, focus the first enabled item. Handle `ArrowDown`, `ArrowUp`, `Home` and `End` on the panel, wrapping at either end. `Tab` closes the menu. Choosing an action calls `setOpen(false)`, then `triggerRef.current?.focus()`, then `onSelect()`. A check item calls `onToggle(!checked)` and closes. A disabled item sets `aria-disabled="true"` and ignores clicks. A divider is `<div role="separator" className="row-menu-divider" />`. The danger class is `row-menu-item-danger`. Unmounting closes the menu automatically because the portal belongs to the component; there's no extra state.

`src/RowMenu.css` styles the trigger as a 28px square ghost button (`background: transparent; border: 1px solid transparent; color: var(--text-muted)`, with `var(--border)` on hover and focus-visible). It styles the panel like `.row-field-panel` (reuse its tokens). Items are full-width left-aligned rows, 32px tall. `.row-menu-item-danger { color: var(--negative) }`. A check item shows `✓` in a 1.2em leading slot. Import the CSS from `RowMenu.tsx`.

- [ ] **Step 5:** Run `npx vitest run src/RowMenu.test.tsx src/RowFieldDropdown.test.tsx`. Expected: PASS.

- [ ] **Step 6: E2E helper.** In `e2e/harness.mjs`, add this after `pickFromMenu`:

```js
/** Opens a row's ⋯ menu (RowMenu) and clicks the item with this exact label, through withFocusRetry
 * (another window taking focus closes the menu between the two clicks). */
export async function chooseRowAction(browser, trigger, label) {
  await pickFromMenu(browser, trigger, async () => {
    const items = await browser.$$(".row-menu-panel [role^='menuitem']");
    for (const item of items) if ((await item.getText()).trim() === label) return item;
    return browser.$(`.row-menu-panel [data-no-such-item="${label}"]`);
  });
}
```

- [ ] **Step 7:** Run `npm test`, `npm run lint` and `npx tsc --noEmit`. Expected: all PASS.
- [ ] **Step 8: Commit**: `git add src/useFixedPanel.ts src/RowFieldDropdown.tsx src/RowMenu.tsx src/RowMenu.css src/RowMenu.test.tsx e2e/harness.mjs`, then `git commit -m "Add a shared row menu (⋯) and fixed panel placement"`.

---

### Task 2: Win back the top of every page (s3)

Drop the big top bar. Hide amounts and Light / Dark / System move to the bottom of the sidebar (and Light / Dark / System also goes into Settings, see Task 14). Each page's actions go on the right of its title row. The tagline stays on the welcome screen and in About.

**Files:**
- Delete: `src/AppTopBar.tsx`
- Create: `src/SidebarControls.tsx`, `src/SidebarControls.test.tsx`, `src/LedgerPageActions.tsx`
- Modify: `src/App.tsx` (lines ~3580–3610 for the shell, ~3696 for the ledger `page-top`)
- Modify: `src/AppShell.css` (remove the `.topbar*` rules around lines 326–450; keep `.import-controls` and `.more-menu*` rules but un-nest them from `.topbar`; add `.sidebar-controls`)
- Modify: `src/usePopover.ts` (the panel's top edge no longer looks up `.topbar`)
- Modify: `src/SettingsView.tsx` (`AboutSection`, line ~1106: add the tagline line)
- Modify: `src/App.css` (line ~420: any sticky offset that assumed the top bar)
- Create: `src/frameLayout.test.ts` (source guard)
- Modify E2E: `feature38_theme_style`, `feature142_retro_theme`, `feature153_futuristic_refresh`, `feature157_loading_state`, `feature88_text_inputs_match` (they reference `.topbar`), `feature61_layout_fixes` and `feature112_inbox_bulk_review` (import controls). Create `e2e/feature266_page_frame.mjs`.

**Interfaces:**
- Produces: `SidebarControls(props: { privacyHidden: boolean; onTogglePrivacy: () => void; theme: Theme; onSetTheme: (t: Theme) => void })`. It keeps the existing hooks `button.privacy-toggle[data-privacy-toggle]` and `.theme-toggle` / `.theme-toggle-active` so the existing E2E selectors still work. It adds a `button.theme-cycle[data-theme-cycle]`, which Task 3 shows in icon mode.
- Produces: `LedgerPageActions`, taking the same props the ledger half of `AppTopBar` took (`accounts`, `selectedAccountId`, `handleAccountSelectChange`, `busy`, `importReview`, `dataLoaded`, `handleImport`, `setNewTransactionOpen`, the more-menu refs and state, `openManageCategories`, `openManageFamilyMembers`, `handleRecategorize`, `handleExportLedgerCsv`).

- [ ] **Step 1: Failing tests.** In `src/SidebarControls.test.tsx`, render with `privacyHidden=false`, `theme="dark"`, and check that:
  - `[data-privacy-toggle]` has `aria-pressed="false"` and the text "Hide amounts", and clicking it calls `onTogglePrivacy` once
  - the group `role="group"` has `aria-label="Theme"`, the "Dark" button has `theme-toggle-active`, and clicking "Light" calls `onSetTheme("light")`
  - `[data-theme-cycle]` has `aria-label="Theme: Dark. Switch to System."`, and clicking it calls `onSetTheme("system")`. The cycle order is light → dark → system → light.
  - With `privacyHidden=true`, the toggle reads "Show amounts" with `aria-pressed="true"`.

  In `src/frameLayout.test.ts`, use `readFileSync` over `src/**/*.tsx` and `src/**/*.css` (skip `changelog.ts` and `Mobile*` / `mobile*`) and assert that no file contains `className="topbar"`, `.topbar` or `"Own your Data, Own your Money!"`, except `Modal.tsx` (the welcome dialog) and `SettingsView.tsx` (About).
- [ ] **Step 2:** Run both tests. Expected: FAIL (the module is missing, and `AppTopBar.tsx` still contains `topbar`).
- [ ] **Step 3: Implement.**
  - `SidebarControls.tsx` renders `<div className="sidebar-controls">` holding the privacy button (same title text as before), the three-button theme group, and the cycle button (`↻` glyph plus the visually hidden current theme name).
  - In `App.tsx`:
    - Remove the `<AppTopBar …/>` element and its import.
    - Change `.sidebar-foot` to `<div className="sidebar-foot"><SidebarControls privacyHidden={privacyPrefs.hidden} onTogglePrivacy={() => setPrivacyPrefs((p) => ({ ...p, hidden: !p.hidden }))} theme={theme} onSetTheme={setTheme} />{appVersion && <p className="sidebar-version">v{appVersion}</p>}</div>`.
    - In the ledger `page-top` (line ~3697), change the right-hand side to `<div className="page-actions">{inboxCount > 0 && …Review inbox…}<LedgerPageActions …/></div>`.
  - `LedgerPageActions.tsx` is the `activeTab === "ledger"` block of `AppTopBar` moved over unchanged: "Add to" dropdown, Import transactions…, Add transaction… and the `⋯` More actions menu.
  - Delete `AppTopBar.tsx`.
  - Add one line to `AboutSection`: `<p className="modal-message-secondary">Own your Data, Own your Money!</p>`.
  - In `usePopover.ts`, replace the `header` lookup with `const topEdge = 8;`.
  - In `AppShell.css`, delete the `.topbar`, `.topbar h1`, `.subtitle` and `.topbar-actions` rules. Keep the theme-toggle and privacy-toggle looks, rescoped under `.sidebar-controls`: stack them vertically, with the theme group full width. Then grep `topbar` in `src/` and fix every remaining hit, including the comment and offset at `App.css:420` and `AppResponsive.css`.
- [ ] **Step 4: Page actions audit.** Open every view (`DashboardView`, `AccountsView`, `BudgetView`, `RecurringView`, `BucketsView` (Goals), `CashFlowView`, `ReportsView`, `InvestmentsView`, `HouseholdView`, `SettingsView`, `HelpView`) and confirm each page's own buttons sit in `.page-top > .page-actions`. Move any page-level action row that sits outside it. The Dashboard's `.quick-actions` row moves in Task 6; leave it for now. Write the list of what you moved in the commit message.
- [ ] **Step 5:** Run `npm test`, `npm run lint` and `npx tsc --noEmit`. Expected: PASS.
- [ ] **Step 6: E2E.**
  - Update the five `.topbar` specs. Theme and privacy selectors are unchanged; only selectors scoped by `.topbar` change, to `.sidebar-controls`.
  - In `feature157_loading_state`, change whatever it waited on in the top bar to the sidebar.
  - Create `e2e/feature266_page_frame.mjs`. Launch, set the window to 1440×1000, and check each of these with `waitUntilOrDiagnose`:
    - there's no `.topbar` element
    - `.sidebar-foot [data-privacy-toggle]` and `.sidebar-foot .theme-toggle` are displayed
    - on Transactions, `.page-top .page-actions` contains the buttons "Import transactions…" and "Add transaction…"
    - on the Dashboard, after `document.querySelector('.main').scrollTop = 400`, no element with `position: sticky|fixed` and a height over 60px sits at the top of `.main` (the old cover-up)
    - clicking "Dark" sets `document.documentElement.dataset.theme` (or whatever `feature38` already reads) to dark
  - Rebuild, then run `npm run e2e -- --spec=smoke,38,142,153,157,88,61,112,72,146,89,95,266`. Expected: all PASS.
- [ ] **Step 7: Commit**: `"Drop the top bar: theme and Hide amounts in the sidebar, page actions beside titles"`.

---

### Task 3: Shrink the sidebar to icons in a narrow window (s13)

**Files:**
- Modify: `src/AppResponsive.css` (breakpoint 760 → 1000px), `src/AppShell.css`, `src/App.tsx` (sidebar markup around line 3498)
- Modify: `e2e/harness.mjs` (`launchApp` default window size), `e2e/harness.test.mjs`
- Create: `src/sidebarNames.test.tsx`, `e2e/feature267_icon_sidebar.mjs`

**Interfaces:**
- Consumes: `SidebarControls` from Task 2 (its `[data-theme-cycle]` button).
- Produces: nav buttons carry `data-tab={item.id}` and `aria-label={item.label}`. `.app-shell` gets the class `sidebar-expanded` while expanded. There's a `button.sidebar-expand[data-sidebar-expand]` with `aria-expanded`.

- [ ] **Step 1: Failing test** `src/sidebarNames.test.tsx`. Import `NAV_ITEMS` and `PINNED_NAV_ITEMS` (wherever `App.tsx` defines them; export them if they aren't exported yet) and render a small `SidebarNav` component that you extract from `App.tsx` (the `NAV_GROUP_ORDER.map` block plus the pinned list, with the same props it uses today). Assert:
  - every nav button has `aria-label` equal to its label and `data-tab` equal to its id (Review Focus 1)
  - `.nav-text` uses the class `nav-text`, never inline `display:none`
  - `AppResponsive.css`, read as text, has no `display: none` rule for `.nav-text` (the hiding must use the visually-hidden pattern, so the name survives for assistive tech)
- [ ] **Step 2:** Run it. Expected: FAIL.
- [ ] **Step 3: Implement.**
  - Extract `SidebarNav` into `src/SidebarNav.tsx` (pure move plus the two attributes).
  - In `AppResponsive.css`, change `@media (max-width: 760px)` to `@media (max-width: 1000px)` for the sidebar rules only. Keep the `.page`/`.topbar` padding rules at 760 and delete the `.topbar` one. Replace `.nav-item span.nav-text, .brand-word, .nav-group-label { display: none }` with the visually-hidden pattern (`position:absolute; width:1px; height:1px; overflow:hidden; clip-path: inset(50%); white-space:nowrap`) for `.nav-text`. Keep `display:none` for `.brand-word` and `.nav-group-label`, which are decorative or `aria-hidden`.
  - Tooltip: in icon mode, `.nav-item:hover::after, .nav-item:focus-visible::after { content: attr(aria-label); … }` positioned to the right of the rail, using the `var(--status-base)` surface and `var(--border-strong)` border, with `z-index` above `.main`.
  - Expand toggle: in `App.tsx`, add `const [sidebarExpanded, setSidebarExpanded] = useState(false)`. Render `<button type="button" className="sidebar-expand" data-sidebar-expand aria-expanded={sidebarExpanded} aria-label={sidebarExpanded ? "Hide names" : "Show names"} onClick={() => setSidebarExpanded(v => !v)}>☰</button>` at the top of the sidebar. CSS shows it only inside the 1000px media query. While expanded inside the query, `.app-shell.sidebar-expanded .sidebar { position: absolute; inset-block: 0; width: 232px; z-index: 30; box-shadow: var(--shadow-lg, 0 8px 24px rgb(0 0 0 / .25)) }` and the hidden text styles are undone. Choosing a nav item, pressing Escape, or a `mousedown` outside `.sidebar` all collapse it.
  - Sidebar foot in icon mode: hide `.theme-toggle` and show `[data-theme-cycle]`. The privacy button shows an eye glyph, with its text visually hidden but still present.
- [ ] **Step 4:** Run `npm test`, lint and tsc. Expected: PASS.
- [ ] **Step 5: E2E window default.** With the rail kicking in at 1000px, the 800×600 default window would hide nav text from the `button*=Settings` selectors (49 uses). In `launchApp`, add an option `windowSize = { width: 1280, height: 800 }` that is applied after launch. `reclaimWindowFocus` already re-applies the last size it set, so make it read the stored value. Specs that need the narrow layout already call `setWindowSize(800, …)` explicitly; leave them alone. Update `e2e/harness.test.mjs` for the new default.
- [ ] **Step 6: New spec** `e2e/feature267_icon_sidebar.mjs`:
  - At 900×800, `.nav-item[data-tab=budget]` has rendered width under 80px. `aria-label` is "Budget". `browser.execute(() => getComputedStyle(document.querySelector('.nav-item[data-tab=budget] .nav-text')).position)` returns `"absolute"`.
  - Focusing it shows the tooltip (the computed `::after` content is `"Budget"`).
  - Clicking `[data-sidebar-expand]` makes the sidebar at least 200px wide. Clicking the Budget tab collapses it, and the active tab is Budget.
  - `[data-theme-cycle]` is displayed and cycles the theme.
  - At 1280×800, the full sidebar shows text and `[data-sidebar-expand]` isn't displayed.
- [ ] **Step 7:** Rebuild, then run the **full** suite with `npm run e2e`. The default window size changed, which is shared harness infrastructure. Fix every spec that relied on the old 800px default by giving it an explicit `setWindowSize(800, 600)`. Expected: all PASS.
- [ ] **Step 8: Commit**: `"Icon-only sidebar below 1000px, with names on hover/focus and a Show names toggle"`.

---

### Task 4: Calm the Transactions table (s1)

Make each row plain text, put the actions in the `⋯` menu, right-align amounts, show the member column only when it's useful, and replace the four tiles with one line.

**Files:**
- Modify: `src/LedgerTable.tsx`, `src/TransferRow.tsx`, `src/Ledger.css`, `src/RowFieldDropdown.tsx` (add a `plain` variant), `src/App.tsx` (stats tiles at ~3736, ledger subtitle at ~3700, `ledgerColumnCount`)
- Create: `src/ledgerRowActions.ts`, `src/ledgerRowActions.test.ts`, `src/LedgerNeedsCategory.tsx`, `src/LedgerNeedsCategory.test.tsx`
- Modify E2E: specs that click row-level Split, Apply to a debt, Split principal, + Add note, + tag or Delete. Find them all with `grep -ln "split-toggle\|debt-apply-trigger\|transaction-note-add\|tag-input\|button=Delete\|Needs a category\|stat-label\|member-col\|Unassigned" e2e/*.mjs`. Today that includes 1, 4, 5, 12, 23, 28, 49, 57, 159. Create `e2e/feature268_calm_ledger.mjs`.

**Interfaces:**
- Consumes: `RowMenu`, `RowMenuItem` and `chooseRowAction` (Task 1).
- Produces: `ledgerRowActions(t: Transaction, ctx: { splitEnabled: boolean; debtEnabled: boolean; isLoanAccount: boolean; canApplyToDebt: boolean; hasPrincipalOverride: boolean; hasAppliedDebt: boolean }): { id: "split" | "principal" | "applyDebt" | "note" | "tag" | "delete"; label: string }[]`. This is a pure function deciding which menu items a row gets, in order. `RowFieldDropdown` gains the prop `variant?: "boxed" | "plain"` (default `"boxed"`) and `displayLabel?: string`, which overrides the trigger text so the member cell can be blank.

- [ ] **Step 1: Failing tests.**
  - `src/ledgerRowActions.test.ts`:

```ts
import { describe, expect, it } from "vitest";
import { ledgerRowActions } from "./ledgerRowActions";
const t = (over: Partial<{ amount: string; split_count: number; notes: string | null }> = {}) =>
  ({ amount: "-20.00", split_count: 0, notes: null, ...over }) as never;
const base = { splitEnabled: true, debtEnabled: true, isLoanAccount: false, canApplyToDebt: true, hasPrincipalOverride: false, hasAppliedDebt: false };

describe("ledgerRowActions", () => {
  it("offers split, apply to a debt, note, tag and delete for an ordinary purchase", () => {
    expect(ledgerRowActions(t(), base).map((a) => a.label)).toEqual(["Split…", "Apply to a debt…", "Add note…", "Add tag…", "Delete…"]);
  });
  it("says Edit splits / Edit note when they exist", () => {
    expect(ledgerRowActions(t({ split_count: 2, notes: "x" }), base).map((a) => a.label)).toEqual(["Edit splits…", "Apply to a debt…", "Edit note…", "Add tag…", "Delete…"]);
  });
  it("offers principal on a loan account instead of apply to a debt", () => {
    expect(ledgerRowActions(t(), { ...base, isLoanAccount: true }).map((a) => a.id)).toEqual(["split", "principal", "note", "tag", "delete"]);
  });
  it("hides debt items when the feature is off, already applied, or money came in", () => {
    expect(ledgerRowActions(t(), { ...base, debtEnabled: false }).some((a) => a.id === "applyDebt")).toBe(false);
    expect(ledgerRowActions(t(), { ...base, hasAppliedDebt: true }).some((a) => a.id === "applyDebt")).toBe(false);
    expect(ledgerRowActions(t({ amount: "20.00" }), base).some((a) => a.id === "applyDebt")).toBe(false);
  });
  it("hides split when splitting is turned off", () => {
    expect(ledgerRowActions(t(), { ...base, splitEnabled: false }).some((a) => a.id === "split")).toBe(false);
  });
});
```

  - `src/LedgerNeedsCategory.test.tsx`: `LedgerNeedsCategory({ count, active, onToggle })`.
    - `count=0` with `active=false` renders nothing.
    - `count=12` renders the text "12 transactions need a category" and a button "Review" that calls `onToggle`.
    - `count=1` renders "1 transaction needs a category".
    - `active=true` renders "Showing the 12 that need a category" and the button "Show all".
- [ ] **Step 2:** Run both. Expected: FAIL.
- [ ] **Step 3: Implement the pure parts.** Write `ledgerRowActions.ts` to satisfy the tests:
  - `Split…` or `Edit splits…` appears when `splitEnabled`.
  - On a loan account, `Split principal…` appears when debt is enabled and there's no `hasPrincipalOverride`.
  - Otherwise, `Apply to a debt…` appears when debt is enabled, `canApplyToDebt`, the amount is negative and there's no `hasAppliedDebt`.
  - Then `Add note…` or `Edit note…`, `Add tag…`, and `Delete…`.

  Write `LedgerNeedsCategory.tsx` as `<p className="ledger-needs-category" data-needs-category>` with the sentence and a `modal-secondary btn-sm` button.
- [ ] **Step 4: Rows.** In `LedgerTable.tsx`:
  - **Plain cells:** `accountField`, `memberField` and `categoryField` use `RowFieldDropdown variant="plain"`. In `RowFieldDropdown.tsx`, `variant="plain"` adds `row-field-toggle-plain`. CSS in `Ledger.css`: no border or background, caret `opacity: 0` until `:hover`/`:focus-visible`/`[aria-expanded=true]`, and text in `var(--text)`. The `aria-label`s don't change, so E2E selectors for account/member/category keep working.
  - **Uncategorized:** when `t.category` is empty, the category trigger gets the extra class `row-field-needs` (`color: var(--negative)`; this is a "needs you" state per s4) and shows "Needs a category".
  - **Member column:** show it only when `familyMembers.length >= 2`. Add `const showMemberCol = familyMembers.length >= 2` as a prop from `App.tsx`, and fold it into `ledgerColumnCount`. Where it shows, a row with no member gets `displayLabel=""`. The menu still lists "No one" first, labelled `{ value: "", label: "No one" }`.
  - **Debt column:** remove the separate column. The *state* stays visible as a line under the description, in `transaction-description-meta`: the applied badge `→ Mortgage ($500.00)` with Undo, the `Principal: $x` badge with Reset, and the open apply/principal forms. The *triggers* move into the menu. Recompute `ledgerColumnCount` (in `App.tsx`) as 1 (select) + date + description + amount + [account] + [member] + [category] + [source] + actions, so it stays correct at narrow width and with the member column on or off. Test it via the DOM in Step 6.
  - **Description cell:**
    - Keep the tag pills (with ×) and show the note preview as muted text (`transaction-note-preview`, still a button that opens the note dialog). Remove the always-on `+ tag` input and `+ Add note` button.
    - "Add tag…" sets a new state `taggingId` (in `App.tsx`, passed down). While `taggingId === t.id`, render the existing `tag-input` (autoFocus). It commits on Enter, cancels on Escape or blur, then clears `taggingId`.
    - "Add note…" calls `setNotesDialogFor(t)`. "Split…" calls `toggleSplitEditor(t)`. "Split principal…" calls `startEditingPrincipal(t)`. "Apply to a debt…" calls `startApplyingDebtPayment(t)`. "Delete…" calls `setConfirmingDeleteId(t.id)`, which shows the existing inline Cancel/Delete confirm in the actions cell in place of the `⋯`.
  - **Actions cell:** narrow mode keeps the Details button, followed by `<RowMenu label={`Actions for "${t.description}"`} items={…} />`.
  - **Amounts:** `.ledger .amount-col { text-align: right; font-variant-numeric: tabular-nums; }`, applied to both the `th` and the `td`. Do the same in `TransferRow` and `AccountDetailView` tables.
  - **`TransferRow`:** move its Unlink and note buttons into a `RowMenu` (items "Unlink transfer…" and "Add note…"/"Edit note…"), and keep its badge.
- [ ] **Step 5: Tiles → one line.** In `App.tsx`:
  - Delete the `.stats` block at ~3736. In its place render `<LedgerNeedsCategory count={stats.uncategorized} active={filterCategory === UNCATEGORIZED_FILTER} onToggle={() => setFilterCategory((c) => (c === UNCATEGORIZED_FILTER ? "all" : UNCATEGORIZED_FILTER))} />`.
  - Keep the other counts by extending the subtitle: `958 transactions across 11 accounts. 940 sorted automatically, 18 by you.` Use `stats.auto_categorized` and `stats.user_confirmed`. When both are 0, end after "accounts." (This keeps information, per the owner's rule.)
- [ ] **Step 6: Component test.** In `src/LedgerTable.test.tsx` (create it if missing), render `LedgerTable` with two transactions and minimal props (copy the prop object shape from `App.tsx`, using `vi.fn()` handlers), then assert:
  - each row has exactly one `[data-row-menu]`, and neither `+ Add note` nor `+ tag` text appears
  - with one family member there is no `.member-col` and `ledgerColumnCount` matches the header cell count
  - with two members `.member-col` exists
  - opening the menu and choosing "Delete…" shows the inline Delete confirm
  - `td.amount-col` computed `text-align` is `right` (read it from the stylesheet text, as `cssTestUtils.ts` does in other tests)
- [ ] **Step 7:** Run `npm test`, lint and tsc. Expected: PASS.
- [ ] **Step 8: E2E.**
  - In every spec found with the grep above, replace the clicks on the old row buttons with `chooseRowAction(browser, async () => (await row).$("[data-row-menu]"), "Split…")` (or the matching label). Replace stat-tile reads with `[data-needs-category]`.
  - New `e2e/feature268_calm_ledger.mjs`, run on the household demo data path the other ledger specs use, at 1440×1000:
    - count visible rows in the first `innerHeight` of `.ledger-table-scroll` and assert at least 12 (the review measured 7)
    - every amount cell's right edge lines up within 1px
    - the `⋯` menu on the last visible row opens fully inside the window, above the trigger (Review Focus 5)
    - choosing "Add tag…" then typing `trip` and Enter adds a `trip` pill
    - the needs-category line appears after making one transaction uncategorized, and "Review" filters to it
  - Rebuild, then run `npm run e2e -- --spec=smoke,1,4,5,12,23,28,49,57,159,138,163,268` plus any other spec the grep found. Expected: PASS.
- [ ] **Step 9: Commit**: `"Calm the Transactions table: plain cells, ⋯ row menu, right-aligned amounts, one needs-a-category line"`.

---

### Task 5: One budget summary, simpler category rows (s2)

**Files:**
- Modify: `src/BudgetView.tsx` (summary at ~588–628, group tiles at ~641–682, `BudgetRow` at ~240–402), `src/BudgetAndGoals.css`, `src/App.tsx` (pass `amountsHidden` to `BudgetView`)
- Create: `src/budgetSummary.ts`, `src/budgetSummary.test.ts`, `src/BudgetView.test.tsx`
- Modify E2E: grep `e2e/*.mjs` for `data-planned-net|data-actual-net|budget-cap-toggle|cat-row|group-card|Roll over|Warn at 90|Budget group for|Move up` and update those specs. Create `e2e/feature269_budget_rows.mjs`.

**Interfaces:**
- Consumes: `RowMenu` (Task 1).
- Produces: `groupProgressLabel(group: "income" | string, actual: number, budgeted: number): string`. For income it returns `"$2,450.00 of $8,200.00 received"`. For expense groups it returns `"$2,300.00 of $3,607.00 · 64% used"`, or `"… · Over budget"` above 100%. Task 7 adds colour on top of this.
- `BudgetView` gains the prop `amountsHidden: boolean`.

- [ ] **Step 1: Failing tests.**
  - `src/budgetSummary.test.ts`: cover `groupProgressLabel` for income, expense under budget, exactly 100% ("On target"), over, and a zero budget (it must not print "NaN%"; it prints `"$40.00 spent, no budget set"`).
  - `src/BudgetView.test.tsx`: render `BudgetView` with one Fixed group (Mortgage $1,600 of $1,600, Insurance $90 of $120), one Income group and a `netSummary`. Assert:
    - exactly one `[data-budget-summary]` strip containing "Planned spending", "Spent so far", "Left to spend" and "Money left after income", and that `[data-planned-net]` and `[data-actual-net]` still exist inside it
    - no `.group-cards`
    - the Fixed heading contains "$1,690.00 of $1,720.00"
    - the list has column headings "Budget", "Spent" and "Left" exactly once per group
    - rows contain no text "budget", "actual" or "left" after the amounts
    - each row has an `input[aria-label="Budget for Mortgage"]` showing `1600.00`
    - each row has one `[data-row-menu]` whose items include "Roll over unspent" (check), "Warn at 90%" (check), "Move to Flexible", "Move up", "Move down" and "Delete…"
    - no `.cat-row-move-buttons` or `.budget-cap-toggle`
    - with rollover on for a row, a muted "Rolls over" marker is visible
    - with `amountsHidden`, the budget cell renders **no** `<input>` but a `button.amount-editable` (whose text the DOM pass masks), and clicking it shows the input (Review Focus 4)
- [ ] **Step 2:** Run both. Expected: FAIL.
- [ ] **Step 3: Implement `budgetSummary.ts`** using `formatAmount`.
- [ ] **Step 4: Summary strip.** Replace the `budget-net-summary` section and the second `.stats` block with one `<section className="card budget-summary" data-budget-summary aria-label="This month's budget">` holding a 4-cell grid:
  1. Planned spending (`totalBudgeted`)
  2. Spent so far (`totalActual`)
  3. Left to spend (`totalRemaining`)
  4. Money left after income: the big number is `[data-planned-net]` (planned). Under it, a small line `{actualLabel}: <span data-actual-net>…</span>`, keeping `actualLabel`'s three wordings.

  The sub-lines "$X budgeted income − $Y budgeted spending" and "recorded income − recorded spending" stay as `title` text on cell 4 and as one small muted line under the strip. That keeps the information, per the owner's rule. The allocation note (`.budget-allocation`) moves inside the section as its last line.
- [ ] **Step 5: Group headings.**
  - Delete the `.group-cards` block.
  - Each group's `<h2>` becomes a `.budget-group-head` row: the name on the left, `groupProgressLabel(...)` on the right, and under it a full-width 6px `.progress-track` with the `PaceMarker` (expense only). This keeps the progress information from the deleted tile.
  - Then the column-header row `.cat-list-head`, with `<span>Category</span><span aria-hidden="true"></span><span>Budget</span><span>Spent</span><span>Left</span><span className="sr-only">Settings</span>`.
- [ ] **Step 6: Rows.** In `BudgetRow`:
  - Keep the drag handle `⠿`; it's the one visible way to reorder.
  - Remove `.cat-row-move-buttons`, both `budget-cap-toggle` labels, the group `MenuSelect` and the Delete buttons.
  - Add `<RowMenu label={`Settings for ${line.category}`} items={[…]}>` with:
    - `Roll over unspent` (check, only if `!isIncome && rolloverEnabled`)
    - `Warn at 90%` (check, only if `!isIncome && envelopeCapsEnabled`)
    - divider
    - `Move to <Group>` for each other group
    - divider
    - `Move up` (disabled when `!canMoveUp`) and `Move down`; these keep keyboard reordering
    - divider
    - `Delete…` (danger), which sets `confirmingDelete`; the existing inline Cancel/Delete confirm then replaces the menu in `.cat-row-actions`
  - Meta line: keep the sparkline, the alert badge and "rolled in". Add muted markers `Rolls over` when `line.rollover_enabled` and `Warns at 90%` when `line.cap_enabled`, so the settings stay visible at a glance.
  - Budget cell: when `!amountsHidden`, render an always-visible `<input className="budget-amount-input" aria-label={`Budget for ${line.category}`} inputMode="decimal">`. It's controlled by a local draft initialised from `line.budgeted`, re-synced when `line.budgeted` changes, and commits through the existing `commitAmountEdit` on blur or Enter. Escape reverts. When `amountsHidden`, keep today's click-to-edit `span.amount-editable`, rendered as a `<button>` for keyboard use.
  - Spent cell: `formatAmount(line.actual)`. Left cell: `formatAmount(remaining)`, with `neg` when below 0. Drop the trailing words.
  - CSS grid for `.cat-row` and `.cat-list-head`: `grid-template-columns: minmax(180px, 1.4fr) minmax(120px, 2fr) 110px 110px 110px 36px`. The progress bar fills the second column (`.cat-row-bar { width: 100% }`). Right-align the amount columns and use tabular figures. Below 1100px, keep the existing stacked layout: check what `BudgetAndGoals.css` does today at narrow widths and carry it over, so nothing scrolls sideways at 800px.
- [ ] **Step 7:** Pass `amountsHidden` from `App.tsx` (the existing `amountsHidden` at line ~1265). Run `npm test`, lint and tsc. Expected: PASS.
- [ ] **Step 8: E2E.**
  - Update the specs the grep found. Group changes now go through `chooseRowAction(…, "Move to Flexible")`, and the toggles through the check items.
  - New `e2e/feature269_budget_rows.mjs` at 1440×1000:
    - the first category row's top sits less than 420px below `.view-title`'s top (the review measured about 700px of totals)
    - typing `250` into `input[aria-label="Budget for Groceries"]` then Tab saves (reload the tab and the value stays)
    - toggling "Roll over unspent" in the menu shows the "Rolls over" marker
    - with Hide amounts on, the budget cell shows `••••` and no input exists
    - at 800×900, no sideways scroll (`document.querySelector('.main').scrollWidth <= clientWidth + 1`)
  - Rebuild, run the affected specs plus 169. Expected: PASS.
- [ ] **Step 9: Commit**: `"Budget: one summary strip, progress in group headings, column headings, typed budget field, row settings menu"`.

---

### Task 6: Put the Dashboard in a clearer order (s6, Ask the Vault unchanged)

**Files:**
- Modify: `src/dashboardLayout.ts` (`DEFAULT_LAYOUT`, `loadDashboardLayout`), `src/dashboardLayout.test.ts`, `src/DashboardView.tsx` (header ~1200–1308, runway ~656), `src/DashboardCards.css`
- Modify E2E: `feature39_dashboard_customize`, `feature56_save_custom_dashboard_layout`, `feature132_layout_load_race`, plus any spec that reads `.quick-actions`. Create `e2e/feature270_dashboard_order.mjs`.

**Interfaces:**
- Produces: `OLD_DEFAULT_LAYOUT_V1: readonly WidgetId[]`, the pre-1.3.0 default, exported for the migration test. `loadDashboardLayout()` returns the new `DEFAULT_LAYOUT` when the saved list equals `OLD_DEFAULT_LAYOUT_V1` exactly.

- [ ] **Step 1: Failing tests** in `src/dashboardLayout.test.ts`:
  - `DEFAULT_LAYOUT` equals `["stat_net_worth","stat_cash","stat_debt","stat_investments","needs_a_look","safe_to_spend","runway","trend_spending","budget_bills","recent_transactions"]`.
  - With profile UI state holding `OLD_DEFAULT_LAYOUT_V1` (the current order: stats, runway, safe_to_spend, needs_a_look, trend_spending, budget_bills, recent_transactions), `loadDashboardLayout()` resolves to the new `DEFAULT_LAYOUT` (Review Focus 2).
  - A custom saved order (for example, `recent_transactions` first) comes back unchanged.
  - `presetKeyFor(DEFAULT_LAYOUT)` (or whatever the matcher at line ~140 is called) is still `"default"`.

  Mock `getProfileUiState` the way the existing tests in that file do.
- [ ] **Step 2:** Run. Expected: FAIL.
- [ ] **Step 3: Implement** the new `DEFAULT_LAYOUT` and `OLD_DEFAULT_LAYOUT_V1`, and the exact-match migration inside `loadDashboardLayout` after the `"stats"` expansion. Don't write back on load; the next save persists it. Check whether `LAYOUT_PRESETS.bills_focus` and `investor_focus` start with the stats; if they put `runway` before `needs_a_look`, leave them alone, because they are deliberate presets.
- [ ] **Step 4: Header.** In `DashboardView.tsx`:
  - Move the `.quick-actions` buttons into `.page-top > .page-actions`. They are the page's actions, per Task 2's rule.
  - **Leave `<LedgerQaBox …/>` exactly as it is: same component, same size, same place directly under the title row.** Owner decision: Ask the Vault stays big.
  - Replace the `.dashboard-toolbar` contents with `MenuSelect ariaLabel="Layout"`, so the trigger reads "Layout: Default ▾". Its options are the presets, then custom layouts, then `{ value: "__customize__", label: customizeMode ? "Done customizing" : "Customize…" }`. In `onChange`, handle `"__customize__"` by toggling `customizeMode` and never passing it to `onSetLayoutWidgets`. Remove the separate Customize button. "+ Save as…", "Delete" and "+ Add widget…" stay beside the menu exactly as now.
- [ ] **Step 5: Tiles use the full row.** In `DashboardCards.css`, make the stat row container `display: grid; grid-template-columns: repeat(auto-fit, minmax(200px, 1fr)); gap: var(--gap, 14px);` (find the rule by the class the stat row wraps the `STAT_WIDGET_IDS` in). Remove any fixed `width`/`max-width` on `.stat-hero`.
- [ ] **Step 6: Runway ring.** Under the `ProgressRing`, add `<span className="runway-goal">Goal: 6 months</span>`. Give the ring `aria-label={`${monthsOfRunway.toFixed(1)} of a 6-month goal`}`. If `ProgressRing` has no `ariaLabel` prop, add one in `charts.tsx` and render it as `role="img" aria-label` on its `<svg>`.
- [ ] **Step 7:** Run `npm test` (including a `DashboardView` render assertion that `.ledger-qa` (whatever `LedgerQaBox`'s root class is) is the first element after `.page-top`, so the owner's rule is pinned), lint and tsc. Expected: PASS.
- [ ] **Step 8: E2E.**
  - Update 39, 56 and 132: Customize is now chosen from the Layout menu with `chooseMenuOption(trigger, { label: "Customize…" })`.
  - New `e2e/feature270_dashboard_order.mjs`:
    - Ask the Vault's input is displayed and at least 50% of `.page` width (the size didn't shrink)
    - the four stat tiles together span at least 95% of their row
    - in a fresh profile, the To do card (when present) comes before Safe to spend and before Runway in DOM order
    - the ring card contains "Goal: 6 months"
    - the Layout trigger text starts with "Layout:"
  - Rebuild, run `--spec=39,56,132,127,36,42,270,smoke`. Expected: PASS.
- [ ] **Step 9: Commit**: `"Dashboard: money first, To do next, full-width tiles, Layout menu with Customize, labelled ring (Ask the Vault unchanged)"`.

---

### Task 7: Make colours mean one thing (s4)

The rule: **red only for things that need you**: over budget, a bill past due, a negative balance, a transaction that needs a category. Changes are coloured on their own change line; the amount itself stays neutral.

**Files:**
- Create: `src/colourStatus.ts`, `src/colourStatus.test.ts`, `src/budgetAlertText.ts`, `src/budgetAlertText.test.ts`
- Modify: `src/DashboardView.tsx` (debt tile ~597–625, alert banner ~696–706), `src/BudgetView.tsx` (income/net colours, the `100%` badge ~293–305), `src/RecurringView.tsx` (tile tints), `src/Ledger.css`/`DashboardCards.css`/`BudgetAndGoals.css` as needed
- Modify E2E: `feature36` (debt tile colour; it reads `data-stat="debt"`), plus grep for `report-over-budget|report-good|approaching` in `e2e/*.mjs`. Create `e2e/feature271_colour_meaning.mjs`.

**Interfaces:**
- Produces:
  - `incomeTone(pctReceived: number, monthElapsed: number, viewed: "past" | "current" | "future"): "neutral" | "good" | "warn"`. It returns `good` when pct ≥ 99.5. It returns `warn` only when `viewed === "past"`, or when `viewed === "current"`, `monthElapsed >= 0.8` and `pct < 80`. Everything else is `neutral`.
  - `netTone(amount: number, viewed: "past" | "current" | "future"): "neutral" | "bad"`. It returns `bad` only when `amount < 0` and `viewed === "past"`.
  - `describeBudgetAlerts(alerts: { category: string; level: "over" | "warning" }[]): string`. Examples:
    - `"Dining is over its budget"`
    - `"Groceries is close to its budget"`
    - `"Dining and Fuel are over their budgets"`
    - `"Dining is over its budget; Groceries, Fuel and 2 more are close to theirs"`
    - `""` for no alerts

    It names at most 2 per kind, then "and N more". Check what `budgetAlerts` items carry (category and level fields) in `types.ts` and adapt the input type to it.

- [ ] **Step 1: Failing tests** for the three functions, one `it` per example and threshold above, including `incomeTone(30, 0.13, "current") === "neutral"` (the 4 October case from the review) and `netTone(-101.56, "current") === "neutral"`.
- [ ] **Step 2:** Run. Expected: FAIL.
- [ ] **Step 3: Implement** the functions.
- [ ] **Step 4: Apply them.**
  - **Dashboard debt tile:** the value class is always `stat-value` (neutral). Only the `stat-delta` is coloured: `up`/green when the debt shrank, `down`/red when it grew; the classes are already right. Change the tile tint from `tint-red` to `tint-neutral` (add it to `SharedCards.css` with `var(--surface-2)`, if no neutral tint exists). The icon goes from `warning-icon` to `debt-dash` unless debt is growing.
  - **Dashboard banner:** the text is `describeBudgetAlerts(...)`. Keep the click-to-expand details.
  - **Budget:**
    - Income group heading and income rows use `incomeTone`: `neutral` uses `progress-fill neutral` (add a fill with `var(--text-muted)` at 60% opacity, or the existing info token), `warn` uses `warn`, and `good` uses the default fill.
    - Expense groups keep red only for over 100%.
    - "Money left so far" uses `netTone`. Drop `report-over-budget` from the planned-net value unless it is negative *and* the month is past.
    - The alert badge at exactly 100% (`Math.abs(remaining) < 0.005`) becomes a neutral `budget-alert-badge budget-alert-done` reading "Used in full", not orange "100%".
  - **Recurring:** the tiles use neutral tints (Task 12 rebuilds them; for now just change `tint-red`/`tint-blue` to `tint-neutral`).
  - **Audit:** run `rg -n "tint-red|report-over-budget|stat-delta down|--negative|budget-alert-warning" src --glob '!Mobile*' --glob '!mobile*'`. For each hit, check it against the rule and fix any that colours something that doesn't need the user. Put the list of each hit and the decision you made in the commit message.
- [ ] **Step 5:** Run `npm test`, lint and tsc. Expected: PASS.
- [ ] **Step 6: E2E.**
  - Update `feature36` so it expects the debt *value* to be neutral and the *delta* coloured.
  - New `e2e/feature271_colour_meaning.mjs`:
    - on the household demo, the Debt `.stat-value` computed colour equals the Net worth `.stat-value` colour
    - the budget alert banner text contains a category name
    - on the Budget tab in the current month, the income heading progress fill isn't the `--negative` colour (read `getComputedStyle(document.documentElement).getPropertyValue('--negative')` and compare)
  - Rebuild, run the affected specs plus 171. Expected: PASS.
- [ ] **Step 7: Commit**: `"Colours mean one thing: red only for what needs you, neutral debt and early-month income, named budget alerts"`.

---

### Task 8: One date format everywhere (s5)

Lists show "Oct 4" for the current year and "Oct 4, 2025" for other years. Date fields use the same format. Exported files keep ISO; those come from the Rust side and are not touched.

**Files:**
- Modify: `src/format.ts`, `src/format.test.ts`
- Create: `src/DateField.tsx`, `src/DateField.css`, `src/DateField.test.tsx`
- Modify display sites (from `rg -n "\{[a-z.]*\.(date|next_date|valued_on)\}" src --glob '!Mobile*' --glob '!mobile*'`): `AccountDetailView.tsx:234,277`, `AppliedPaymentDetails.tsx:12`, `CashFlowView.tsx:384,394`, `CategorySpendDialog.tsx:39`, `DashboardView.tsx:856,885`, `ImportInboxDialog.tsx:201`, `ImportNeedsChoice.tsx:68`, `ImportReviewDialog.tsx:134`, `InvestmentsView.tsx:643`, `ledgerQa.ts:415`, `LedgerTable.tsx:410`, `Modal.tsx:1070,1794,1807,1877`, `RecategorizedReviewPanel.tsx:44`, `ReportsOverview.tsx:542`, `RecurringView.tsx:715`, `SafeToSpendCard.tsx:93`, `TransferRow.tsx:89`, `PropertyAssets.tsx:200`, `App.tsx:1795,2138`. Also `ReportsOverview.tsx:498,521`, which hand-build "Oct 4, 2026"; switch those to the helper.
- Modify date inputs (`rg -n 'type="date"' src --glob '!Mobile*' --glob '!mobile*'`): `AccountDetailView`, `BucketsView`, `comparisons/AmountEditor`, `LedgerTable`, `Modal`, `MoreFiltersPopover`, `RecurringView`. There are 10 inputs.
- Modify E2E: grep `e2e/*.mjs` for assertions that read *displayed* ISO dates (`getText()` compared to `/\d{4}-\d{2}-\d{2}/` or a literal date). Today 18 files contain ISO literals; most are fixture inputs (leave those). Update only reads of on-screen text. Create `e2e/feature272_dates.mjs`.

**Interfaces:**
- Produces:
  - `formatDisplayDate(iso: string, today: Date = new Date()): string`. It returns `"Oct 4"` when the year matches `today`'s year, `"Oct 4, 2025"` otherwise, and the input unchanged when it isn't `YYYY-MM-DD`.
  - `DateField(props: { value: string; onChange: (iso: string) => void; ariaLabel: string; placeholder?: string; min?: string; max?: string; autoFocus?: boolean; onBlur?: () => void; onKeyDown?: (e: KeyboardEvent<HTMLInputElement>) => void; className?: string; id?: string })`. It wraps a real `<input type="date">`, so E2E `setValue` and keyboard entry keep working. When the input isn't focused, the field shows `formatDisplayDate(value, today)` with the year always included (`"Oct 4, 2026"`), or the `placeholder` (default "Pick a date") when it's empty.

- [ ] **Step 1: Failing tests.**
  - In `format.test.ts`, with `today = new Date(2026, 9, 4)`:
    - `formatDisplayDate("2026-10-04", today) === "Oct 4"`
    - `"2025-12-31"` gives `"Dec 31, 2025"`
    - `"2027-01-02"` gives `"Jan 2, 2027"`
    - `"not a date"` comes back unchanged
    - `""` gives `""`
  - In `DateField.test.tsx`:
    - it renders `input[type=date][aria-label="Date"]` with `value="2026-10-04"`, and the visible `.date-field-text` reads "Oct 4, 2026"
    - firing `change` on the input with `2026-10-05` calls `onChange("2026-10-05")`
    - an empty value shows "Pick a date"
    - after the input gets focus, the wrapper has the class `date-field-editing`
- [ ] **Step 2:** Run. Expected: FAIL.
- [ ] **Step 3: Implement** `formatDisplayDate` in `format.ts`, reusing `MONTH_ABBR`.
- [ ] **Step 4: Implement** `DateField`:
  - Render `<span className="date-field">` around `<input type="date" className="date-field-input" …>` and `<span className="date-field-text" aria-hidden="true">`.
  - CSS: the input sits on top of the text, full size, with `opacity: 0` while not editing (it stays clickable, so the native picker still opens on click). In `.date-field-editing`, the input is `opacity: 1` and the text `visibility: hidden`. Track editing with `onFocus`/`onBlur`. Forward `onBlur` and `onKeyDown`.
  - The box matches the existing text inputs' border, radius and height tokens; `feature88_text_inputs_match` checks this.
- [ ] **Step 5: Replace** every display site with `formatDisplayDate(x)` and every `type="date"` input with `DateField`, passing the same handlers. Keep `className`s the E2E specs use (`row-edit-input`, `date-cell`).
- [ ] **Step 6:** Run `npm test` (fix any snapshot or text expectations that read ISO on screen), lint and tsc. Expected: PASS.
- [ ] **Step 7: E2E.**
  - Update the display-reading assertions.
  - New `e2e/feature272_dates.mjs`:
    - the first ledger row's date cell matches `/^[A-Z][a-z]{2} \d{1,2}(, \d{4})?$/`
    - a date field in Add transaction shows "Oct 4, 2026"-style text (build the expected text from today's date in the spec, never hard-coded; see the `no-hardcoded-dates` guard)
    - `setValue` on the inner input changes the saved transaction date
    - Export CSV still writes `YYYY-MM-DD` (reuse `feature`'s export reading helper; grep `openLedgerExport`)
  - Rebuild and run every spec the grep touched, plus 28, 58, 61, 138, 159, 172. Expected: PASS.
- [ ] **Step 8: Commit**: `"One date format: Oct 4 / Oct 4, 2025 in lists, same in date fields; files keep ISO"`.

---

### Task 9: Let charts use the whole card (s8)

**Files:**
- Modify: `src/charts.tsx` (`SeriesChart` lines ~578–590 already measure; `BarChart` at ~187; `LineChart` at ~344), `src/charts.test.ts`, `src/BarChart.test.tsx`, `src/CashFlowCharts.css`
- Create: `e2e/feature273_chart_width.mjs`

**Interfaces:**
- Produces: `useMeasuredWidth(fallback: number, min = 280): [RefObject<HTMLDivElement | null>, number]`, extracted from `SeriesChart`. `BarChart` and `LineChart` wrap their `<svg>` in `<div ref={ref} className="chart-fit">` and draw at the measured width, with `viewBox` width equal to the measured width. Drop `preserveAspectRatio="xMidYMid meet"` scaling.

- [ ] **Step 1: Failing test** in `BarChart.test.tsx`. Stub `ResizeObserver` (`globalThis.ResizeObserver = class { constructor(cb) { this.cb = cb } observe(el) { this.cb([{ contentRect: { width: 900 } }]) } disconnect() {} }`), render `BarChart` with three groups, and assert the `<svg>` `viewBox` starts with `"0 0 900 "`. Add the same test for `LineChart` in `charts.test.ts` or a new `LineChart.test.tsx`.
- [ ] **Step 2:** Run. Expected: FAIL (the viewBox is 560 wide today).
- [ ] **Step 3: Implement** the hook, and use it in all three charts (SeriesChart switches to the hook too, with no behaviour change). For `BarChart`, cap `barW` at 48px so wide cards don't get absurd bars, and centre each bar in its group. Keep `axisGutter` (bug 3's fix).
- [ ] **Step 4:** In `CashFlowCharts.css` and any card CSS that sets a `max-width` on the chart wrapper, remove the cap so `.chart-fit` is `width: 100%`.
- [ ] **Step 5:** Run `npm test`, lint and tsc. Expected: PASS.
- [ ] **Step 6: E2E** `e2e/feature273_chart_width.mjs`: at 1440×1000, on Cash Flow and on an account's detail page, each chart `<svg>`'s width is at least 90% of its `.card`'s content width. Rebuild, run 173 plus `92,89,93`. Expected: PASS.
- [ ] **Step 7: Commit**: `"Charts draw at their card's full width"`.

---

### Task 10: Make account cards simpler to use (s7)

**Files:**
- Modify: `src/AccountsView.tsx` (card ~128–200), `src/AccountsCards.css`, `src/accountGroups.ts` (add `accountTypeLabel`), `src/accountGroups.test.ts`, the account-type icon mapping (find it with `rg -n "AccountTypeIcon" src/icons`)
- Modify E2E: `feature23`, `53`, `59`, `65`, `92`, `158` (they use `.account-card`). Create `e2e/feature274_account_rows.mjs`.

**Interfaces:**
- Consumes: `RowMenu` (Task 1).
- Produces: `accountTypeLabel(type: string): string`, which capitalises the first letter (`"savings"` → `"Savings"`, `"credit"` → `"Credit card"`, `"loan"` → `"Loan"`, `"investment"` → `"Investment"`, `"property"` → `"Property"`, `"vehicle"` → `"Vehicle"`, `"other"` → `"Other"`) and title-cases any unknown type.

- [ ] **Step 1: Failing tests:**
  - `accountTypeLabel` for each type above
  - in a new `src/AccountsView.test.tsx`, a rendered card has:
    - a single `button.account-card-open` whose accessible name is the account name, and clicking it calls `onOpenDetails(id)`
    - one `[data-row-menu]` with items "Details" and "Edit…"
    - no separate Details or Edit buttons
    - clicking the balance (inline edit) does **not** call `onOpenDetails`
- [ ] **Step 2:** Run. Expected: FAIL.
- [ ] **Step 3: Implement.**
  - The account name becomes `<button type="button" className="account-card-open" onClick={() => onOpenDetails(a.id)}>{a.name}</button>`, with CSS `::after { content: ""; position: absolute; inset: 0 }` so the whole card is the click target. The icon button, balance, limit and `RowMenu` get `position: relative; z-index: 1` so they keep their own clicks.
  - Remove the stacked Details/Edit buttons and add `<RowMenu label={`Actions for ${a.name}`} items={[{ label: "Details", onSelect: () => onOpenDetails(a.id) }, { label: "Edit…", onSelect: () => onEdit(a.id) }]} />`.
  - `detailLine` uses `accountTypeLabel`. Then `rg -n "account_type\}|account_type\[0\]" src --glob '!Mobile*' --glob '!mobile*'` and route every on-screen account type through it.
  - Layout: single column of full-width rows. `.account-cards { display: grid; grid-template-columns: 1fr; }`. The row is icon, name and detail, with the balance right-aligned in tabular numbers and the `⋯` last. This also fixes the half-empty last row.
  - Icons: loan → house glyph, investment → rising-line glyph. Use existing icons in `src/icons` if they exist (search for `house`/`home` and `trend`/`chart-line`). Otherwise add two 24px inline SVGs to the account icon registry in the same style as their neighbours, checked in all three styles.
- [ ] **Step 4:** Run `npm test`, lint and tsc. Expected: PASS.
- [ ] **Step 5: E2E.**
  - Update the six specs. Details now opens by clicking `.account-card-open`, and Edit by `chooseRowAction(..., "Edit…")`.
  - New `feature274_account_rows.mjs`:
    - all account cards in a group have the same left x and width
    - the balances' right edges line up within 1px
    - no card text contains a lowercase account type at word start (`/\b(savings|checking|property|loan)\b/`)
    - clicking a card's name area opens Details
  - Rebuild, run the affected specs plus 174. Expected: PASS.
- [ ] **Step 6: Commit**: `"Accounts: one row per account, whole row opens Details, Edit in ⋯, consistent capitals, clearer icons"`.

---

### Task 11: A friendlier empty Goals page (s9)

**Files:**
- Modify: `src/BucketsView.tsx` (`NewBucketForm` at line 72, empty state at line 429), `src/BudgetAndGoals.css`
- Create: `src/BucketsView.test.tsx` (or extend it if it exists)
- Create: `e2e/feature275_goals_empty.mjs`

**Interfaces:**
- Produces: `NewBucketForm` takes controlled `open: boolean`, `onOpenChange: (open: boolean) => void` and `initialName?: string`. Its own `useState` for `open` goes away. `BucketsView` owns `const [newGoalOpen, setNewGoalOpen] = useState(false)` and `const [newGoalName, setNewGoalName] = useState("")`.

- [ ] **Step 1: Failing test.** Render `BucketsView` with `buckets=[]`. Assert:
  - one `.goals-empty` block containing "Save toward something: a holiday, a new car, an emergency fund."
  - a primary button "Create a goal"
  - three example buttons "Emergency fund", "Holiday" and "New car"
  - clicking "Holiday" opens the form with the name input's value "Holiday"
  - no "+ New goal…" tile while the empty block shows
  - with one bucket, there's no `.goals-empty` and the "+ New goal…" tile is back
- [ ] **Step 2:** Run. Expected: FAIL.
- [ ] **Step 3: Implement.** Lift `open` into props as above. When `buckets.length === 0 && !newGoalOpen`, render the centred block `.goals-empty` (heading "No goals yet", the sentence, the primary button, and a row of three `modal-secondary` example buttons that set the name and open the form). When the form is open, show it inside the same centred block. Remove the old `<p className="empty-state">` line.
- [ ] **Step 4:** Run `npm test`, lint and tsc. Expected: PASS.
- [ ] **Step 5: E2E** `feature275_goals_empty.mjs`: in a fresh profile on Goals, the block is centred (its centre is within 40px of `.page`'s centre). Clicking "Emergency fund" then saving creates a goal named "Emergency fund". Rebuild, run 175 plus `8,84`. Expected: PASS.
- [ ] **Step 6: Commit**: `"Goals: a clear empty page with Create a goal and three examples"`.

---

### Task 12: Recurring: fewer totals, wider names (s10)

**Files:**
- Modify: `src/RecurringView.tsx` (tiles ~546–562, cadence badges at 138, 712 and 791), `src/cadence.ts`, `src/Ledger.css` (the `.recurring-table` rules from bug 1's fix)
- Create: `src/cadence.test.ts`, `src/RecurringView.test.tsx` (or extend it)
- Modify E2E: `feature165` (the recurring table), plus a grep for `Monthly recurring|Annual recurring|monthly<` in `e2e/*.mjs`

**Interfaces:**
- Produces: `cadenceLabel(c: string): string` in `cadence.ts`: `weekly` → "Weekly", `biweekly` → "Every 2 weeks", `monthly` → "Monthly", `annual` → "Yearly", anything else → first letter capitalised.

- [ ] **Step 1: Failing tests:**
  - `cadenceLabel` for all five cases
  - a `RecurringView` render with totals `{ monthly_expense: "3321.00", annual_expense: "39852.00", monthly_income: "2450.00", annual_income: "29400.00" }` shows exactly two `.stat` tiles reading "Bills $3,321.00 a month" (yearly "$39,852.00 a year" in small text) and "Income $2,450.00 a month" (small "$29,400.00 a year · estimate")
  - no lowercase "monthly" badge text
- [ ] **Step 2:** Run. Expected: FAIL.
- [ ] **Step 3: Implement.**
  - Two tiles, each `stat tint-neutral` (see Task 7): `stat-label`, then `stat-value` with " a month", then a small `stat-sub` line for the yearly figure.
  - Every cadence badge uses `cadenceLabel`.
  - In `Ledger.css`, give `.recurring-table` the merchant column `min-width: 14rem` and `white-space: normal; overflow-wrap: anywhere` only below 14rem. Check that at 1440px "Iron Works Gym" is on one line.
  - Apply `cadenceLabel` in the cadence `MenuSelect` options too (lines 221 and 334): `CADENCE_OPTIONS.map((c) => ({ value: c, label: cadenceLabel(c) }))`.
- [ ] **Step 4:** Run `npm test`, lint and tsc. Expected: PASS.
- [ ] **Step 5: E2E.** Update the grep hits. In `feature165`, add: at 1440×1000, every merchant cell's text fits on one line (`scrollHeight <= lineHeight * 1.5`). Rebuild, run 165 plus the affected specs. Expected: PASS.
- [ ] **Step 6: Commit**: `"Recurring: two totals with yearly as small text, capitalised cadence, wider names"`.

---

### Task 13: Money in or out instead of a minus sign (s11)

**Files:**
- Modify: `src/Modal.tsx` (`NewTransactionDialog`, lines 436–560)
- Create: `src/transactionDirection.ts`, `src/transactionDirection.test.ts`, extend or create `src/NewTransactionDialog.test.tsx`
- Modify E2E: `feature28`, `53`, `58`, `84`, `91` (they find the amount by the placeholder "Negative = money out"). Create `e2e/feature276_money_in_out.mjs`.

**Interfaces:**
- Produces:
  - `type Direction = "out" | "in"`
  - `signedAmount(typed: string, direction: Direction): string | null`. It trims the input and strips one leading `-`, `−` or `+` (Review Focus 3: the switch decides the sign, never the typed sign). It returns `null` when the rest isn't a valid decimal (`isValidDecimalString`) or equals 0. Otherwise it returns `"-50.00"`-style text for out and `"50.00"` for in, keeping the typed precision (`"-12.5"` stays `"-12.5"`; don't reformat).
  - `directionLabels(accountType: string | undefined): [out: string, in: string]` returns `["Charge", "Payment"]` for `credit` and `loan`, and `["Money out", "Money in"]` otherwise.

- [ ] **Step 1: Failing tests:**

```ts
import { describe, expect, it } from "vitest";
import { directionLabels, signedAmount } from "./transactionDirection";
describe("signedAmount", () => {
  it("makes money out negative and money in positive", () => {
    expect(signedAmount("50", "out")).toBe("-50");
    expect(signedAmount("50", "in")).toBe("50");
  });
  it("ignores a typed sign: the switch decides", () => {
    expect(signedAmount("-50", "out")).toBe("-50");
    expect(signedAmount("-50", "in")).toBe("50");
    expect(signedAmount("+12.5", "out")).toBe("-12.5");
    expect(signedAmount(" −7.25 ", "out")).toBe("-7.25");
  });
  it("refuses zero and things that aren't numbers", () => {
    expect(signedAmount("0", "out")).toBeNull();
    expect(signedAmount("0.00", "in")).toBeNull();
    expect(signedAmount("", "out")).toBeNull();
    expect(signedAmount("12abc", "out")).toBeNull();
    expect(signedAmount("--5", "out")).toBeNull();
  });
});
describe("directionLabels", () => {
  it("says Charge / Payment for cards and loans", () => {
    expect(directionLabels("credit")).toEqual(["Charge", "Payment"]);
    expect(directionLabels("loan")).toEqual(["Charge", "Payment"]);
    expect(directionLabels("checking")).toEqual(["Money out", "Money in"]);
    expect(directionLabels(undefined)).toEqual(["Money out", "Money in"]);
  });
});
```

  Dialog test:
  - the dialog shows a `role="radiogroup"` named "Direction" with "Money out" checked by default
  - choosing a credit account relabels it to "Charge | Payment"
  - typing `50` with Money out and saving calls `onCreate` with amount `"-50"`
  - typing `0` shows the error "Enter an amount other than zero." and doesn't call `onCreate`
  - the amount input has `data-amount-input` and placeholder `0.00`
- [ ] **Step 2:** Run. Expected: FAIL.
- [ ] **Step 3: Implement** `transactionDirection.ts`. In `NewTransactionDialog`:
  - Add `const [direction, setDirection] = useState<Direction>("out")`.
  - Render a two-button segmented `role="radiogroup" aria-label="Direction"` (buttons `role="radio" aria-checked`) above the Amount field, labelled from `directionLabels(selectedAccount?.account_type)`.
  - Amount `placeholder="0.00"`, `inputMode="decimal"`, `data-amount-input`.
  - Validation uses `signedAmount`: the empty error stays "Enter an amount.", a non-number gives "That doesn't look like a number.", and zero gives "Enter an amount other than zero."
  - Pass `signedAmount(amount, direction)` to the existing create call in place of `amountTrimmed`.
  - Keep the backdated-transaction warning logic (`feature58`) working; it reads the date, not the sign.
- [ ] **Step 4:** Run `npm test`, lint and tsc. Expected: PASS.
- [ ] **Step 5: E2E.**
  - Update the five specs. Use `[data-amount-input]`, type the absolute value, and click "Money in" where the old test typed a positive number. Expected balances must stay exactly as before.
  - New `feature276_money_in_out.mjs`: add `-25` with Money out, and the ledger shows −$25.00. Add `25` with Money in, and it shows $25.00. On a credit card account the switch reads Charge | Payment.
  - Rebuild, run `--spec=28,53,58,84,91,276,smoke`. Expected: PASS.
- [ ] **Step 6: Commit**: `"Add transaction: Money out / Money in switch (Charge / Payment on cards and loans) instead of a minus sign"`.

---

### Task 14: Show the styles instead of describing them (s14), plus Light/Dark in Settings

**Files:**
- Create: `tools/capture-style-previews.mjs` (WebdriverIO script built on `e2e/harness.mjs`), `src/assets/style-previews/{transparent,futuristic,retro}-{light,dark}.webp`
- Modify: `src/SettingsView.tsx` (`THEME_STYLE_OPTIONS` ~443, `AppearanceSection` ~470, props to receive `theme` and `onSetTheme`), the relevant Settings CSS, `src/App.tsx` (pass `theme`/`setTheme` into `SettingsView`)
- Modify: `src/SettingsView.test.tsx`
- Modify E2E: `feature38`, `142`, `156`, `159` (they use `theme-style` radios)

**Interfaces:**
- Consumes: `theme`/`setTheme` from `App.tsx`. The Settings Light/Dark/System control reuses the `SidebarControls` theme group markup by exporting `ThemeSwitch({ theme, onSetTheme })` from `SidebarControls.tsx`.

- [ ] **Step 1: Failing test** in `SettingsView.test.tsx`. The Appearance card shows:
  - three `label.style-preview-tile` elements, each containing an `<img>` with alt "Default style preview", "Futuristic style preview" or "Retro style preview", the `input[type=radio][name=theme-style]` (kept, so E2E and keyboard work), and a description of at most 90 characters
  - no description containing "header"
  - a `ThemeSwitch` group named "Theme" with Light, Dark and System
  - each `img` `src` ends with `-dark.webp` when the resolved theme is dark, and `-light.webp` when it's light (pass a `resolvedTheme` prop; App already knows the resolved theme for `data-theme`)
- [ ] **Step 2:** Run. Expected: FAIL.
- [ ] **Step 3: Capture the images.** `tools/capture-style-previews.mjs`:
  - launches with `launchApp()`, loads the household demo as `npm run demo:household` does (reuse its seeding path), and sets the window to 1280×800
  - for each style × light/dark, selects it, opens the Dashboard, waits for `waitForDataLoaded`, and saves `browser.saveScreenshot` to the scratch dir
  - converts each to WebP at 480×300 (cover-crop the top-left 1280×800 region) using `sharp` if it's in `node_modules`. Otherwise it uses the Edge canvas inside the app via `browser.execute` with a data URL and `canvas.toDataURL("image/webp", 0.8)`. Check `node_modules/sharp` first; don't add a dependency.

  Each file must be at most 60 KB. Commit the six images.
- [ ] **Step 4: Implement.**
  - Descriptions, one line each:
    - Default: "Clean and soft, with see-through panels."
    - Futuristic: "Neon colours on dark blue. Pick the glow colour below."
    - Retro: "Classic grey desktop look with square corners."
  - Tiles go in a 3-column grid (1 column below 700px). The radio is visually hidden inside the label, the tile is outlined with `var(--accent)` when checked, and focus-visible shows the focus ring.
  - Add `ThemeSwitch` at the top of the card, labelled "Light or dark".
  - Remove the "Follows the header's Light/Dark/System toggle" sentences; the header is gone.
- [ ] **Step 5:** Run `npm test` (`plainLanguage` included), lint and tsc. Expected: PASS.
- [ ] **Step 6: E2E.** Update the four specs if their radio selectors relied on `.feature-toggle-row`. In `feature38`, add: choosing Dark in Settings → Appearance switches the theme, and the sidebar group shows Dark active. Rebuild, run `38,142,153,156,159`. Expected: PASS.
- [ ] **Step 7: Commit**: `"Settings: picture previews of each style, and Light/Dark/System in Appearance"`.

---

### Task 15: Break Help into short, findable pieces (s12), describing the new screens

This task is last so Help describes the finished UI.

**Files:**
- Modify: `src/HelpView.tsx` (`TAB_TOUR_ENTRIES` from line 55, render from ~1497), `src/HelpView.test.tsx`, `src/App.tsx` (help target state)
- Create: `src/HelpLink.tsx`
- Modify: every view's `page-top` title (Dashboard, Transactions (in `App.tsx`), Accounts, Budget, Recurring, Goals, Cash Flow, Reports, Investments, Household, Settings)
- Modify: `README.md` (the Help comment says keep it in sync)
- Modify E2E: `feature96_accumulation_help` (`.tour-list`). Create `e2e/feature277_help_sections.mjs`.

**Interfaces:**
- Produces:
  - `type TabHelp = { tab: Tab; title: string; summary: string; howTo: { question: string; steps: ReactNode[] }[]; tags: string[] }`
  - `export const TAB_HELP: TabHelp[]`
  - `HelpView({ focusTab }: { focusTab?: Tab | null })` opens the matching `<details id={`help-${tab}`}>` and scrolls it into view
  - `HelpLink({ tab, onOpen }: { tab: Tab; onOpen: (tab: Tab) => void })` renders `<button type="button" className="help-link" aria-label={`Help for ${title}`}>?</button>`
  - `App` gets `const [helpFocus, setHelpFocus] = useState<Tab | null>(null)` and `openHelpFor(tab) { setHelpFocus(tab); setActiveTab("help"); }`

- [ ] **Step 1: Failing tests** in `HelpView.test.tsx` (keep every existing test passing):
  - there is one `details.help-tab` per tab in `TAB_HELP`, each with a `summary` element holding the title, and the first paragraph inside is the one-sentence `summary` (at most 160 characters, ending in ".")
  - each has at least one "How do I…" question with an `<ol>` of steps
  - searching "budget" opens (sets the `open` attribute on) the Budget section and hides the unrelated ones
  - `render(<HelpView focusTab="budget" />)` opens `#help-budget`
  - the Help text mentions the new locations, by asserting these strings exist:
    - "Hide amounts" with "bottom of the sidebar"
    - "Light, Dark or System" with "Settings → Appearance"
    - "⋯" with "Split" (row menu)
    - "Money out" and "Money in"
    - "Layout" with "Customize"
    - "Show names"
  - nothing says "top bar", "header's" or "Negative = money out"
- [ ] **Step 2:** Run. Expected: FAIL.
- [ ] **Step 3: Rewrite** `TAB_TOUR_ENTRIES` into `TAB_HELP`. Turn every long paragraph into a one-sentence summary plus short "How do I…" entries of 2–5 numbered steps each. Carry over every fact and every search tag from the old entries. The owner's rule is to keep information; check each old paragraph's facts against the new entries before deleting it. Describe the **new** UI from Tasks 2–14. Keep Getting started, Importing, Bulk setup, Exporting and FAQ sections as they are, apart from wording that references moved controls. Grep the whole file for "top bar", "header", "Customize", "Negative", "+ tag", "+ Add note", "Details and Edit", "Monthly recurring" and "sinking", and fix each.
- [ ] **Step 4: Add** a `HelpLink` beside each view's `<h1 className="view-title">` (inside the same flex row), wired through props `onOpenHelp` from `App.tsx`. Help itself gets none.
- [ ] **Step 5: README.md.** Update the sections describing the top bar, the theme toggle, adding a transaction, the Budget rows, the Transactions row actions and the Dashboard layout to match.
- [ ] **Step 6:** Run `npm test`, lint and tsc. Expected: PASS.
- [ ] **Step 7: E2E.** Update `feature96` (the tour is now `details.help-tab`). New `feature277_help_sections.mjs`: on Budget, clicking `[aria-label="Help for Budget"]` opens Help with `#help-budget[open]` in the viewport, and typing "split" in the search box opens the Transactions section. Rebuild, run `96,177,smoke`. Expected: PASS.
- [ ] **Step 8: Commit**: `"Help: one short section per tab with How do I steps, ? links from every page, updated for the new screens"`.

---

### Task 16: Release-level verification, UAT page, hand-off

**Files:**
- Create: `E:\misc\Programming\Claude\Implementations\vault-spend-1.3.0-ui-pass-uat\` (page, shots, capture script)
- Modify: `E:\misc\Programming\Claude\vault-spend-context.md`

- [ ] **Step 1: Full gates** in the worktree:
  - `npm test`, `npm run lint` and `npx tsc --noEmit`, all clean
  - `npx tauri build --debug --no-bundle`
  - **full** `npm run e2e`: expect every spec, 164 existing plus 166–177, to pass with no retries reported. Any failure is investigated to its cause (see `e2e/README.md` "Failures that only happen in parallel runs") and fixed, never re-run away.

  Rust is unchanged, so `cargo test` isn't required; confirm with `git diff 1.3.0 --stat -- core src-tauri`, which must be empty.
- [ ] **Step 2: Screenshot sweep.** Rerun the UI review capture script `E:\misc\Programming\Claude\Implementations\vault-spend-ui-review-2026-10-04\capture.mjs` against the new build. It covers every tab, 3 styles × light/dark, at 1440 and 800 on the household demo. Look at every shot. Fix anything broken (overlaps, clipping, unreadable colours, sideways scroll) in the owning task's files, with a test, before going on.
- [ ] **Step 3: Whole-branch review.** Use superpowers:requesting-code-review on `1.3.0..1.3.0-ui-pass` and fix every finding, including minors.
- [ ] **Step 4: Fast-forward `1.3.0`.** In the main checkout, the mobile work is uncommitted and these commits don't touch its files (check `git diff --name-only 1.3.0 1.3.0-ui-pass` against `git status --short`; there must be no overlap). Then run:

```powershell
git -C "E:\misc\Programming\Budgeting App" merge --ff-only 1.3.0-ui-pass
```

  If a file overlaps, stop and ask the owner. Then copy the built exe into `target\debug` for `npm run demo:household`. Remove the worktree and branch (`git worktree remove`, `git branch -d 1.3.0-ui-pass`). **Do not push**; ask the owner.
- [ ] **Step 5: UAT page.** Follow the owner's UAT format in `E:\misc\Programming\Claude\uat-template\`: a published page with screenshots, Do → Expect checks, Pass/Fail marks and sign-off, stored in the artifact db as `uat/phase-130-ui`. Write one item per suggestion (s1–s14), plus one item confirming Ask the Vault is unchanged and one confirming Cash Flow and Reports are unchanged (s15 rejected). Each item gets 2–4 checks on the household demo. Publish it and give the owner the link.
- [ ] **Step 6: Context file.** Update `vault-spend-context.md`: the branch tip, what shipped, the test numbers, the UAT link, and that the release runbook is still pending the owner's go.

---

## Self-review notes (done while writing)

- **Coverage:** s1 → Task 4, s2 → 5, s3 → 2, s4 → 7 (plus the needs-a-category red in 4), s5 → 8, s6 → 6, s7 → 10, s8 → 9, s9 → 11, s10 → 12, s11 → 13, s12 → 15, s13 → 3, s14 → 14. s15 has no task by owner decision. The "Ask the Vault unchanged" rule is pinned by tests in Task 6 (Step 7 and Step 8).
- **Review error found and handled:** s3 said the theme switch is "already in Settings". It isn't; Settings only picks the style. Task 14 adds Light/Dark/System to Settings, so the switch has a home besides the sidebar.
- **Information kept, per the owner's rule:**
  - Transactions counts move into the subtitle (Task 4).
  - Budget net summary sub-lines become `title` text plus one muted line, and group progress moves into the headings (Task 5).
  - Budget row settings show as markers (Task 5).
  - Recurring yearly totals become small text (Task 12).
  - Every Help fact is carried over (Task 15).
- **Names used across tasks:** `RowMenu`/`RowMenuItem`/`chooseRowAction` (Tasks 1, 4, 5, 10), `SidebarControls`/`ThemeSwitch` (Tasks 2, 3, 14), `tint-neutral` (Tasks 7, 12), `formatDisplayDate`/`DateField` (Task 8), `amountsHidden` (Task 5).
