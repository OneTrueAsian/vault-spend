// @vitest-environment jsdom
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { ChooseImportAccountDialog } from "./ChooseImportAccountDialog";
import type { Account } from "../../shared/lib/types";

(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

describe("ChooseImportAccountDialog", () => {
  let container: HTMLDivElement;
  let root: Root;
  const onCancel = vi.fn();
  const onChoose = vi.fn();
  const onNewAccount = vi.fn();
  const accounts = [
    { id: 1, name: "Checking" },
    { id: 2, name: "Amex Blue" },
  ] as Account[];
  const button = (label: string) => [...document.querySelectorAll("button")].find((b) => b.textContent?.trim() === label)!;
  const trigger = () => document.querySelector<HTMLButtonElement>("[data-import-account]")!;
  const option = (label: string) => [...document.querySelectorAll<HTMLElement>("[role='menuitemradio']")].find((o) => o.textContent?.includes(label))!;

  function show(list: Account[] = accounts) {
    act(() => {
      root.render(<ChooseImportAccountDialog accounts={list} onCancel={onCancel} onChoose={onChoose} onNewAccount={onNewAccount} />);
    });
  }

  beforeEach(() => {
    onCancel.mockReset();
    onChoose.mockReset();
    onNewAccount.mockReset();
    container = document.createElement("div");
    document.body.append(container);
    root = createRoot(container);
  });

  afterEach(() => {
    act(() => root.unmount());
    container.remove();
  });

  it("asks which account the file is from, with nothing chosen and Continue unavailable", () => {
    show();
    expect(document.body.textContent).toContain("Which account are these transactions from?");
    expect(trigger().dataset.value).toBe("");
    expect(trigger().textContent).toContain("Choose an account");
    expect((button("Continue") as HTMLButtonElement).disabled).toBe(true);
    act(() => button("Continue").click());
    expect(onChoose).not.toHaveBeenCalled();
  });

  it("lists every account in one dropdown, with a new-account choice last", () => {
    show();
    act(() => trigger().click());
    const labels = [...document.querySelectorAll("[role='menuitemradio']")].map((o) => o.textContent?.trim());
    expect(labels).toEqual(["Checking", "Amex Blue", "+ New account"]);
  });

  it("continues with the account that was picked", () => {
    show();
    act(() => trigger().click());
    act(() => option("Amex Blue").click());
    expect(trigger().textContent).toContain("Amex Blue");
    act(() => button("Continue").click());
    expect(onChoose).toHaveBeenCalledWith(2);
  });

  it("cancels without choosing", () => {
    show();
    act(() => button("Cancel").click());
    expect(onCancel).toHaveBeenCalledTimes(1);
    expect(onChoose).not.toHaveBeenCalled();
  });

  it("offers to add an account", () => {
    show();
    act(() => trigger().click());
    act(() => option("+ New account").click());
    expect(onNewAccount).toHaveBeenCalledTimes(1);
    expect(onChoose).not.toHaveBeenCalled();
  });
});
