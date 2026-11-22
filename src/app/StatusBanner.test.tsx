// @vitest-environment jsdom
// VS-71: a backup, restore, key-file or update failure shows its plain words; the technical cause is one click away
// under Details, with a Copy button for sending it to support.
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { StatusBanner } from "./StatusBanner";
import { ERROR_DETAIL_SEPARATOR } from "../shared/lib/errorMessage";

(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

let container: HTMLDivElement;
let root: Root;
beforeEach(() => {
  container = document.createElement("div");
  document.body.appendChild(container);
  root = createRoot(container);
});
afterEach(() => {
  act(() => root.unmount());
  container.remove();
  vi.restoreAllMocks();
});

const show = (text: string) => act(() => root.render(<StatusBanner text={text} kind="error" onDismiss={vi.fn()} />));
const button = (label: string) => [...container.querySelectorAll<HTMLButtonElement>("button")].find((b) => b.textContent === label);
const failed = `The backup wasn't saved.${ERROR_DETAIL_SEPARATOR}couldn't write the backup: Access is denied. (os error 5)`;

describe("StatusBanner details (VS-71)", () => {
  it("shows the plain words and keeps the cause behind Details", () => {
    show(failed);
    expect(container.querySelector(".status-text")?.textContent).toBe("The backup wasn't saved.");
    expect(container.querySelector("[data-status-detail]")).toBeNull();
    const details = button("Details")!;
    expect(details.getAttribute("aria-expanded")).toBe("false");
    act(() => details.click());
    expect(details.getAttribute("aria-expanded")).toBe("true");
    expect(container.querySelector("[data-status-detail]")?.textContent).toBe("couldn't write the backup: Access is denied. (os error 5)");
    act(() => details.click());
    expect(container.querySelector("[data-status-detail]")).toBeNull();
  });

  it("copies the cause, and says so", async () => {
    const writeText = vi.fn(async () => {});
    Object.defineProperty(navigator, "clipboard", { value: { writeText }, configurable: true });
    show(failed);
    act(() => button("Details")!.click());
    await act(async () => button("Copy details")!.click());
    expect(writeText).toHaveBeenCalledWith("couldn't write the backup: Access is denied. (os error 5)");
    expect(button("Copied")).toBeDefined();
  });

  it("has no Details for a message without a cause", () => {
    show("Backup created.");
    expect(container.querySelector(".status-text")?.textContent).toBe("Backup created.");
    expect(button("Details")).toBeUndefined();
  });

  it("closes Details when a new message replaces the old one", () => {
    show(failed);
    act(() => button("Details")!.click());
    show(`Nothing was restored.${ERROR_DETAIL_SEPARATOR}restore did not verify`);
    expect(container.querySelector("[data-status-detail]")).toBeNull();
  });
});
