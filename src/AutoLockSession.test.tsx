// @vitest-environment jsdom
import { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

const autoLock = vi.hoisted(() => ({
  getCurrentGeneration: vi.fn(),
  recordTrustedActivity: vi.fn(),
  installTrustedActivityReporter: vi.fn(),
}));
vi.mock("./autoLock", () => autoLock);

const eventHandlers = vi.hoisted(() => new Map<string, (event: { payload: unknown }) => void>());
const unlisten = vi.hoisted(() => vi.fn());
const listenMock = vi.hoisted(() => vi.fn());
vi.mock("@tauri-apps/api/event", () => ({ listen: listenMock }));

import { AutoLockSession } from "./AutoLockSession";

describe("AutoLockSession", () => {
  let container: HTMLDivElement;
  let root: Root;

  beforeEach(() => {
    vi.useFakeTimers();
    vi.setSystemTime(0);
    autoLock.getCurrentGeneration.mockReset().mockResolvedValue(4);
    autoLock.recordTrustedActivity.mockReset().mockResolvedValue(undefined);
    autoLock.installTrustedActivityReporter.mockReset().mockReturnValue(vi.fn());
    eventHandlers.clear();
    unlisten.mockReset();
    listenMock.mockReset().mockImplementation((name: string, handler: (event: { payload: unknown }) => void) => {
      eventHandlers.set(name, handler);
      return Promise.resolve(unlisten);
    });
    container = document.createElement("div");
    document.body.append(container);
    root = createRoot(container);
  });

  afterEach(() => {
    act(() => root.unmount());
    container.remove();
    vi.useRealTimers();
  });

  async function mount() {
    await act(async () => {
      root.render(<AutoLockSession />);
    });
  }

  async function emit(name: string, payload: unknown) {
    await act(async () => {
      eventHandlers.get(name)?.({ payload });
    });
  }

  it("renders and updates an accessible countdown without stealing focus", async () => {
    const field = document.createElement("input");
    document.body.append(field);
    field.focus();
    await mount();

    await emit("profile-lock-countdown", { profile_id: "alpha", generation: 4, seconds: 10, reason: "inactivity" });

    const status = document.querySelector<HTMLElement>("[data-auto-lock-countdown]");
    expect(status?.getAttribute("role")).toBe("status");
    expect(status?.getAttribute("aria-live")).toBe("polite");
    expect(status?.textContent).toContain("Vault Spend will lock in 10 seconds");
    expect(document.activeElement).toBe(field);

    await act(async () => vi.advanceTimersByTime(2_000));
    expect(status?.textContent).toContain("8 seconds");
    field.remove();
  });

  it("hides only for the matching cancellation and Stay unlocked reports immediately", async () => {
    await mount();
    await emit("profile-lock-countdown", { profile_id: "alpha", generation: 4, seconds: 10, reason: "inactivity" });
    await emit("profile-lock-countdown-cancelled", { profile_id: "alpha", generation: 3 });
    expect(document.querySelector("[data-auto-lock-countdown]")).not.toBeNull();

    await act(async () => {
      document.querySelector<HTMLButtonElement>("[data-stay-unlocked]")!.click();
    });
    expect(autoLock.recordTrustedActivity).toHaveBeenCalledWith(4);

    await emit("profile-lock-countdown-cancelled", { profile_id: "alpha", generation: 4 });
    expect(document.querySelector("[data-auto-lock-countdown]")).toBeNull();
  });

  it("reports activity with a freshly re-fetched generation after the identity changes, not the one cached at mount", async () => {
    autoLock.getCurrentGeneration.mockResolvedValueOnce(4).mockResolvedValueOnce(9);
    await mount();
    // Any in-place swap (turning on protection, restore, relocate, a profile switch — none of which
    // unmount this component) broadcasts this event once it's done, carrying no generation of its
    // own; the session is expected to re-fetch the current one, not keep using whatever it saw at
    // mount.
    await emit("profile-lock-state-changed", { status: "open" });

    const report = autoLock.installTrustedActivityReporter.mock.calls[0][0] as () => void | Promise<void>;
    await act(async () => {
      await report();
    });

    expect(autoLock.recordTrustedActivity).toHaveBeenCalledWith(9);
    expect(autoLock.recordTrustedActivity).not.toHaveBeenCalledWith(4);
  });

  it("ignores a countdown event whose generation no longer matches the current one", async () => {
    autoLock.getCurrentGeneration.mockResolvedValueOnce(4).mockResolvedValueOnce(9);
    await mount();
    await emit("profile-lock-state-changed", { status: "open" });

    await emit("profile-lock-countdown", { profile_id: "alpha", generation: 4, seconds: 10, reason: "inactivity" });
    expect(document.querySelector("[data-auto-lock-countdown]")).toBeNull();

    await emit("profile-lock-countdown", { profile_id: "beta", generation: 9, seconds: 10, reason: "inactivity" });
    expect(document.querySelector("[data-auto-lock-countdown]")).not.toBeNull();
  });

  it("cleans up activity and backend event listeners on unmount", async () => {
    const cleanupActivity = vi.fn();
    autoLock.installTrustedActivityReporter.mockReturnValue(cleanupActivity);
    await mount();

    act(() => root.unmount());
    await act(async () => Promise.resolve());

    expect(cleanupActivity).toHaveBeenCalledTimes(1);
    expect(unlisten).toHaveBeenCalledTimes(3);
    root = createRoot(container);
  });
});
