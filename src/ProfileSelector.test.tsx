// @vitest-environment jsdom
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { act } from "react";
import { createRoot, type Root } from "react-dom/client";

const protection = vi.hoisted(() => ({ selectProfile: vi.fn() }));
vi.mock("./protection", () => protection);

import { ProfileSelector } from "./ProfileSelector";

(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

const THREE = [
  { id: "a", name: "Alex", icon_key: null, is_password_protected: false },
  { id: "b", name: "Blair", icon_key: null, is_password_protected: true },
  { id: "c", name: "Casey", icon_key: null, is_password_protected: false },
];

describe("ProfileSelector", () => {
  let container: HTMLDivElement;
  let root: Root;
  const onResolved = vi.fn();

  beforeEach(() => {
    protection.selectProfile.mockReset();
    onResolved.mockReset();
    container = document.createElement("div");
    document.body.append(container);
    root = createRoot(container);
  });

  afterEach(() => {
    act(() => root.unmount());
    container.remove();
  });

  function show(profiles: typeof THREE, lastUsedId: string | null = null) {
    act(() => {
      root.render(<ProfileSelector profiles={profiles} lastUsedId={lastUsedId} onResolved={onResolved} />);
    });
  }

  function buttons() {
    return [...container.querySelectorAll<HTMLButtonElement>("[data-profile-option]")];
  }

  it("shows a plain list for three or fewer profiles, with a lock indicator on protected ones", () => {
    show(THREE);

    expect(buttons()).toHaveLength(3);
    expect(buttons().map((b) => b.textContent)).toEqual(expect.arrayContaining([expect.stringContaining("Alex")]));
    const blair = buttons().find((b) => b.textContent?.includes("Blair"))!;
    expect(blair.querySelector('[aria-label="Password protected"]')).not.toBeNull();
    const alex = buttons().find((b) => b.textContent?.includes("Alex"))!;
    expect(alex.querySelector('[aria-label="Password protected"]')).toBeNull();
  });

  it("shows a drop-down for four or more profiles", () => {
    const four = [...THREE, { id: "d", name: "Dana", icon_key: null, is_password_protected: false }];

    show(four);

    expect(container.querySelector("select")).not.toBeNull();
    expect(buttons()).toHaveLength(0);
  });

  it("selecting an unprotected profile calls selectProfile and reports the result", async () => {
    protection.selectProfile.mockResolvedValue({ status: "open" });
    show(THREE);

    await act(async () => {
      buttons().find((b) => b.textContent?.includes("Alex"))!.click();
    });

    expect(protection.selectProfile).toHaveBeenCalledWith("a");
    expect(onResolved).toHaveBeenCalledWith({ status: "open" });
  });

  it("selecting a protected profile still just calls selectProfile — the backend decides Locked, not the UI", async () => {
    protection.selectProfile.mockResolvedValue({ status: "locked", profile_id: "b", profile_name: "Blair" });
    show(THREE);

    await act(async () => {
      buttons().find((b) => b.textContent?.includes("Blair"))!.click();
    });

    expect(onResolved).toHaveBeenCalledWith({ status: "locked", profile_id: "b", profile_name: "Blair" });
  });

  it("shows the error inline and stays on the selector when selection fails", async () => {
    protection.selectProfile.mockRejectedValue("That profile no longer exists.");
    show(THREE);

    await act(async () => {
      buttons().find((b) => b.textContent?.includes("Alex"))!.click();
    });

    const alert = container.querySelector('[role="alert"]');
    expect(alert?.textContent).toBe("That profile no longer exists.");
    expect(onResolved).not.toHaveBeenCalled();
  });
});
