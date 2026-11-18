// @vitest-environment jsdom
//
// VS-31 step 0 (F1): the tab strip Reports uses, shared so Cash Flow and Investments can use it too.
// Same behavior as Reports' own strip: roving tab stop, arrow/Home/End keys, a panel mounts the first
// time it is opened and then stays mounted (hidden) so it keeps its state.
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { act, useEffect, useState } from "react";
import { createRoot, type Root } from "react-dom/client";
import { PageTabs } from "./PageTabs";

(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

type Id = "forecast" | "months" | "debt";
const TABS: { id: Id; label: string }[] = [
  { id: "forecast", label: "Forecast" },
  { id: "months", label: "Month by month" },
  { id: "debt", label: "Debt payoff" },
];

const mounts: Record<string, number> = {};
const activeSeen: Record<string, boolean[]> = {};

function Panel({ id, active }: { id: Id; active: boolean }) {
  const [count, setCount] = useState(0);
  useEffect(() => {
    mounts[id] = (mounts[id] ?? 0) + 1;
  }, [id]);
  (activeSeen[id] ??= []).push(active);
  return (
    <button type="button" data-counter={id} onClick={() => setCount(count + 1)}>
      {id} {count}
    </button>
  );
}

let host: HTMLDivElement;
let root: Root;

beforeEach(() => {
  for (const k of Object.keys(mounts)) delete mounts[k];
  for (const k of Object.keys(activeSeen)) delete activeSeen[k];
  host = document.createElement("div");
  document.body.appendChild(host);
  root = createRoot(host);
});

afterEach(() => {
  act(() => root.unmount());
  host.remove();
});

const show = (initial: Id = "forecast") =>
  act(() =>
    root.render(
      <PageTabs
        tabs={TABS}
        initial={initial}
        idPrefix="cashflow"
        label="Cash flow sections"
        className="cashflow-tabs no-print"
        panelClassName="cashflow-panel"
        render={(id, active) => <Panel id={id} active={active} />}
      />,
    ),
  );
const tab = (name: string) => [...host.querySelectorAll<HTMLButtonElement>("[role='tab']")].find((t) => t.textContent === name)!;
const panel = (name: string) => host.querySelector<HTMLElement>(`[role='tabpanel'][aria-labelledby='${tab(name).id}']`)!;
const press = (el: HTMLElement, key: string) => act(() => el.dispatchEvent(new KeyboardEvent("keydown", { key, bubbles: true })));

describe("PageTabs", () => {
  it("renders a labelled tablist with one tab per entry, in order", () => {
    show();
    const list = host.querySelector("[role='tablist']")!;
    expect(list.getAttribute("aria-label")).toBe("Cash flow sections");
    expect(list.className).toBe("view-toggle cashflow-tabs no-print");
    expect([...host.querySelectorAll("[role='tab']")].map((t) => t.textContent)).toEqual(["Forecast", "Month by month", "Debt payoff"]);
  });

  it("names tabs and panels from the prefix and wires each tab to its panel", () => {
    show();
    expect(tab("Forecast").id).toBe("cashflow-tab-forecast");
    expect(tab("Forecast").getAttribute("data-cashflow-tab")).toBe("forecast");
    expect(panel("Forecast").id).toBe("cashflow-panel-forecast");
    expect(panel("Forecast").className).toBe("cashflow-panel");
    for (const t of TABS) expect(tab(t.label).getAttribute("aria-controls")).toBe(panel(t.label).id);
  });

  it("opens on the initial tab and mounts only that panel", () => {
    show("months");
    expect(tab("Month by month").getAttribute("aria-selected")).toBe("true");
    expect(tab("Month by month").className).toBe("view-toggle-active");
    expect(tab("Forecast").className).toBe("");
    expect(panel("Month by month").hidden).toBe(false);
    expect(panel("Forecast").hidden).toBe(true);
    expect(mounts).toEqual({ months: 1 });
  });

  it("mounts a panel when first opened and keeps it mounted with its state", () => {
    show();
    act(() => host.querySelector<HTMLButtonElement>("[data-counter='forecast']")!.click());
    act(() => tab("Debt payoff").click());
    expect(mounts.debt).toBe(1);
    expect(panel("Forecast").hidden).toBe(true);
    act(() => tab("Forecast").click());
    expect(mounts.forecast).toBe(1);
    expect(host.querySelector("[data-counter='forecast']")?.textContent).toBe("forecast 1");
  });

  it("tells each panel whether it is the one showing", () => {
    show();
    act(() => tab("Debt payoff").click());
    expect(activeSeen.debt.at(-1)).toBe(true);
    expect(activeSeen.forecast.at(-1)).toBe(false);
  });

  it("keeps a single roving tab stop on the selected tab", () => {
    show();
    expect(TABS.map((t) => tab(t.label).tabIndex)).toEqual([0, -1, -1]);
    act(() => tab("Debt payoff").click());
    expect(TABS.map((t) => tab(t.label).tabIndex)).toEqual([-1, -1, 0]);
  });

  it("moves selection and focus with arrow, Home and End keys, wrapping at the ends", () => {
    show();
    press(tab("Forecast"), "ArrowRight");
    expect(tab("Month by month").getAttribute("aria-selected")).toBe("true");
    expect(document.activeElement).toBe(tab("Month by month"));
    press(tab("Month by month"), "End");
    expect(tab("Debt payoff").getAttribute("aria-selected")).toBe("true");
    press(tab("Debt payoff"), "ArrowRight");
    expect(tab("Forecast").getAttribute("aria-selected")).toBe("true");
    press(tab("Forecast"), "ArrowLeft");
    expect(tab("Debt payoff").getAttribute("aria-selected")).toBe("true");
    press(tab("Debt payoff"), "Home");
    expect(tab("Forecast").getAttribute("aria-selected")).toBe("true");
    expect(document.activeElement).toBe(tab("Forecast"));
  });

  it("ignores other keys", () => {
    show();
    press(tab("Forecast"), "a");
    expect(tab("Forecast").getAttribute("aria-selected")).toBe("true");
  });
});


describe("controlled PageTabs", () => {
  it("uses the parent's selection, requests click/key changes, and mounts each panel only when selected", () => {
    const onSelect = vi.fn();
    const controlled = (selected: Id) => act(() => root.render(
      <PageTabs tabs={TABS} initial="forecast" selected={selected} onSelect={onSelect} idPrefix="cashflow" label="Sections" render={(id, active) => <Panel id={id} active={active} />} />,
    ));
    controlled("months");
    expect(panel("Month by month").hidden).toBe(false);
    expect(mounts).toEqual({ months: 1 });
    act(() => tab("Debt payoff").click());
    expect(onSelect).toHaveBeenLastCalledWith("debt");
    expect(panel("Month by month").hidden).toBe(false);
    expect(mounts.debt).toBeUndefined();
    press(tab("Month by month"), "ArrowRight");
    expect(onSelect).toHaveBeenLastCalledWith("debt");
    expect(panel("Month by month").hidden).toBe(false);
    controlled("debt");
    expect(panel("Debt payoff").hidden).toBe(false);
    expect(mounts).toEqual({ months: 1, debt: 1 });
    controlled("months");
    expect(mounts).toEqual({ months: 1, debt: 1 });
  });
});
