// @vitest-environment jsdom
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { HelpView } from "./HelpView";

(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

describe("HelpView", () => {
  let container: HTMLDivElement;
  let root: Root;

  beforeEach(() => {
    container = document.createElement("div");
    document.body.append(container);
    root = createRoot(container);
    act(() => {
      root.render(<HelpView />);
    });
  });

  afterEach(() => {
    act(() => root.unmount());
    container.remove();
  });

  // The Settings card that holds the password controls is titled "Password protection"
  // (ProfileProtectionSection). Help must send people to a heading that exists.
  it("points to the Settings heading that exists for password protection and automatic locking", () => {
    const text = container.textContent ?? "";

    expect(text).not.toContain("Profile protection");
    expect(text).toContain("Settings → Password protection");
    expect(text).toContain("Settings → Password protection → Automatic locking");
  });

  it("lists every network request the app makes in the privacy answer, including Google Fonts", () => {
    const text = container.textContent ?? "";

    expect(text).toContain("Google Fonts");
    expect(text).not.toContain("The only network requests Vault Spend makes");
  });

  it("explains Futuristic's accent and glow choices and the Reduce motion option", () => {
    const text = container.textContent ?? "";
    expect(text).toContain("Ion Cyan, Rebel Pink, or Ultraviolet");
    expect(text).toContain("Neon intensity");
    expect(text).toContain("Reduce motion");
  });

  it("explains that rules ignore store numbers", () => {
    expect(container.textContent).toContain("ignoring store numbers");
  });

  it("explains that a split merchant's rule is flagged for review, not applied silently", () => {
    expect(container.textContent).toContain("filed under more than one category");
  });

  it("finds the legal notice when searching for \"disclaimer\"", () => {
    const input = container.querySelector<HTMLInputElement>("input[type=search], input[placeholder*=earch]")!;
    act(() => {
      const setter = Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, "value")!.set!;
      setter.call(input, "disclaimer");
      input.dispatchEvent(new Event("input", { bubbles: true }));
    });
    expect(container.textContent).toContain("legal notice");
  });

  it("finds the Transactions entry when searching for \"note\"", () => {
    const input = container.querySelector<HTMLInputElement>("input[type=search], input[placeholder*=earch]")!;
    act(() => {
      const setter = Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, "value")!.set!;
      setter.call(input, "note");
      input.dispatchEvent(new Event("input", { bubbles: true }));
    });
    expect(container.textContent).toContain("Transactions");
  });
  it("explains the age-based comparisons: gross income, age groups, past data, unavailable benchmarks and privacy", () => {
    const text = container.textContent ?? "";

    expect(text).toContain("How do the age-based comparisons in Reports work?");
    expect(text).toContain("Income is before tax");
    expect(text).toContain("which published age group");
    expect(text).toContain("past surveys");
    expect(text).toContain("nothing is substituted");
    expect(text).toContain("Your details");
    expect(text).toContain("nothing you enter is");
  });
});
