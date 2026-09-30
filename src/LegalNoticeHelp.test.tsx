// @vitest-environment jsdom
//
// Help's entry for the legal notice: the full text to re-read, its version, and when this computer
// acknowledged it.
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { act } from "react";
import { createRoot, type Root } from "react-dom/client";

(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

const api = vi.hoisted(() => ({ getLegalNoticeAcknowledgement: vi.fn(), acknowledgeLegalNotice: vi.fn() }));
vi.mock("./legalNoticeApi", () => api);

import { bundledLegalNotice } from "./legalNotice";
import { LegalNoticeHelp } from "./LegalNoticeHelp";

describe("LegalNoticeHelp", () => {
  let container: HTMLDivElement;
  let root: Root;

  beforeEach(() => {
    api.getLegalNoticeAcknowledgement.mockReset();
    container = document.createElement("div");
    document.body.append(container);
    root = createRoot(container);
  });

  afterEach(() => {
    act(() => root.unmount());
    container.remove();
  });

  async function mount() {
    await act(async () => root.render(<LegalNoticeHelp />));
  }

  it("shows the bundled version and the full notice text", async () => {
    api.getLegalNoticeAcknowledgement.mockResolvedValue({ version: null, acknowledged_at: null, skip: false });

    await mount();

    expect(container.textContent).toContain(`Version ${bundledLegalNotice.version}`);
    expect(container.textContent).toContain("Limitation of Liability");
    expect(container.textContent).toContain("fonts.googleapis.com");
  });

  it("says when this computer acknowledged the current version", async () => {
    api.getLegalNoticeAcknowledgement.mockResolvedValue({
      version: bundledLegalNotice.version,
      acknowledged_at: "2026-09-30T17:00:00+00:00",
      skip: false,
    });

    await mount();

    expect(container.querySelector("[data-legal-notice-status]")?.textContent).toMatch(/Acknowledged on .*2026/);
  });

  it("does not claim an older version's acknowledgement covers the current one", async () => {
    api.getLegalNoticeAcknowledgement.mockResolvedValue({ version: "2020-01-01", acknowledged_at: "2020-01-02T00:00:00+00:00", skip: false });

    await mount();

    expect(container.querySelector("[data-legal-notice-status]")?.textContent).not.toMatch(/^Acknowledged/);
    expect(container.querySelector("[data-legal-notice-status]")?.textContent).toContain("2020-01-01");
  });

  it("still shows the notice when the acknowledgement cannot be read", async () => {
    api.getLegalNoticeAcknowledgement.mockRejectedValue("the bridge is down");

    await mount();

    expect(container.textContent).toContain("Limitation of Liability");
    expect(container.querySelector("[data-legal-notice-status]")).toBeNull();
  });
});
