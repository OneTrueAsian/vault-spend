// @vitest-environment jsdom
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { StatementTeachDialog, MAX_ATTEMPTS } from "./StatementTeachDialog";

const lines = [
  { index: 0, page: 0, text: "Riverbend Mutual Bank" },
  { index: 1, page: 0, text: "Opening balance 1,250.00" },
  { index: 2, page: 0, text: "03/08/2026 Supermarket purchase 54.20" },
  { index: 3, page: 0, text: "Closing balance 3,132.00" },
];
let container: HTMLDivElement;
let root: Root;
const word = (line: number, text: string) =>
  [...document.querySelectorAll<HTMLButtonElement>(`[data-line="${line}"]`)].find((b) => b.textContent === text)!;

describe("StatementTeachDialog", () => {
  beforeEach(() => { container = document.createElement("div"); document.body.appendChild(container); root = createRoot(container); });
  afterEach(() => { act(() => root.unmount()); container.remove(); });

  it("collects one click per step and sends character positions", async () => {
    const onTeach = vi.fn();
    await act(async () => root.render(<StatementTeachDialog lines={lines} kind="cash" attempts={0} busy={false} error={null} needs={{ rows: true, holdings: false }} onTeach={onTeach} onBack={() => {}} onGiveUp={() => {}} />));
    expect(document.body.textContent).toContain("Click the date of one transaction.");
    await act(async () => word(2, "03/08/2026").click());
    await act(async () => word(2, "54.20").click());
    await act(async () => word(1, "1,250.00").click());
    await act(async () => word(3, "3,132.00").click());
    await act(async () => document.querySelector<HTMLButtonElement>("[data-teach-submit]")!.click());
    expect(onTeach).toHaveBeenCalledWith({
      rows: [{ date: { line: 2, start: 0 }, amount: { line: 2, start: 32 } }],
      balances: { kind: "start_end", start: { line: 1, start: 16 }, end: { line: 3, start: 16 } },
      holdings: [],
    });
  });

  it("stops offering more examples after three tries", async () => {
    await act(async () => root.render(<StatementTeachDialog lines={lines} kind="cash" attempts={MAX_ATTEMPTS} busy={false} error={null} needs={{ rows: true, holdings: false }} onTeach={() => {}} onBack={() => {}} onGiveUp={() => {}} />));
    expect(document.body.textContent).toContain("The app still can't read this statement.");
    expect(document.querySelector("[data-teach-submit]")).toBeNull();
  });

  it("starts the kinds still being taught over after a try and keeps the marks for kinds that already worked", async () => {
    const onTeach = vi.fn();
    const both = [...lines, { index: 4, page: 1, text: "ABCD Alpha Fund 10.000 25.0000 250.00" }, { index: 5, page: 1, text: "Total Account Holdings 250.00" }];
    const render = (attempts: number, needs: { rows: boolean; holdings: boolean }) =>
      root.render(<StatementTeachDialog lines={both} kind="cash" attempts={attempts} busy={false} error={null} needs={needs} onTeach={onTeach} onBack={() => {}} onGiveUp={() => {}} />);
    await act(async () => render(0, { rows: true, holdings: true }));
    await act(async () => word(2, "03/08/2026").click());
    await act(async () => word(2, "54.20").click());
    await act(async () => word(1, "1,250.00").click());
    await act(async () => word(3, "3,132.00").click());
    await act(async () => word(4, "ABCD").click());
    await act(async () => word(4, "10.000").click());
    await act(async () => word(4, "25.0000").click());
    await act(async () => word(4, "250.00").click());
    await act(async () => word(5, "250.00").click());
    await act(async () => document.querySelector<HTMLButtonElement>("[data-teach-submit]")!.click());
    expect(onTeach).toHaveBeenCalledTimes(1);
    // The rows worked; only the holdings still need teaching.
    await act(async () => render(1, { rows: false, holdings: true }));
    expect(document.body.textContent).toContain("That still doesn't add up. Show the app one more example.");
    expect(document.body.textContent).toContain("Click the symbol of one holding.");
    await act(async () => word(4, "ABCD").click());
    await act(async () => word(4, "10.000").click());
    await act(async () => word(4, "25.0000").click());
    await act(async () => word(4, "250.00").click());
    await act(async () => word(5, "250.00").click());
    await act(async () => document.querySelector<HTMLButtonElement>("[data-teach-submit]")!.click());
    const second = onTeach.mock.calls[1][0];
    expect(second.rows).toHaveLength(1);
    expect(second.holdings).toHaveLength(1);
  });
});
