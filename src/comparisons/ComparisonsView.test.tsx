// @vitest-environment jsdom
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import type { ComparisonSetup, ComparisonsResponse, SaveResponse, SetupResponse } from "./types";
import { comparableIncome, hidden, response, unavailable } from "./testFixtures";
import { emptySetup, syncPeople } from "./setupDraft";

(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

const api = vi.hoisted(() => ({
  getComparisons: vi.fn(),
  getComparisonSetup: vi.fn(),
  saveComparisonSetup: vi.fn(),
  generation: 1 as number | null,
}));

vi.mock("./api", () => ({
  useGeneration: () => api.generation,
  getComparisons: api.getComparisons,
  getComparisonSetup: api.getComparisonSetup,
  saveComparisonSetup: api.saveComparisonSetup,
}));

import { ComparisonsView } from "./ComparisonsView";

function setupWithOwner(): ComparisonSetup {
  const s = syncPeople(emptySetup(), []);
  return { ...s, householdReferencePerson: { kind: "owner" } };
}

const setupResponse = (setup: ComparisonSetup | null, revision = 3): SetupResponse => ({ generation: 1, revision, setup, repairs: [] });

async function flush() {
  await act(async () => {
    await Promise.resolve();
    await Promise.resolve();
  });
}

describe("ComparisonsView", () => {
  let container: HTMLDivElement;
  let root: Root;

  beforeEach(() => {
    api.getComparisons.mockReset();
    api.getComparisonSetup.mockReset();
    api.saveComparisonSetup.mockReset();
    api.generation = 1;
    container = document.createElement("div");
    document.body.append(container);
    root = createRoot(container);
  });
  afterEach(() => {
    act(() => root.unmount());
    container.remove();
  });

  const mount = async (props: Partial<React.ComponentProps<typeof ComparisonsView>> = {}) => {
    act(() => root.render(<ComparisonsView {...props} />));
    await flush();
  };
  const q = (sel: string) => container.querySelector<HTMLElement>(sel);
  const all = (sel: string) => [...container.querySelectorAll<HTMLElement>(sel)];
  const loads = (r: ComparisonsResponse, setup: ComparisonSetup | null = setupWithOwner(), revision = r.setupRevision) => {
    api.getComparisons.mockResolvedValue(r);
    api.getComparisonSetup.mockResolvedValue(setupResponse(setup, revision));
  };

  it("shows a loading message and no cards until the first read arrives", async () => {
    let release: (r: ComparisonsResponse) => void = () => {};
    api.getComparisons.mockReturnValue(new Promise<ComparisonsResponse>((res) => (release = res)));
    api.getComparisonSetup.mockResolvedValue(setupResponse(setupWithOwner()));
    await mount();

    expect(q("[data-cmp-loading]")).not.toBeNull();
    expect(all("[data-metric]")).toHaveLength(0);

    release(response({}, [comparableIncome()]));
    await flush();
    expect(q("[data-cmp-loading]")).toBeNull();
    expect(all("[data-metric]")).toHaveLength(1);
  });

  it("does nothing until the profile generation is known", async () => {
    api.generation = null;
    await mount();
    expect(api.getComparisons).not.toHaveBeenCalled();
  });

  it("waits to load while its tab is hidden, then loads when shown", async () => {
    loads(response({}, [comparableIncome()]));
    await mount({ active: false });
    expect(api.getComparisons).not.toHaveBeenCalled();
    await mount({ active: true });
    expect(api.getComparisons).toHaveBeenCalledTimes(1);
  });

  it("refreshes when the ledger data changes under it", async () => {
    loads(response({}, [comparableIncome()]));
    await mount({ accounts: [] });
    await mount({ accounts: [] });
    expect(api.getComparisons).toHaveBeenCalledTimes(2);
  });

  it("hides cards that only lack the person's input but keeps benchmark gaps visible", async () => {
    loads(response({}, [unavailable("spending"), hidden("investments"), comparableIncome(), hidden("savings"), hidden("debt")]));
    await mount();

    expect(all("[data-metric]").map((c) => c.dataset.metric)).toEqual(["spending", "income"]);
    expect(q("[data-cmp-hidden-note]")?.textContent).toContain("3 comparisons are hidden");
    expect(q("[data-cmp-hidden-note]")?.textContent).not.toContain("Settings");
    expect(q("[data-cmp-hidden-note] button")?.textContent).toBe("Show your details");
  });

  describe("your details panel", () => {
    const toggle = () => q("[data-cmp-details-toggle]") as HTMLButtonElement;
    const type = (el: HTMLInputElement, value: string) =>
      act(() => {
        Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, "value")!.set!.call(el, value);
        el.dispatchEvent(new Event("input", { bubbles: true }));
      });

    it("holds the number-entry form under the cards, collapsed when every card can be shown", async () => {
      loads(response({}, [comparableIncome()]));
      await mount();
      expect(q("[data-cmp-details-panel] [data-cmp-settings]")).not.toBeNull();
      expect(toggle().textContent).toContain("Your details");
      expect(toggle().getAttribute("aria-expanded")).toBe("false");
      expect((q("[data-cmp-details-body]") as HTMLElement).hidden).toBe(true);
    });

    it("opens by itself when a card is waiting for details", async () => {
      loads(response({}, [comparableIncome(), hidden("savings")]));
      await mount();
      expect(toggle().getAttribute("aria-expanded")).toBe("true");
      expect((q("[data-cmp-details-body]") as HTMLElement).hidden).toBe(false);
    });

    it("opens and closes from its header", async () => {
      loads(response({}, [comparableIncome()]));
      await mount();
      act(() => toggle().click());
      expect(toggle().getAttribute("aria-expanded")).toBe("true");
      act(() => toggle().click());
      expect(toggle().getAttribute("aria-expanded")).toBe("false");
    });

    it("opens from the hidden-cards note after it was closed", async () => {
      loads(response({}, [comparableIncome(), hidden("savings")]));
      await mount();
      act(() => toggle().click());
      expect(toggle().getAttribute("aria-expanded")).toBe("false");
      act(() => q("[data-cmp-hidden-note] button")!.click());
      expect(toggle().getAttribute("aria-expanded")).toBe("true");
    });

    it("opens from the saved-details notice", async () => {
      loads(response({ repairs: [{ kind: "missing_person", field: "x", person: { kind: "member", id: 9 } }] }, [comparableIncome()]));
      await mount();
      expect(q("[data-cmp-repairs]")?.textContent).not.toContain("Settings");
      act(() => q("[data-cmp-repairs] button")!.click());
      expect(toggle().getAttribute("aria-expanded")).toBe("true");
    });

    it("opens after first-use setup when the new cards are waiting for details", async () => {
      loads(response({ configured: false, setupRevision: 0, report: null }), null);
      await mount();
      expect(q("[data-cmp-details-panel]")).toBeNull();
      loads(response({}, [hidden("income"), hidden("savings")]));
      act(() => q("[data-cmp-start-setup]")!.click());
      // The setup dialog saves and the page re-reads; emulate that re-read directly.
      await act(async () => {
        api.generation = 2;
        await Promise.resolve();
      });
      act(() => root.render(<ComparisonsView accounts={[]} />));
      await flush();
      expect(toggle().getAttribute("aria-expanded")).toBe("true");
    });

    it("is absent until comparisons have been set up", async () => {
      loads(response({ configured: false, setupRevision: 0, report: null }), null);
      await mount();
      expect(q("[data-cmp-details-panel]")).toBeNull();
    });

    it("refreshes the cards as soon as the form is saved", async () => {
      loads(response({}, [comparableIncome()]));
      api.saveComparisonSetup.mockImplementation(async (_g: number, _r: number, setup: ComparisonSetup) => ({ status: "saved", revision: 4, setup }) satisfies SaveResponse);
      await mount();
      act(() => toggle().click());
      const before = api.getComparisons.mock.calls.length;
      type(q("input[aria-label='Household income per year']") as HTMLInputElement, "85000");
      act(() => (q("[data-cmp-settings-save]") as HTMLButtonElement).click());
      await flush();
      expect(api.saveComparisonSetup).toHaveBeenCalledTimes(1);
      expect(api.getComparisons.mock.calls.length).toBe(before + 1);
    });
  });

  it("has no mode switch, person selector or settings button on the page", async () => {
    loads(response({}, [comparableIncome()]));
    await mount();
    expect(q("[data-cmp-person-bar]")).toBeNull();
    expect(all("button").map((b) => b.textContent)).not.toContain("Comparison settings");
    expect(all("[role='switch'], [data-cmp-mode-switch]")).toHaveLength(0);
  });

  it("shows the first-use setup prompt when nothing is configured", async () => {
    loads(response({ configured: false, setupRevision: 0, report: null }), null);
    await mount();

    expect(q("[data-cmp-unconfigured]")).not.toBeNull();
    act(() => q("[data-cmp-start-setup]")!.click());
    expect(document.querySelector("[data-cmp-setup]")).not.toBeNull();
  });

  it("reports a failed load with a retry that does not show stale cards as new", async () => {
    api.getComparisons.mockRejectedValue("The active profile changed before this finished.");
    api.getComparisonSetup.mockResolvedValue(setupResponse(null));
    await mount();

    expect(q("[data-cmp-error]")?.textContent).toContain("changed before this finished");
    expect(all("[data-metric]")).toHaveLength(0);
    api.getComparisons.mockResolvedValue(response({}, [comparableIncome()]));
    act(() => q("[data-cmp-error] button")!.click());
    await flush();
    expect(q("[data-cmp-error]")).toBeNull();
    expect(all("[data-metric]")).toHaveLength(1);
  });

  it("explains a benchmark package that failed to load without touching the setup", async () => {
    loads(response({ packageError: "benchmark package is invalid", report: null }));
    await mount();
    expect(q("[data-cmp-package-error]")).not.toBeNull();
    expect(all("[data-metric]")).toHaveLength(0);
  });

  it("mentions saved details that point at deleted people or accounts", async () => {
    loads(response({ repairs: [{ kind: "missing_person", field: "x", person: { kind: "member", id: 9 } }] }, [comparableIncome()]));
    await mount();
    expect(q("[data-cmp-repairs]")).not.toBeNull();
  });

  it("re-reads when the setup changed between the two calls", async () => {
    api.getComparisons.mockResolvedValueOnce(response({ setupRevision: 3 }, [comparableIncome()]));
    api.getComparisonSetup.mockResolvedValueOnce(setupResponse(setupWithOwner(), 4));
    api.getComparisons.mockResolvedValue(response({ setupRevision: 4 }, [comparableIncome()]));
    api.getComparisonSetup.mockResolvedValue(setupResponse(setupWithOwner(), 4));
    await mount();
    await flush();
    expect(api.getComparisons).toHaveBeenCalledTimes(2);
    expect(all("[data-metric]")).toHaveLength(1);
  });

  it("opens the details for a card", async () => {
    loads(response({}, [comparableIncome()]));
    await mount();
    act(() => q(".cmp-explore")!.click());
    expect(document.querySelector("[data-cmp-details='income']")).not.toBeNull();
  });

  it("saves a remembered population choice against the revision it read", async () => {
    loads(response({}, [comparableIncome({ universeOptions: ["all", "holders"] })]));
    api.saveComparisonSetup.mockResolvedValue({ status: "saved", revision: 4, setup: setupWithOwner() } satisfies SaveResponse);
    await mount();
    act(() => q("[data-cmp-universe='holders']")!.click());
    await flush();

    expect(api.saveComparisonSetup).toHaveBeenCalledTimes(1);
    const [generation, revision, saved] = api.saveComparisonSetup.mock.calls[0];
    expect([generation, revision]).toEqual([1, 3]);
    expect((saved as ComparisonSetup).universePreferences).toEqual([{ metric: "income", universe: "holders" }]);
  });

  it("tells the person and refreshes when a save loses a race", async () => {
    loads(response({}, [comparableIncome({ universeOptions: ["all", "holders"] })]));
    api.saveComparisonSetup.mockResolvedValue({ status: "conflict", currentRevision: 9 } satisfies SaveResponse);
    await mount();
    act(() => q("[data-cmp-universe='holders']")!.click());
    await flush();
    expect(container.textContent).toContain("changed somewhere else");
    expect(api.getComparisons.mock.calls.length).toBeGreaterThanOrEqual(2);
  });
});
