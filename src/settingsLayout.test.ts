import { describe, expect, it } from "vitest";
import fs from "node:fs";
import path from "node:path";

// jsdom does no layout, so the layout rules are pinned in the stylesheet text (as frameLayout.test.ts does for copy);
// the real geometry is checked by e2e/feature366_settings_layout_scrolling.mjs in the compiled app.
const read = (file: string) => fs.readFileSync(path.join(__dirname, file), "utf8");
const css = read("SettingsPage.css");
const escapeRegExp = (text: string) => text.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
const rule = (selector: string) => {
  const match = new RegExp(`(?:^|\\n)${escapeRegExp(selector)}\\s*\\{([^}]*)\\}`).exec(css);
  if (!match) throw new Error(`no rule for ${selector}`);
  return match[1];
};

describe("Settings layout: fixed header and list, one scrolling content area", () => {
  it("fills the window height, so only the content area can scroll", () => {
    expect(rule(".main:has(.page-settings)")).toMatch(/overflow:\s*hidden/);
    const page = rule(".page.page-settings");
    expect(page).toMatch(/height:\s*100%/);
    expect(page).toMatch(/max-width:\s*none/);
    expect(rule(".settings-page")).toMatch(/flex:\s*1/);
    expect(rule(".settings-body")).toMatch(/flex:\s*1/);
    expect(rule(".settings-body")).toMatch(/min-height:\s*0/);
  });

  it("scrolls the content on its own and keeps the list in place", () => {
    expect(rule(".settings-content")).toMatch(/overflow-y:\s*auto/);
    expect(rule(".settings-content")).toMatch(/scroll-padding-block:/);
    expect(rule(".settings-nav")).not.toMatch(/position:\s*sticky/);
    expect(rule(".settings-nav")).toMatch(/overflow-y:\s*auto/); // reachable in a short window or at a large text size
  });

  it("uses the window width: 24 to 32px margins and a 190 to 210px list", () => {
    const pad = /padding:\s*(\d+)px\s+(\d+)px/.exec(rule(".page.page-settings"));
    expect(pad).not.toBeNull();
    expect(Number(pad![2])).toBeGreaterThanOrEqual(24);
    expect(Number(pad![2])).toBeLessThanOrEqual(32);
    const nav = /--settings-nav:\s*(\d+)px/.exec(css);
    expect(Number(nav![1])).toBeGreaterThanOrEqual(190);
    expect(Number(nav![1])).toBeLessThanOrEqual(210);
    expect(rule(".settings-body")).toMatch(/grid-template-columns:\s*var\(--settings-nav\)/);
  });

  it("is one frame: the list plus a 1,060px content column, left aligned, with window space beyond it left empty", () => {
    expect(/--settings-measure:\s*(\d+)px/.exec(css)![1]).toBe("1060");
    const frame = rule(".settings-page");
    expect(frame).toMatch(/max-width:\s*calc\(var\(--settings-nav\) \+ var\(--settings-gap\) \+ var\(--settings-measure\)\)/);
    expect(frame).not.toMatch(/margin(-inline|-left|-right)?:\s*[^;]*auto/);
  });

  it("gives no card, pair or table a width of its own: all of them fill the one column", () => {
    expect(css).not.toMatch(/\.card\[data-backups\]/);
    expect(css).not.toMatch(/\.settings-content[^{]*\.card[^{]*\{[^}]*max-width/);
    expect(css).not.toMatch(/\.settings-pair[^{]*\{[^}]*max-width/);
  });

  it("ends the search box where the cards end, past the scroller's inset and scrollbar", () => {
    expect(rule(".settings-search")).toMatch(/margin-right:\s*calc\(var\(--settings-inset\) \+ var\(--settings-scrollbar, 0px\)\)/);
    expect(rule(".settings-content")).toMatch(/padding:\s*0 var\(--settings-inset\) 48px 0/);
  });

  it("ends the category selector where the cards end, like the search box, and keeps tabs their own width in a short window", () => {
    expect(rule(".settings-select")).toMatch(/margin-right:\s*calc\(var\(--settings-inset\) \+ var\(--settings-scrollbar, 0px\)\)/);
    expect(css).toMatch(/@media \(max-height: \d+px\)[\s\S]*\.settings-nav \.settings-nav-item\s*\{[^}]*width:\s*auto/);
  });

  it("leaves room between the password actions and the automatic locking settings under them", () => {
    expect(rule(".settings-actions + [data-auto-lock-settings]")).toMatch(/margin-top:\s*\d+px/);
  });

  it("keeps the stars in one column just past the text, the scrollbar space reserved, and pairs as tall as their taller card", () => {
    expect(rule(".settings-content .setting-row .feature-toggle-text")).toMatch(/max-width:\s*none/);
    expect(rule(".setting-row > .feature-toggle-row")).toMatch(/max-width:\s*\d+rem/);
    expect(rule(".settings-content")).toMatch(/scrollbar-gutter:\s*stable/);
    expect(css).toMatch(/@container \(min-width: 1160px\)\s*\{\s*\.settings-pair\s*\{(?![^}]*align-items:\s*start)/);
  });

  it("shows the copy result under its button, and highlights search matches in the theme's own colours", () => {
    expect(rule(".path-copy .settings-feedback")).toMatch(/position:\s*absolute/);
    expect(rule(".settings-results mark")).toMatch(/background:\s*var\(--accent-soft\)/);
    expect(rule(".settings-results mark")).not.toMatch(/#|yellow/);
  });

  it("keeps the outer page from ever scrolling, and contains absolutely positioned text inside the scroller", () => {
    expect(rule(".main:has(.page-settings)")).toMatch(/overflow:\s*clip/);
    expect(rule(".settings-content")).toMatch(/position:\s*relative/);
  });

  it("uses one gap between cards and inside a pair: no extra bottom margin on top of the flex gap", () => {
    expect(rule(".settings-content .card,\n.settings-content .settings-pair")).toMatch(/margin-bottom:\s*0/);
    expect(rule(".settings-pair")).toMatch(/gap:\s*14px;/);
  });

  it("uses one Settings action row: left aligned, wrapping, and not the modal footer rule", () => {
    const row = rule(".settings-actions");
    expect(row).toMatch(/justify-content:\s*flex-start/);
    expect(row).toMatch(/flex-wrap:\s*wrap/);
    expect(css).not.toMatch(/(^|\n)\.modal-actions\s*\{/);
  });

  it("keeps description lines short however wide the cards are", () => {
    expect(css).toMatch(/\.settings-content \.modal-message-secondary[^{]*\{[^}]*max-width:\s*7\dch/);
  });

  it("becomes tabs in a narrow window, a category selector in a very narrow one, and flows normally in a short one", () => {
    expect(css).toMatch(/@container \(max-width: 760px\)/);
    expect(css).toMatch(/@container \(max-width: 560px\)[\s\S]*\.settings-select\s*\{[^}]*display:\s*block/);
    expect(rule('.settings-page[data-nav="select"] .settings-select')).toMatch(/display:\s*block/);
    expect(rule('.settings-page[data-nav="select"] .settings-nav')).toMatch(/display:\s*none/);
    expect(css).toMatch(/@media \(max-height: \d+px\)[\s\S]*\.page\.page-settings/);
  });

  it("places short cards side by side only when the content is wide", () => {
    expect(rule(".settings-pair")).toMatch(/grid-template-columns:\s*minmax\(0, 1fr\)\s*;/);
    expect(css).toMatch(/@container \(min-width: 11\d\dpx\)[\s\S]*\.settings-pair\s*\{[^}]*repeat\(2/);
  });

  it("marks the Settings page so the app shell stops scrolling it", () => {
    expect(read("App.tsx")).toMatch(/activeTab === "settings"[^\n]*page page-settings/);
    expect(read("SettingsView.tsx")).toContain('className="reports-view settings-view"');
  });
});
