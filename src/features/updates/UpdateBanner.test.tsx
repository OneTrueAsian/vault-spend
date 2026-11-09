// @vitest-environment jsdom
//
// The update check runs through the app's own backend, never a page request: the window's content
// rules (appSecurity.test.ts) refuse every remote request from the page, and 1.2.9 shipped with the
// banner asking GitHub directly, so the rules silently blocked it and no one heard about 1.3.0.
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { act } from "react";
import { createRoot, type Root } from "react-dom/client";

(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

const tauri = vi.hoisted(() => ({ invoke: vi.fn(), getVersion: vi.fn(), openPath: vi.fn(), openUrl: vi.fn() }));
const events = vi.hoisted(() => ({ listen: vi.fn() }));
vi.mock("@tauri-apps/api/event", () => ({ listen: events.listen }));
vi.mock("@tauri-apps/api/core", () => ({ invoke: tauri.invoke }));
vi.mock("@tauri-apps/api/app", () => ({ getVersion: tauri.getVersion }));
vi.mock("@tauri-apps/plugin-opener", () => ({ openPath: tauri.openPath, openUrl: tauri.openUrl }));

import { UpdateBanner } from "./UpdateBanner";

const release = (tag: string) => ({
  tag_name: tag,
  html_url: `https://github.com/OneTrueAsian/vault-spend/releases/tag/${tag}`,
  assets: [{ name: "Vault.Spend_1.3.0_x64-setup.exe", browser_download_url: "https://example.invalid/setup.exe" }],
});

describe("UpdateBanner", () => {
  let container: HTMLDivElement;
  let root: Root;
  const pageFetch = vi.fn();

  beforeEach(() => {
    tauri.invoke.mockReset();
    tauri.getVersion.mockReset();
    tauri.openPath.mockReset();
    tauri.openUrl.mockReset();
    tauri.getVersion.mockResolvedValue("1.2.9");
    events.listen.mockReset();
    events.listen.mockResolvedValue(() => {});
    pageFetch.mockReset();
    vi.stubGlobal("fetch", pageFetch);
    vi.spyOn(navigator, "userAgent", "get").mockReturnValue("Mozilla/5.0 (Windows NT 10.0; Win64; x64)");
    localStorage.clear();
    container = document.createElement("div");
    document.body.append(container);
    root = createRoot(container);
  });

  afterEach(() => {
    act(() => root.unmount());
    container.remove();
    vi.unstubAllGlobals();
    vi.restoreAllMocks();
  });

  async function mount() {
    await act(async () => {
      root.render(<UpdateBanner />);
    });
  }
  function unsigned(data: ReturnType<typeof release>) {
    tauri.invoke.mockImplementation((command: string) => Promise.resolve(command === "fetch_latest_release" ? data : null));
  }

  it("asks the backend for the latest release and never requests GitHub from the page", async () => {
    unsigned(release("v1.3.0"));
    await mount();
    expect(tauri.invoke).toHaveBeenCalledWith("fetch_latest_release");
    expect(pageFetch).not.toHaveBeenCalled();
  });

  it("shows the banner when a newer version is out", async () => {
    unsigned(release("v1.3.0"));
    await mount();
    expect(container.textContent).toContain("A new version of Vault Spend (1.3.0) is available.");
    expect(container.textContent).toContain("View release");
    expect(container.textContent).not.toContain("Update now");
    expect(container.textContent).not.toContain("Download update");
    expect(container.querySelector('[role="alert"]')).toBeNull();
  });

  it("stays hidden when the installed version is current", async () => {
    unsigned(release("v1.2.9"));
    await mount();
    expect(container.textContent).toBe("");
  });

  it("stays hidden when the check fails (offline, rate-limited)", async () => {
    tauri.invoke.mockRejectedValue("Couldn't check for updates");
    await mount();
    expect(container.textContent).toBe("");
  });

  it("stays hidden for a version the person already dismissed", async () => {
    localStorage.setItem("vaultspend-dismissed-update-version", "v1.3.0");
    unsigned(release("v1.3.0"));
    await mount();
    expect(container.textContent).toBe("");
  });

  it("uses the fixed official release page even if metadata supplies another URL", async () => {
    unsigned({ ...release("v1.3.0"), html_url: "https://example.invalid/installer" });
    await mount();
    const button = [...container.querySelectorAll("button")].find((b) => b.textContent === "View release")!;
    await act(async () => button.click());
    expect(tauri.openUrl).toHaveBeenCalledWith("https://github.com/OneTrueAsian/vault-spend/releases");
    expect(tauri.openPath).not.toHaveBeenCalled();
    expect(
      tauri.invoke.mock.calls.every(([command]) => ["fetch_latest_release", "prepare_signed_update"].includes(command)),
    ).toBe(true);
  });

  const offer = { handle: "a".repeat(64), version: "1.3.0", size: 100 };
  const token = "b".repeat(64);
  function signedReplies(download: Promise<string> = Promise.resolve(token)) {
    tauri.invoke.mockImplementation((command: string) => {
      if (command === "fetch_latest_release") return Promise.resolve(release("v1.3.0"));
      if (command === "prepare_signed_update") return Promise.resolve(offer);
      if (command === "download_signed_update") return download;
      return Promise.resolve();
    });
  }
  async function click(text: string) {
    const button = [...document.querySelectorAll("button")].find((b) => b.textContent === text);
    expect(button, `Expected ${text}`).toBeTruthy();
    await act(async () => button!.click());
  }
  it("downloads by opaque handle and requires confirmation before native installer handoff", async () => {
    signedReplies();
    await mount();
    await click("Download update");
    expect(tauri.invoke).toHaveBeenCalledWith("download_signed_update", { handle: offer.handle });
    await click("Open verified installer");
    expect(tauri.invoke.mock.calls.some(([c]) => c === "install_signed_update")).toBe(false);
    await click("Not now");
    await click("Open verified installer");
    await click("Open installer");
    expect(tauri.invoke).toHaveBeenCalledWith("install_signed_update", { token });
    expect(container.textContent).toContain("Installer opened");
    expect(tauri.openPath).not.toHaveBeenCalled();
  });
  it("cancels an active download and disposes a late staged token", async () => {
    let resolve!: (token: string) => void;
    signedReplies(
      new Promise<string>((r) => {
        resolve = r;
      }),
    );
    await mount();
    await click("Download update");
    const progress = events.listen.mock.calls[0][1];
    act(() => progress({ payload: { handle: offer.handle, received: 50, total: 100, verifying: false } }));
    expect(container.textContent).toContain("50%");
    await click("Cancel update");
    expect(tauri.invoke).toHaveBeenCalledWith("cancel_signed_update", { handle: offer.handle });
    await act(async () => resolve(token));
    expect(tauri.invoke).toHaveBeenCalledWith("cancel_signed_update", { handle: token });
    expect(container.textContent).not.toContain("Installer verified and ready");
  });
  it("coalesces duplicate download clicks before React updates the controls", async () => {
    let resolve!: (token: string) => void;
    signedReplies(
      new Promise<string>((r) => {
        resolve = r;
      }),
    );
    await mount();
    const button = [...container.querySelectorAll("button")].find((b) => b.textContent === "Download update")!;
    act(() => {
      button.click();
      button.click();
    });
    expect(tauri.invoke.mock.calls.filter(([c]) => c === "download_signed_update")).toHaveLength(1);
    await act(async () => resolve(token));
    expect(container.textContent).toContain("Installer verified and ready");
  });
  it("rejects malformed offers and retains the fixed manual fallback", async () => {
    signedReplies();
    tauri.invoke.mockImplementation((command: string) =>
      Promise.resolve(
        command === "fetch_latest_release" ? release("v1.3.0") : { ...offer, handle: "C:\\installer.exe" },
      ),
    );
    await mount();
    expect(container.textContent).not.toContain("Download update");
    expect(container.querySelector('[role="alert"]')).toBeTruthy();
    await click("View release");
    expect(tauri.openUrl).toHaveBeenCalledWith("https://github.com/OneTrueAsian/vault-spend/releases");
  });
  it("reports installer refusal and clears the consumed token", async () => {
    signedReplies();
    const original = tauri.invoke.getMockImplementation()!;
    tauri.invoke.mockImplementation((command: string, args: unknown) =>
      command === "install_signed_update" ? Promise.reject("Installer expired") : original(command, args),
    );
    await mount();
    await click("Download update");
    await click("Open verified installer");
    await click("Open installer");
    expect(container.textContent).toContain("Installer expired");
    expect(container.textContent).not.toContain("Open verified installer");
  });
});
