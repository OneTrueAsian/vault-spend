// @vitest-environment jsdom
//
// The gate shows the legal notice once per version, before the profile picker or any lock screen. It is a
// notice, not a click-through contract: one button, and nothing here can trap the person outside the app.
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { act } from "react";
import { createRoot, type Root } from "react-dom/client";

(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

const api = vi.hoisted(() => ({
  getLegalNoticeAcknowledgement: vi.fn(),
  acknowledgeLegalNotice: vi.fn(),
}));
vi.mock("./legalNoticeApi", () => api);
vi.mock("./legalNotice", async (importOriginal) => {
  const real = await importOriginal<typeof import("./legalNotice")>();
  return {
    ...real,
    bundledLegalNotice: {
      version: "2030-01-02",
      whatChanged: "Added a thing.",
      summary: [{ kind: "paragraph", text: "The short version." }],
      full: [
        { kind: "heading", level: 2, text: "1. About" },
        { kind: "paragraph", text: "The long version." },
      ],
    },
  };
});

import { LegalNoticeGate } from "./LegalNoticeGate";

describe("LegalNoticeGate", () => {
  let container: HTMLDivElement;
  let root: Root;

  beforeEach(() => {
    api.getLegalNoticeAcknowledgement.mockReset();
    api.acknowledgeLegalNotice.mockReset();
    api.acknowledgeLegalNotice.mockResolvedValue(undefined);
    container = document.createElement("div");
    document.body.append(container);
    root = createRoot(container);
  });

  afterEach(() => {
    act(() => root.unmount());
    container.remove();
  });

  async function mount() {
    await act(async () => {
      root.render(
        <LegalNoticeGate>
          <div data-app>the app</div>
        </LegalNoticeGate>,
      );
    });
  }

  const button = () => container.querySelector<HTMLButtonElement>("[data-legal-notice-ok]");

  it("renders nothing until the backend has answered", async () => {
    api.getLegalNoticeAcknowledgement.mockReturnValue(new Promise(() => {}));

    await mount();

    expect(container.innerHTML).toBe("");
  });

  it("shows the app untouched when this version was already acknowledged", async () => {
    api.getLegalNoticeAcknowledgement.mockResolvedValue({ version: "2030-01-02", acknowledged_at: "x", skip: false });

    await mount();

    expect(container.querySelector("[data-app]")).not.toBeNull();
    expect(container.querySelector("[data-legal-notice]")).toBeNull();
  });

  it("shows the notice, and not the app, on a first launch", async () => {
    api.getLegalNoticeAcknowledgement.mockResolvedValue({ version: null, acknowledged_at: null, skip: false });

    await mount();

    expect(container.querySelector("[data-legal-notice]")).not.toBeNull();
    expect(container.querySelector("[data-app]")).toBeNull();
    expect(container.textContent).toContain("The short version.");
    expect(container.textContent).toContain("The long version.");
  });

  it("does not show a what-changed line to someone who has never seen a notice", async () => {
    api.getLegalNoticeAcknowledgement.mockResolvedValue({ version: null, acknowledged_at: null, skip: false });

    await mount();

    expect(container.querySelector("[data-legal-notice-changed]")).toBeNull();
  });

  it("shows what changed to someone who acknowledged an older version", async () => {
    api.getLegalNoticeAcknowledgement.mockResolvedValue({ version: "2026-09-30", acknowledged_at: "x", skip: false });

    await mount();

    expect(container.querySelector("[data-legal-notice-changed]")?.textContent).toContain("Added a thing.");
  });

  it("records the bundled version and then shows the app when the button is pressed", async () => {
    api.getLegalNoticeAcknowledgement.mockResolvedValue({ version: null, acknowledged_at: null, skip: false });
    await mount();

    await act(async () => button()!.click());

    expect(api.acknowledgeLegalNotice).toHaveBeenCalledWith("2030-01-02");
    expect(container.querySelector("[data-app]")).not.toBeNull();
    expect(container.querySelector("[data-legal-notice]")).toBeNull();
  });

  it("lets the app through, without showing the notice, when an e2e run asks to skip it", async () => {
    api.getLegalNoticeAcknowledgement.mockResolvedValue({ version: null, acknowledged_at: null, skip: true });

    await mount();

    expect(container.querySelector("[data-app]")).not.toBeNull();
    expect(api.acknowledgeLegalNotice).not.toHaveBeenCalled();
  });

  it("lets the app through when the acknowledgement cannot be read", async () => {
    api.getLegalNoticeAcknowledgement.mockRejectedValue("the bridge is down");

    await mount();

    expect(container.querySelector("[data-app]")).not.toBeNull();
  });

  it("does not trap the person when the acknowledgement cannot be saved", async () => {
    api.getLegalNoticeAcknowledgement.mockResolvedValue({ version: null, acknowledged_at: null, skip: false });
    api.acknowledgeLegalNotice.mockRejectedValue("disk full");
    await mount();

    await act(async () => button()!.click());

    expect(container.querySelector("[data-legal-notice-problem]")?.textContent).toContain("disk full");
    expect(container.querySelector("[data-app]")).toBeNull();

    await act(async () => button()!.click());

    expect(container.querySelector("[data-app]")).not.toBeNull();
  });
});
