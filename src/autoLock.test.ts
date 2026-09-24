import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { installTrustedActivityReporter } from "./autoLock";

describe("trusted automatic-lock activity reporting", () => {
  beforeEach(() => {
    vi.useFakeTimers();
    vi.setSystemTime(0);
  });

  afterEach(() => {
    vi.useRealTimers();
  });

  it("reports trusted activity immediately, then at most once per 15 seconds with a trailing report", () => {
    const target = new EventTarget();
    const report = vi.fn();
    const cleanup = installTrustedActivityReporter(report, { target, isTrusted: () => true });

    target.dispatchEvent(new Event("pointerdown"));
    vi.setSystemTime(5_000);
    target.dispatchEvent(new Event("keydown"));
    target.dispatchEvent(new Event("wheel"));
    expect(report).toHaveBeenCalledTimes(1);

    vi.advanceTimersByTime(9_999);
    expect(report).toHaveBeenCalledTimes(1);
    vi.advanceTimersByTime(1);
    expect(report).toHaveBeenCalledTimes(2);

    cleanup();
  });

  it("reports a trusted window focus immediately even inside the normal throttle window", () => {
    const target = new EventTarget();
    const report = vi.fn();
    const cleanup = installTrustedActivityReporter(report, { target, isTrusted: () => true });
    target.dispatchEvent(new Event("pointerdown"));

    vi.setSystemTime(1_000);
    target.dispatchEvent(new Event("focus"));

    expect(report).toHaveBeenCalledTimes(2);
    cleanup();
  });

  it("ignores synthetic events and events unrelated to user input", () => {
    const target = new EventTarget();
    const report = vi.fn();
    const cleanup = installTrustedActivityReporter(report, { target });

    target.dispatchEvent(new Event("pointerdown"));
    target.dispatchEvent(new Event("keydown"));
    target.dispatchEvent(new Event("online"));
    target.dispatchEvent(new Event("load"));

    expect(report).not.toHaveBeenCalled();
    cleanup();
  });

  it("removes every listener and pending trailing timer during cleanup", () => {
    const target = new EventTarget();
    const report = vi.fn();
    const cleanup = installTrustedActivityReporter(report, { target, isTrusted: () => true });
    target.dispatchEvent(new Event("pointerdown"));
    vi.setSystemTime(1_000);
    target.dispatchEvent(new Event("keydown"));

    cleanup();
    vi.advanceTimersByTime(30_000);
    target.dispatchEvent(new Event("pointerdown"));

    expect(report).toHaveBeenCalledTimes(1);
  });
});
