// @vitest-environment jsdom
//
// Reports shell: the page title, Help link and the hub (ReportsOverview, tested on its own) with Comparisons wired in.
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { act } from "react";
import { createRoot, type Root } from "react-dom/client";

(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

const seen = vi.hoisted(() => ({ props: null as null | { initialTab?: string; onOpenBudget: () => void; renderComparisons: (active: boolean) => React.ReactNode } }));

vi.mock("./ReportsOverview", () => ({
  ReportsOverview: (props: NonNullable<typeof seen.props>) => {
    seen.props = props;
    return (
      <div data-reports-hub>
        <button type="button" data-open-budget onClick={props.onOpenBudget}>
          budget
        </button>
        <div data-comparisons-slot>{props.renderComparisons(true)}</div>
      </div>
    );
  },
}));

vi.mock("../comparisons/ComparisonsView", () => ({
  ComparisonsView: ({ active }: { active: boolean }) => <div data-comparisons-page data-active={String(active)}>comparisons page</div>,
}));

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

describe("ReportsView", () => {
  let container: HTMLDivElement;
  let root: Root;

  beforeEach(() => {
    seen.props = null;
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

  it("has one heading, and the hub below it", () => {
    show();

    expect(container.querySelectorAll("h1")).toHaveLength(1);
    expect(container.querySelector("h1")?.textContent).toBe("Reports");
    expect(container.querySelector("[data-reports-hub]")).not.toBeNull();
  });

  it("opens on Where income went unless told otherwise, and passes another tab through", () => {
    show();
    expect(seen.props?.initialTab).toBe("income");

    show({ initialTab: "comparisons" });
    expect(seen.props?.initialTab).toBe("comparisons");
  });

  it("hands the hub its original props", () => {
    show();
    act(() => container.querySelector<HTMLButtonElement>("[data-open-budget]")!.click());
    expect(baseProps.onOpenBudget).toHaveBeenCalledTimes(1);
  });

  it("draws the Comparisons page into the Comparisons tab, and tells it whether it is showing", () => {
    show();
    expect(container.querySelector("[data-comparisons-page]")?.getAttribute("data-active")).toBe("true");
  });

  it("offers the ? Help link only where the app can open Help", () => {
    show();
    expect(container.querySelector(".view-title-row button, .view-title-row a")).toBeNull();

    show({ onOpenHelp: vi.fn() });
    expect(container.querySelector(".view-title-row button, .view-title-row a")).not.toBeNull();
  });
});
