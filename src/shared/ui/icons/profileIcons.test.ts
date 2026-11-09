import { describe, expect, it } from "vitest";
import { User } from "lucide-react";
import { iconForProfile, isProfileIconKey } from "./profileIcons";
import { FLAT_ICONS } from "./flatIcons";

describe("iconForProfile", () => {
  it("falls back to a generic person icon when no icon_key is given", () => {
    expect(iconForProfile()).toEqual({ kind: "lucide", Icon: User });
  });

  it("falls back to a generic person icon when icon_key is null", () => {
    expect(iconForProfile(null)).toEqual({ kind: "lucide", Icon: User });
  });

  it("an explicit recognized icon_key picks that avatar", () => {
    expect(iconForProfile("account-avatar-profile-7")).toEqual({
      kind: "image-color",
      src: FLAT_ICONS["account-avatar-profile-7"].src,
    });
  });

  it("an unrecognized icon_key falls back to the generic person icon instead of erroring", () => {
    expect(iconForProfile("not-a-real-key")).toEqual({ kind: "lucide", Icon: User });
  });
});

describe("isProfileIconKey", () => {
  it("recognizes all 15 bundled avatars", () => {
    for (let i = 1; i <= 15; i++) {
      expect(isProfileIconKey(`account-avatar-profile-${i}`)).toBe(true);
    }
  });

  it("rejects an out-of-range avatar number", () => {
    expect(isProfileIconKey("account-avatar-profile-16")).toBe(false);
    expect(isProfileIconKey("account-avatar-profile-0")).toBe(false);
  });

  it("rejects an arbitrary string", () => {
    expect(isProfileIconKey("checking")).toBe(false);
  });
});
