// @vitest-environment jsdom
//
// "Report a bug or issue" in Help opens the public Jira form in the default browser through the Tauri opener. The tests mock the
// opener and the clipboard as real async APIs (they resolve or reject on a later turn), so a double click and a late failure behave
// as they would in the app.
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { act } from "react";
import { createRoot, type Root } from "react-dom/client";

(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

const tauri = vi.hoisted(() => ({ openUrl: vi.fn() }));
vi.mock("@tauri-apps/plugin-opener", () => ({ openUrl: tauri.openUrl }));

import { REPORT_ISSUE_URL, ReportIssueCard } from "./ReportIssueCard";
import { HelpView } from "../../HelpView";

const FORM_URL =
  "https://joeyfaas.atlassian.net/jira/software/form/b05db02e-19ee-4c91-88bb-ecb2a069c70a?atlOrigin=eyJpIjoiOGVhYTZjZWRhMjA5NDU4NzgxY2RlOTEyY2NjZGZiOWIiLCJwIjoiaiJ9";

function deferred<T = void>() {
  let resolve!: (value: T) => void, reject!: (reason: unknown) => void;
  const promise = new Promise<T>((res, rej) => { resolve = res; reject = rej; });
  return { promise, resolve, reject };
}

describe("Report a bug or issue", () => {
  let container: HTMLDivElement;
  let root: Root;
  const writeText = vi.fn();

  beforeEach(() => {
    tauri.openUrl.mockReset();
    writeText.mockReset();
    Object.defineProperty(navigator, "clipboard", { value: { writeText }, configurable: true });
    container = document.createElement("div");
    document.body.append(container);
    root = createRoot(container);
  });
  afterEach(() => {
    act(() => root.unmount());
    container.remove();
  });

  const mount = (node = <ReportIssueCard />) => act(async () => { root.render(node); });
  const button = (name: string) => [...container.querySelectorAll("button")].find((b) => b.textContent?.trim() === name) as HTMLButtonElement | undefined;
  const status = () => container.querySelector('[role="status"]')?.textContent?.trim() ?? "";
  const alertText = () => container.querySelector('[role="alert"]')?.textContent?.trim() ?? "";
  const click = (name: string) => act(async () => { button(name)!.click(); });

  it("uses exactly the owner's form address, with nothing added to it", () => {
    expect(REPORT_ISSUE_URL).toBe(FORM_URL);
    const url = new URL(REPORT_ISSUE_URL);
    expect(url.protocol).toBe("https:");
    expect([...url.searchParams.keys()]).toEqual(["atlOrigin"]);
  });

  it("has a clearly named button and explains, in plain words, what opens and what is not sent", async () => {
    await mount();
    const open = button("Report a bug or issue");
    expect(open).toBeDefined();
    expect(open!.type).toBe("button");
    const text = container.textContent ?? "";
    expect(text).toContain("web browser");
    expect(text).toMatch(/email address/i);
    expect(text).toMatch(/nothing from your budget/i);
    expect(container.querySelector("iframe, webview, a[href]")).toBeNull();
  });

  it("opens the form once in the default browser, passing only the form address", async () => {
    tauri.openUrl.mockResolvedValue(undefined);
    await mount();
    await click("Report a bug or issue");
    expect(tauri.openUrl).toHaveBeenCalledTimes(1);
    expect(tauri.openUrl).toHaveBeenCalledWith(FORM_URL);
    expect(status()).toContain("opened in your web browser");
    expect(alertText()).toBe("");
    expect(button("Copy link")).toBeUndefined();
  });

  it("ignores a second activation while the first is still opening, then allows another once it has finished", async () => {
    const pending = deferred();
    tauri.openUrl.mockReturnValueOnce(pending.promise);
    await mount();
    const open = button("Report a bug or issue")!;
    await act(async () => { open.click(); open.click(); });
    expect(tauri.openUrl).toHaveBeenCalledTimes(1);
    expect(open.getAttribute("aria-disabled")).toBe("true");
    await act(async () => { pending.resolve(); await pending.promise; });
    expect(open.hasAttribute("aria-disabled")).toBe(false);
    tauri.openUrl.mockResolvedValueOnce(undefined);
    await click("Report a bug or issue");
    expect(tauri.openUrl).toHaveBeenCalledTimes(2);
  });

  it("keeps the button focusable while it is opening, so keyboard focus is not lost", async () => {
    tauri.openUrl.mockReturnValueOnce(deferred().promise);
    await mount();
    const open = button("Report a bug or issue")!;
    open.focus();
    await act(async () => { open.click(); });
    expect(open.disabled).toBe(false);
    expect(document.activeElement).toBe(open);
  });

  it("says plainly when the browser could not be opened, and offers the link to copy and select", async () => {
    tauri.openUrl.mockRejectedValue(new Error("no default browser"));
    await mount();
    await click("Report a bug or issue");
    expect(alertText()).toContain("Couldn't open your web browser");
    expect(alertText()).toContain("copy the link");
    expect(status()).toBe("");
    expect(button("Copy link")).toBeDefined();
    const shown = container.querySelector<HTMLElement>("[data-report-link]")!;
    expect(shown.textContent).toBe(FORM_URL);
    expect(shown.style.userSelect).toBe("text");
    expect(container.textContent).not.toContain("no default browser");
  });

  it("copies exactly the form address and confirms it", async () => {
    tauri.openUrl.mockRejectedValue("denied");
    writeText.mockResolvedValue(undefined);
    await mount();
    await click("Report a bug or issue");
    await click("Copy link");
    expect(writeText).toHaveBeenCalledTimes(1);
    expect(writeText).toHaveBeenCalledWith(FORM_URL);
    expect(status()).toContain("Link copied");
    expect(alertText()).toBe("");
  });

  it("says so when the link could not be copied, and leaves it selectable", async () => {
    tauri.openUrl.mockRejectedValue("denied");
    writeText.mockRejectedValue(new DOMException("blocked", "NotAllowedError"));
    await mount();
    await click("Report a bug or issue");
    await click("Copy link");
    expect(alertText()).toContain("Couldn't copy the link");
    expect(alertText()).toContain("select");
    expect(container.querySelector("[data-report-link]")!.textContent).toBe(FORM_URL);
  });

  it("treats a missing clipboard like a failed copy instead of throwing", async () => {
    tauri.openUrl.mockRejectedValue("denied");
    Object.defineProperty(navigator, "clipboard", { value: undefined, configurable: true });
    await mount();
    await click("Report a bug or issue");
    await click("Copy link");
    expect(alertText()).toContain("Couldn't copy the link");
  });

  it("clears an old error when the person tries again and it works", async () => {
    tauri.openUrl.mockRejectedValueOnce("denied").mockResolvedValueOnce(undefined);
    await mount();
    await click("Report a bug or issue");
    expect(alertText()).not.toBe("");
    await click("Report a bug or issue");
    expect(alertText()).toBe("");
    expect(status()).toContain("opened in your web browser");
  });

  it("announces results in live regions that are on the page before the message arrives", async () => {
    tauri.openUrl.mockRejectedValue("denied");
    await mount();
    const region = container.querySelector('[role="status"]')!;
    const alertRegion = container.querySelector('[role="alert"]')!;
    expect(region.getAttribute("aria-live")).toBe("polite");
    await click("Report a bug or issue");
    expect(container.querySelector('[role="status"]')).toBe(region);
    expect(container.querySelector('[role="alert"]')).toBe(alertRegion);
  });

  it("is on the Help page without disturbing its sections or search", async () => {
    await mount(<HelpView />);
    expect(button("Report a bug or issue")).toBeDefined();
    expect(container.querySelectorAll("details.help-topic, details.help-tab").length).toBeGreaterThanOrEqual(12);
    const search = container.querySelector<HTMLInputElement>('input[type="search"]')!;
    await act(async () => {
      Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, "value")!.set!.call(search, "zzzz no such topic");
      search.dispatchEvent(new Event("input", { bubbles: true }));
    });
    expect(container.textContent).toContain("No results for");
    expect(button("Report a bug or issue")).toBeDefined();
  });

  it("never says No results while the report card is the match, and still falls back to the card when nothing matches", async () => {
    await mount(<HelpView />);
    const search = container.querySelector<HTMLInputElement>('input[type="search"]')!;
    const type = (value: string) => act(async () => {
      Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, "value")!.set!.call(search, value);
      search.dispatchEvent(new Event("input", { bubbles: true }));
    });
    const noResults = () => (container.textContent ?? "").includes("No results for");
    const cards = () => [...container.querySelectorAll("button")].filter((b) => b.textContent?.trim() === "Report a bug or issue").length;
    for (const term of ["bug", "feedback", "support", "something wrong"]) {
      await type(term);
      expect(noResults(), `"${term}" matches the report card, so no "No results"`).toBe(false);
      expect(cards(), `"${term}" shows the report card once`).toBe(1);
    }
    await type("zzzz no such topic");
    expect(noResults()).toBe(true);
    expect(cards()).toBe(1);
    await type("backup");
    expect(noResults()).toBe(false);
    expect(cards()).toBe(0);
    expect(container.textContent).toMatch(/backup/i);
    await type("");
    expect(noResults()).toBe(false);
    expect(cards()).toBe(1);
    expect(container.querySelectorAll("details.help-topic, details.help-tab").length).toBeGreaterThanOrEqual(12);
  });

  it("is found by searching for a bug or a problem, and stays out of the way of unrelated searches", async () => {
    await mount(<HelpView />);
    const search = container.querySelector<HTMLInputElement>('input[type="search"]')!;
    const type = (value: string) => act(async () => {
      Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, "value")!.set!.call(search, value);
      search.dispatchEvent(new Event("input", { bubbles: true }));
    });
    await type("bug");
    expect(button("Report a bug or issue")).toBeDefined();
    await type("backup");
    expect(button("Report a bug or issue")).toBeUndefined();
    await type("");
    expect(button("Report a bug or issue")).toBeDefined();
  });
});
