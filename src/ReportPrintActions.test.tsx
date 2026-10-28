// @vitest-environment jsdom
//
// The Reports page's three output buttons. "Save as PDF" writes the file through the app's own Save window
// (which asks before replacing a file), so it is separate from "Print", which opens the system print window.
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { act } from "react";
import { createRoot, type Root } from "react-dom/client";

(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

import { ReportPrintActions } from "./ReportPrintActions";

describe("ReportPrintActions", () => {
  let container: HTMLDivElement;
  let root: Root;
  const onExportCsv = vi.fn();
  const onPrint = vi.fn();
  const onSavePdf = vi.fn();

  beforeEach(() => {
    vi.resetAllMocks();
    container = document.createElement("div");
    document.body.append(container);
    root = createRoot(container);
  });

  afterEach(() => {
    act(() => root.unmount());
    container.remove();
  });

  const labels = () => [...container.querySelectorAll("button")].map((b) => b.textContent);
  const press = (label: string) => act(() => [...container.querySelectorAll("button")].find((b) => b.textContent === label)!.click());

  it("offers Export CSV, Print and Save as PDF, and leaves them out of a printout", () => {
    act(() => root.render(<ReportPrintActions onExportCsv={onExportCsv} onPrint={onPrint} onSavePdf={onSavePdf} />));

    expect(labels()).toEqual(["Export CSV", "Print", "Save as PDF"]);
    expect(container.querySelector(".page-actions")?.classList.contains("no-print")).toBe(true);
  });

  it("sends each button to its own action", () => {
    act(() => root.render(<ReportPrintActions onExportCsv={onExportCsv} onPrint={onPrint} onSavePdf={onSavePdf} />));

    press("Print");
    press("Save as PDF");
    press("Export CSV");

    expect(onPrint).toHaveBeenCalledTimes(1);
    expect(onSavePdf).toHaveBeenCalledTimes(1);
    expect(onExportCsv).toHaveBeenCalledTimes(1);
  });

  it("keeps the old single 'Print / Save as PDF' button where Save as PDF is not available", () => {
    act(() => root.render(<ReportPrintActions onExportCsv={onExportCsv} onPrint={onPrint} />));

    expect(labels()).toEqual(["Export CSV", "Print / Save as PDF"]);
  });
});
