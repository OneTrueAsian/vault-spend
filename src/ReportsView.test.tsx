// @vitest-environment jsdom
//
// Reports shell: an Overview tab (the existing report page, unchanged) and a Comparisons tab.
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { act } from "react";
import { createRoot, type Root } from "react-dom/client";

(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

const mounts = vi.hoisted(() => ({ overview: 0, comparisons: 0, overviewSeen: [] as string[] }));

vi.mock("./ReportsOverview", async () => {
  const React = await import("react");
  return {
    ReportsOverview: (props: { onOpenBudget: () => void }) => {
      React.useEffect(() => {
        mounts.overview += 1;
      }, []);
      const [count, setCount] = React.useState(0);
      mounts.overviewSeen.push(String(count));
      return (
        <div data-reports-hub>
          <button type="button" data-overview-counter onClick={() => setCount(count + 1)}>
            count {count}
          </button>
          <button type="button" data-open-budget onClick={props.onOpenBudget}>
            budget
          </button>
        </div>
      );
    },
  };
});

vi.mock("./comparisons/ComparisonsView", async () => {
  const React = await import("react");
  return {
    ComparisonsView: () => {
      React.useEffect(() => {
        mounts.comparisons += 1;
      }, []);
      return <div data-comparisons-page>comparisons page</div>;
    },
  };
});

import { ReportsView } from "./ReportsView";

const baseProps = {
  accounts: [],
  transactions: [],
  assets: [],
  familyMembers: [],
  onExportCsv: vi.fn(),
  onPrint: vi.fn(),
  onOpenBudget: vi.fn(),
  layoutWidgets: [],
  onPinWidget: vi.fn(),
};

describe("ReportsView tabs", () => {
  let container: HTMLDivElement;
  let root: Root;

  beforeEach(() => {
    mounts.overview = 0;
    mounts.comparisons = 0;
    mounts.overviewSeen = [];
    baseProps.onOpenBudget.mockReset();
    container = document.createElement("div");
    document.body.append(container);
    root = createRoot(container);
  });

  afterEach(() => {
    act(() => root.unmount());
    container.remove();
  });

  const show = (props: Partial<React.ComponentProps<typeof ReportsView>> = {}) =>
    act(() => {
      root.render(<ReportsView {...baseProps} {...props} />);
    });
  const tab = (name: string) => [...container.querySelectorAll<HTMLButtonElement>("[role='tab']")].find((t) => t.textContent === name)!;
  const panel = (name: string) => container.querySelector<HTMLElement>(`[role='tabpanel'][aria-labelledby='${tab(name).id}']`)!;
  const press = (el: HTMLElement, key: string) => act(() => el.dispatchEvent(new KeyboardEvent("keydown", { key, bubbles: true })));

  it("has one heading and an accessible tablist with Overview and Comparisons", () => {
    show();

    expect(container.querySelectorAll("h1")).toHaveLength(1);
    expect(container.querySelector("h1")?.textContent).toBe("Reports");
    expect(container.querySelector("[role='tablist']")?.getAttribute("aria-label")).toBeTruthy();
    expect([...container.querySelectorAll("[role='tab']")].map((t) => t.textContent)).toEqual(["Overview", "Comparisons"]);
  });

  it("opens on Overview, so the existing report is what people see first", () => {
    show();

    expect(tab("Overview").getAttribute("aria-selected")).toBe("true");
    expect(tab("Comparisons").getAttribute("aria-selected")).toBe("false");
    expect(panel("Overview").hidden).toBe(false);
    expect(panel("Comparisons").hidden).toBe(true);
    expect(container.querySelector("[data-reports-hub]")).not.toBeNull();
  });

  it("does not mount Comparisons until it is first opened", () => {
    show();
    expect(mounts.comparisons).toBe(0);
    expect(container.querySelector("[data-comparisons-page]")).toBeNull();

    act(() => tab("Comparisons").click());

    expect(mounts.comparisons).toBe(1);
    expect(panel("Comparisons").hidden).toBe(false);
    expect(panel("Overview").hidden).toBe(true);
  });

  it("keeps Overview mounted and its state while Comparisons is showing", () => {
    show();
    act(() => container.querySelector<HTMLButtonElement>("[data-overview-counter]")!.click());
    act(() => tab("Comparisons").click());
    act(() => tab("Overview").click());

    expect(mounts.overview).toBe(1);
    expect(container.querySelector("[data-overview-counter]")?.textContent).toBe("count 1");
  });

  it("only moves the roving tab stop to the selected tab", () => {
    show();

    expect(tab("Overview").tabIndex).toBe(0);
    expect(tab("Comparisons").tabIndex).toBe(-1);
    act(() => tab("Comparisons").click());
    expect(tab("Overview").tabIndex).toBe(-1);
    expect(tab("Comparisons").tabIndex).toBe(0);
  });

  it("wires each tab to its panel", () => {
    show();
    for (const name of ["Overview", "Comparisons"]) {
      expect(tab(name).getAttribute("aria-controls")).toBe(panel(name).id);
    }
  });

  it("supports arrow, Home and End keys and moves focus with the selection", () => {
    show();

    press(tab("Overview"), "ArrowRight");
    expect(tab("Comparisons").getAttribute("aria-selected")).toBe("true");
    expect(document.activeElement).toBe(tab("Comparisons"));
    press(tab("Comparisons"), "ArrowRight");
    expect(tab("Overview").getAttribute("aria-selected")).toBe("true");
    press(tab("Overview"), "ArrowLeft");
    expect(tab("Comparisons").getAttribute("aria-selected")).toBe("true");
    press(tab("Comparisons"), "Home");
    expect(tab("Overview").getAttribute("aria-selected")).toBe("true");
    press(tab("Overview"), "End");
    expect(tab("Comparisons").getAttribute("aria-selected")).toBe("true");
  });

  it("ignores unrelated keys", () => {
    show();
    press(tab("Overview"), "a");
    expect(tab("Overview").getAttribute("aria-selected")).toBe("true");
  });

  it("never fetches or mounts Overview when opened directly on Comparisons", () => {
    show({ initialTab: "comparisons" });

    expect(mounts.overview).toBe(0);
    expect(mounts.comparisons).toBe(1);
    expect(tab("Comparisons").getAttribute("aria-selected")).toBe("true");

    act(() => tab("Overview").click());
    expect(mounts.overview).toBe(1);
  });

  it("hands the Overview its original props", () => {
    show();
    act(() => container.querySelector<HTMLButtonElement>("[data-open-budget]")!.click());
    expect(baseProps.onOpenBudget).toHaveBeenCalledTimes(1);
  });

  it("starts on Overview again after the profile remounts it", () => {
    show();
    act(() => tab("Comparisons").click());
    act(() => root.unmount());
    root = createRoot(container);
    show();

    expect(tab("Overview").getAttribute("aria-selected")).toBe("true");
  });

  it("keeps the report's export and print controls out of the Comparisons tab", () => {
    show();
    act(() => tab("Comparisons").click());
    const visible = [...container.querySelectorAll<HTMLElement>("[role='tabpanel']")].filter((p) => !p.hidden);
    expect(visible).toHaveLength(1);
    expect(visible[0].querySelector("[data-reports-hub]")).toBeNull();
  });
});
