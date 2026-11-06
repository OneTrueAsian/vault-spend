// @vitest-environment jsdom
import fs from "node:fs";
import path from "node:path";
import { beforeEach, describe, expect, it } from "vitest";
import { installMenuRecorder, markMenuSite, menuSnapshot, profileSummary, reportMenuFailure } from "./profileMenuDiagnostics.mjs";

const NAME = "Zebra Household Secret";

function page({ withLock = true } = {}) {
  document.body.innerHTML = `
    <div class="profile-switcher"><button class="profile-switcher-toggle" aria-expanded="false">${NAME}</button></div>
    <div class="modal-panel" role="dialog" aria-modal="true" tabindex="-1"><h2>Add rule</h2><input id="draft" value="my private draft"></div>`;
  return { toggle: document.querySelector(".profile-switcher-toggle"), withLock };
}
function openMenu(withLock) {
  const panel = document.createElement("div");
  panel.className = "profile-switcher-panel";
  panel.innerHTML = `<button class="profile-switcher-option">${NAME} (current)</button><button class="profile-switcher-manage">Manage profiles</button>` +
    (withLock ? '<button class="profile-switcher-manage" data-profile-switcher-lock>Lock profile</button>' : "");
  document.querySelector(".profile-switcher").append(panel);
  return panel;
}
const tick = () => new Promise(resolve => setTimeout(resolve, 0));

describe("profile menu diagnostics (spec 286)", () => {
  beforeEach(() => { delete window.__menuLog; });

  it("records the open and close of the menu, the focus moves around it and which site is being opened", async () => {
    const { toggle } = page();
    installMenuRecorder();
    installMenuRecorder(); // idempotent: one recorder only
    markMenuSite("loop transparent/light");
    toggle.setAttribute("aria-expanded", "true");
    const panel = openMenu(true);
    document.querySelector("#draft").focus();
    panel.remove();
    toggle.setAttribute("aria-expanded", "false");
    await tick();
    const kinds = window.__menuLog.map(e => e.kind);
    expect(kinds.filter(k => k === "recorder-installed")).toHaveLength(1);
    expect(window.__menuLog.find(e => e.kind === "site").site).toBe("loop transparent/light");
    expect(kinds).toEqual(expect.arrayContaining(["aria-expanded", "panel-added", "panel-removed", "focusin"]));
    const focus = window.__menuLog.find(e => e.kind === "focusin");
    expect(focus.target).toMatchObject({ tag: "input", inDialog: true, inSwitcher: false });
    expect(window.__menuLog.filter(e => e.kind === "aria-expanded").map(e => e.from)).toEqual(["false", "true"]); // the value each change replaced
  });

  it("records the kind of key and the pointer target, never the key that was typed", () => {
    page(); installMenuRecorder();
    document.dispatchEvent(new KeyboardEvent("keydown", { key: "s", bubbles: true }));
    document.dispatchEvent(new KeyboardEvent("keydown", { key: "Escape", bubbles: true }));
    expect(window.__menuLog.filter(e => e.kind === "keydown").map(e => e.key)).toEqual(["other", "Escape"]);
  });

  it("snapshots the menu entries, the dialogs and the focused element, with no names or typed text", () => {
    const { toggle } = page(); installMenuRecorder();
    toggle.setAttribute("aria-expanded", "true"); openMenu(false);
    document.querySelector("#draft").focus();
    const snap = menuSnapshot();
    expect(snap).toMatchObject({ toggleExists: true, ariaExpanded: "true", panelExists: true, panelEntries: ["option", "manage"] });
    expect(snap.dialogs).toEqual([expect.objectContaining({ role: "dialog", heading: "Add rule", containsFocus: true })]);
    expect(snap.activeElement).toMatchObject({ tag: "input", id: "draft", inDialog: true });
    expect(typeof snap.documentHasFocus).toBe("boolean");
    const text = JSON.stringify(snap);
    expect(text).not.toContain(NAME); expect(text).not.toContain("my private draft");
  });

  it("shows Lock profile as a menu entry only when the menu really has it", () => {
    page(); openMenu(true);
    expect(menuSnapshot().panelEntries).toEqual(["option", "manage", "lock"]);
  });

  it("summarises the profiles as counts and flags, without names or ids", async () => {
    const profiles = [{ id: "default", name: NAME, is_active: false, is_password_protected: false }, { id: "zebra-household", name: "Other", is_active: true, is_password_protected: true }];
    const summary = await profileSummary(async () => ({ ok: profiles }), {});
    expect(summary).toEqual({ count: 2, activeIndex: 1, activeIsDefault: false, activeProtected: true, protectedCount: 1 });
    expect(JSON.stringify(summary)).not.toContain("zebra");
    expect(await profileSummary(async () => ({ error: "nope" }), {})).toEqual({ error: "list_profiles did not return a list" });
  });

  it("prints one DIAGNOSTIC line with the site and step, and still reports when the capture itself fails", async () => {
    const lines = [];
    const browser = { execute: async fn => fn === menuSnapshot ? { toggleExists: true, panelExists: false } : undefined };
    await reportMenuFailure(browser, async () => ({ ok: [{ id: "default", name: NAME, is_active: true, is_password_protected: true }] }), "after unlock", "waiting for the Lock profile entry", l => lines.push(l));
    expect(lines).toHaveLength(1);
    expect(lines[0]).toMatch(/^DIAGNOSTIC profile-menu site=after unlock step=waiting for the Lock profile entry \{/);
    expect(lines[0]).toContain('"activeProtected":true'); expect(lines[0]).not.toContain(NAME);
    const broken = [];
    await reportMenuFailure({ execute: async () => { throw new Error("session gone"); } }, async () => { throw new Error("no ipc"); }, "x", "y", l => broken.push(l));
    expect(broken[0]).toContain("snapshot failed: Error: session gone"); expect(broken[0]).toContain("profile summary failed: Error: no ipc");
  });
});

describe("spec 286 uses the diagnostics without changing its waits or clicks", () => {
  const spec = fs.readFileSync(path.join(process.cwd(), "e2e", "feature286_manual_lock_confirmation.mjs"), "utf8");
  it("names every menu opening and keeps the 10 second waits and single clicks", () => {
    const calls = [...spec.matchAll(/lockViaProfileMenu\(b, ([^)]*)\)/g)].map(m => m[1]).filter(c => c !== "site"); // the definition is not an opening
    expect(calls).toHaveLength(3); // the loop runs it for 3 palettes x 2 themes, then once more each before and after unlock = 8 openings
    expect(calls.every(c => c.length > 0)).toBe(true);
    expect(spec.match(/timeout: 10000, timeoutMsg/g)).toHaveLength(2);
    expect(spec.match(/b\.execute\(el => el\.click\(\), (toggle|lock)\)/g)).toHaveLength(2);
    expect(spec).not.toMatch(/for \(let attempt|while \(/);
  });
});
