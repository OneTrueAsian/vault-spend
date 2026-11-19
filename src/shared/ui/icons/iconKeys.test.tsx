// @vitest-environment jsdom
import { Receipt } from "lucide-react";
import { act } from "react";
import { createRoot } from "react-dom/client";
import { describe, expect, it } from "vitest";
import { ACCOUNT_ICON_OPTIONS, iconForAccount, isAccountIconKey } from "./accountIcons";
import { BUCKET_ICON_OPTIONS, iconForBucket, isBucketIconKey } from "./bucketIcons";
import { iconForBudgetGroup } from "./budgetGroupIcons";
import { CATEGORY_ICON_OPTIONS, iconForCategory, isCategoryIconKey } from "./categoryIcons";
import { IconEntryGlyph } from "./iconEntry";
import { PROFILE_ICON_OPTIONS, iconForProfile, isProfileIconKey } from "./profileIcons";

(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

const INHERITED = ["constructor", "toString", "__proto__", "hasOwnProperty"];

describe("icon key guards reject inherited Object keys", () => {
  const cases: [string, (k: string) => boolean, string][] = [
    ["isAccountIconKey", isAccountIconKey, ACCOUNT_ICON_OPTIONS[0].key],
    ["isBucketIconKey", isBucketIconKey, BUCKET_ICON_OPTIONS[0].key],
    ["isCategoryIconKey", isCategoryIconKey, CATEGORY_ICON_OPTIONS[0].key],
    ["isProfileIconKey", isProfileIconKey, PROFILE_ICON_OPTIONS[0].key],
  ];
  for (const [name, guard, real] of cases) {
    it(`${name} rejects inherited keys and accepts a real one`, () => {
      for (const k of INHERITED) expect(guard(k)).toBe(false);
      expect(guard(real)).toBe(true);
    });
  }
});

describe("every picker key fits the native icon key policy", () => {
  const policy = /^[a-z0-9][a-z0-9-]{0,63}$/;
  const lists: [string, { key: string }[]][] = [
    ["account", ACCOUNT_ICON_OPTIONS],
    ["bucket", BUCKET_ICON_OPTIONS],
    ["category", CATEGORY_ICON_OPTIONS],
    ["profile", PROFILE_ICON_OPTIONS],
  ];
  for (const [name, options] of lists) {
    it(`${name} keys`, () => {
      expect(options.length).toBeGreaterThan(0);
      for (const o of options) expect(o.key).toMatch(policy);
    });
  }
});

describe("icon lookups fall back for inherited keys", () => {
  it("account", () => expect(iconForAccount("checking", "constructor")).toBe(iconForAccount("checking", null)));
  it("bucket", () => expect(iconForBucket("Rent", "constructor")).toBe(iconForBucket("Rent", null)));
  it("category", () => expect(iconForCategory("Food", "constructor")).toBe(iconForCategory("Food", null)));
  it("profile", () => expect(iconForProfile("constructor")).toBe(iconForProfile(null)));
  it("budget group", () => expect(iconForBudgetGroup("constructor")).toBe(Receipt));
});

describe("IconEntryGlyph", () => {
  function render(entry: unknown) {
    const host = document.createElement("div");
    const root = createRoot(host);
    act(() => root.render(<IconEntryGlyph entry={entry as never} />));
    const html = host.innerHTML;
    act(() => root.unmount());
    return html;
  }

  it("still renders an svg for a real lucide entry", () => {
    expect(render({ kind: "lucide", Icon: Receipt })).toContain("<svg");
  });

  it("renders nothing for a lucide entry with a missing Icon", () => {
    expect(render({ kind: "lucide" })).toBe("");
  });

  it("renders nothing for an unknown entry kind", () => {
    const host = document.createElement("div");
    const root = createRoot(host);
    expect(() => act(() => root.render(<IconEntryGlyph entry={{ kind: "bogus" } as never} />))).not.toThrow();
    expect(host.innerHTML).toBe("");
    act(() => root.unmount());
  });
});
