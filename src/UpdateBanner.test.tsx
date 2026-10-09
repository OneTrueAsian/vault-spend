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

  it("asks the backend for the latest release and never requests GitHub from the page", async () => {
    tauri.invoke.mockResolvedValue(release("v1.3.0"));
    await mount();
    expect(tauri.invoke).toHaveBeenCalledWith("fetch_latest_release");
    expect(pageFetch).not.toHaveBeenCalled();
  });

  it("shows the banner when a newer version is out", async () => {
    tauri.invoke.mockResolvedValue(release("v1.3.0"));
    await mount();
    expect(container.textContent).toContain("A new version of Vault Spend (1.3.0) is available.");
    expect(container.textContent).toContain("View release");
    expect(container.textContent).not.toContain("Update now");
  });

  it("stays hidden when the installed version is current", async () => {
    tauri.invoke.mockResolvedValue(release("v1.2.9"));
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
    tauri.invoke.mockResolvedValue(release("v1.3.0"));
    await mount();
    expect(container.textContent).toBe("");
  });

  it("uses the fixed official release page even if metadata supplies another URL", async () => {
    tauri.invoke.mockResolvedValue({ ...release("v1.3.0"), html_url: "https://example.invalid/installer" });
    await mount();
    const button = [...container.querySelectorAll("button")].find((b) => b.textContent === "View release")!;
    await act(async () => button.click());
    expect(tauri.openUrl).toHaveBeenCalledWith("https://github.com/OneTrueAsian/vault-spend/releases");
    expect(tauri.openPath).not.toHaveBeenCalled();
    expect(tauri.invoke.mock.calls.every(([command]) => command === "fetch_latest_release")).toBe(true);
  });
});
