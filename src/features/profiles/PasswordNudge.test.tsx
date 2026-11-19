// @vitest-environment jsdom
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { act } from "react";
import { createRoot, type Root } from "react-dom/client";

const protection = vi.hoisted(() => ({ passwordNudge: vi.fn() }));
vi.mock("../../shared/lib/protection", () => protection);
const autoLock = vi.hoisted(() => ({ getCurrentGeneration: vi.fn() }));
vi.mock("../../shared/lib/autoLock", () => autoLock);
const eventHandlers = vi.hoisted(() => new Map<string, () => void>());
vi.mock("@tauri-apps/api/event", () => ({
  listen: (name: string, handler: () => void) => {
    eventHandlers.set(name, handler);
    return Promise.resolve(() => {});
  },
}));

import { PasswordNudge } from "./PasswordNudge";

(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

describe("PasswordNudge", () => {
  let container: HTMLDivElement;
  let root: Root;
  const onChangePassword = vi.fn();

  beforeEach(() => {
    protection.passwordNudge.mockReset().mockResolvedValue(true);
    autoLock.getCurrentGeneration.mockReset().mockResolvedValue(4);
    eventHandlers.clear();
    onChangePassword.mockReset();
    container = document.createElement("div");
    document.body.append(container);
    root = createRoot(container);
  });

  afterEach(() => {
    act(() => root.unmount());
    container.remove();
  });

  async function show() {
    await act(async () => root.render(<PasswordNudge onChangePassword={onChangePassword} />));
  }

  function button(name: string) {
    return [...container.querySelectorAll<HTMLButtonElement>("button")].find((b) => b.textContent === name)!;
  }

  it("asks about the current generation and shows the notice with both buttons", async () => {
    await show();
    expect(protection.passwordNudge).toHaveBeenCalledWith(4);
    expect(container.textContent).toContain("Your password is shorter than we now recommend. A longer one is much harder to guess.");
    expect(button("Change password")).toBeDefined();
    expect(button("Not now")).toBeDefined();
  });

  it("Not now hides it", async () => {
    await show();
    act(() => button("Not now").click());
    expect(container.textContent).toBe("");
  });

  it("Change password calls onChangePassword", async () => {
    await show();
    act(() => button("Change password").click());
    expect(onChangePassword).toHaveBeenCalledTimes(1);
  });

  it("renders nothing when the backend says no", async () => {
    protection.passwordNudge.mockResolvedValue(false);
    await show();
    expect(container.textContent).toBe("");
  });

  it("goes away when the profile is swapped (for example after the password is changed)", async () => {
    await show();
    expect(container.textContent).toContain("shorter than we now recommend");
    protection.passwordNudge.mockResolvedValue(false);
    autoLock.getCurrentGeneration.mockResolvedValue(5);
    await act(async () => eventHandlers.get("profile-lock-state-changed")!());
    expect(protection.passwordNudge).toHaveBeenLastCalledWith(5);
    expect(container.textContent).toBe("");
  });
});
