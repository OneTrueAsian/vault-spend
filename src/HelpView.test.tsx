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
});
