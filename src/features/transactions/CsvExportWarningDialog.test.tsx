// @vitest-environment jsdom
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { CsvExportWarningDialog } from "./CsvExportWarningDialog";

(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

// Phase C, Task 4 (plan v2 §4.11): a password-protected profile's CSV export
// asks first, since CSV carries no encryption of its own. This checks the
// dialog's exact required wording and that Cancel/Export anyway each call
// back exactly once — App.tsx's own gating (only showing this dialog when
// the active profile is protected) is a one-line condition with no App.tsx
// test harness in this codebase to exercise it against, so that part is
// covered by driving the real app instead.
describe("CsvExportWarningDialog", () => {
  let container: HTMLDivElement;
  let root: Root;
  const onCancel = vi.fn();
  const onConfirm = vi.fn();

  beforeEach(() => {
    onCancel.mockReset();
    onConfirm.mockReset();
    container = document.createElement("div");
    document.body.append(container);
    root = createRoot(container);
    act(() => {
      root.render(<CsvExportWarningDialog onCancel={onCancel} onConfirm={onConfirm} />);
    });
  });

  afterEach(() => {
    act(() => root.unmount());
    container.remove();
  });

  it("states plainly that CSV is not protected", () => {
    expect(document.body.textContent).toContain(
      "CSV files are not password protected. Anyone who can open the exported file can read this data.",
    );
  });

  it("cancels without exporting", () => {
    const cancelButton = [...document.querySelectorAll("button")].find((b) => b.textContent === "Cancel");
    act(() => cancelButton!.click());
    expect(onCancel).toHaveBeenCalledTimes(1);
    expect(onConfirm).not.toHaveBeenCalled();
  });

  it("proceeds with the export on explicit confirmation", () => {
    const confirmButton = [...document.querySelectorAll("button")].find((b) => b.textContent === "Export anyway");
    act(() => confirmButton!.click());
    expect(onConfirm).toHaveBeenCalledTimes(1);
    expect(onCancel).not.toHaveBeenCalled();
  });
});
