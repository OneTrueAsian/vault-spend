import { describe, expect, it } from "vitest";
import { iconForAccount, isAccountIconKey } from "./accountIcons";
import { FLAT_ICONS } from "./flatIcons";

describe("iconForAccount", () => {
  it("falls back to the account_type guess when no icon_key is given", () => {
    expect(iconForAccount("checking")).toEqual({ kind: "image-color", src: FLAT_ICONS["money-checkings-acct"].src });
  });

  it("falls back to the account_type guess when icon_key is null", () => {
    expect(iconForAccount("credit", null)).toEqual({ kind: "image-color", src: FLAT_ICONS["credit-card-acct"].src });
  });

  it("an explicit recognized icon_key overrides the account_type guess", () => {
    expect(iconForAccount("checking", "investment")).toEqual({ kind: "image-color", src: FLAT_ICONS["investment-acct"].src });
  });

  it("an unrecognized icon_key falls back to the account_type guess instead of erroring", () => {
    expect(iconForAccount("checking", "not-a-real-key")).toEqual({ kind: "image-color", src: FLAT_ICONS["money-checkings-acct"].src });
  });

  it("loan borrows the debt-dash icon (no dedicated loan asset was provided)", () => {
    expect(iconForAccount("loan")).toEqual({ kind: "image-color", src: FLAT_ICONS["debt-dash"].src });
  });

  it("other borrows the net-worth-dash icon (no dedicated other-asset asset was provided)", () => {
    expect(iconForAccount("other")).toEqual({ kind: "image-color", src: FLAT_ICONS["net-worth-dash"].src });
  });

  it("an unrecognized account_type falls back to the same icon as other", () => {
    expect(iconForAccount("not-a-real-type")).toEqual({ kind: "image-color", src: FLAT_ICONS["net-worth-dash"].src });
  });

  it("an explicit car or mortgage icon_key picks that icon regardless of account_type", () => {
    expect(iconForAccount("loan", "car")).toEqual({ kind: "image-color", src: FLAT_ICONS["car-goal"].src });
    expect(iconForAccount("loan", "mortgage")).toEqual({ kind: "image-color", src: FLAT_ICONS["mortgage-category"].src });
  });
});

describe("isAccountIconKey", () => {
  it("recognizes every one of the 8 account picker keys", () => {
    for (const key of ["checking", "savings", "credit", "loan", "investment", "other", "car", "mortgage"]) {
      expect(isAccountIconKey(key)).toBe(true);
    }
  });

  it("rejects an arbitrary string", () => {
    expect(isAccountIconKey("not-a-real-key")).toBe(false);
  });

  it("rejects the profile-avatar keys — those belong to profiles, not accounts", () => {
    expect(isAccountIconKey("account-avatar-profile-1")).toBe(false);
  });
});
