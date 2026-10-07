// @vitest-environment jsdom
//
// Goals page (s9): an empty Goals page explains what a goal is and offers "Create a goal" plus three
// starting points, as in the UI mockup, instead of one grey line above a lone "+ New goal…" tile.
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { act, type ComponentProps } from "react";
import { createRoot, type Root } from "react-dom/client";

import { BucketsView } from "./BucketsView";
import type { Bucket } from "./types";

(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

function bucket(over: Partial<Bucket> = {}): Bucket {
  return {
    id: 1,
    name: "Roof",
    target_amount: "2000.00",
    saved_amount: "500.00",
    target_date: null,
    account_id: null,
    account_name: null,
    member_id: null,
    member_name: null,
    sinking_amount: null,
    color: null,
    icon_key: null,
    tracks_account: false,
    monthly_pace: "0",
    ...over,
  };
}

let container: HTMLDivElement;
let root: Root;

beforeEach(() => {
  container = document.createElement("div");
  document.body.appendChild(container);
  root = createRoot(container);
});

afterEach(() => {
  act(() => root.unmount());
  container.remove();
});

function render(over: Partial<ComponentProps<typeof BucketsView>> = {}) {
  const props: ComponentProps<typeof BucketsView> = {
    buckets: [],
    accounts: [],
    familyMembers: [],
    onCreateBucket: vi.fn(),
    onUpdateBucketDetails: vi.fn(),
    onAddContribution: vi.fn(),
    onDeleteBucket: vi.fn(),
    ...over,
  };
  act(() => root.render(<BucketsView {...props} />));
  return props;
}

function button(text: string): HTMLButtonElement | undefined {
  return [...container.querySelectorAll("button")].find((b) => b.textContent?.trim() === text) as
    | HTMLButtonElement
    | undefined;
}

function click(el: Element | undefined) {
  if (!el) throw new Error("element to click is missing");
  act(() => (el as HTMLElement).click());
}

function nameInput(): HTMLInputElement | null {
  return container.querySelector(".bucket-new-form input");
}

function hasNewGoalTile(): boolean {
  return [...container.querySelectorAll("button")].some((b) => /New goal…/.test(b.textContent ?? ""));
}

describe("BucketsView empty page", () => {
  const starter = (name: string) =>
    [...container.querySelectorAll<HTMLButtonElement>(".goals-empty-starter")].find((b) => b.querySelector("b")?.textContent === name);

  it("matches the mockup: what a goal is for, Create a goal, and three starting points", () => {
    render();
    const blocks = container.querySelectorAll(".goals-empty");
    expect(blocks).toHaveLength(1);
    const block = blocks[0];
    expect(container.querySelector(".view-sub")?.textContent).toBe("Money you're setting aside for something");
    expect(block.querySelector(".goals-empty-icon svg")).not.toBeNull();
    expect(block.querySelector("h2")?.textContent).toBe("Save toward something");
    expect(block.textContent).toContain(
      "A goal is an amount you want to have by a date: a holiday, a new car, a cushion for emergencies, or a bill that comes once a year. Vault Spend shows how much to put aside each month to get there.",
    );
    const create = button("Create a goal");
    expect(create).toBeDefined();
    expect(block.contains(create!)).toBe(true);
    expect(create!.classList.contains("modal-secondary")).toBe(false);
    expect(block.textContent).toContain("Or start from one of these:");
    const starters = [...block.querySelectorAll(".goals-empty-starter")].map((b) => [b.querySelector("b")?.textContent, b.querySelector("span")?.textContent]);
    expect(starters).toEqual([
      ["Emergency fund", "3 months of your spending"],
      ["Holiday", "A trip next summer, you pick the amount"],
      ["Once-a-year bill", "Car insurance or a subscription, saved monthly"],
    ]);
    expect(hasNewGoalTile()).toBe(false);
    expect(container.querySelector(".empty-state")).toBeNull();
  });

  it("puts a rough amount on the emergency fund, from average monthly spending, and fills it in", () => {
    render({ avgMonthlySpend: "5547.14" });
    expect(starter("Emergency fund")?.querySelector("span")?.textContent).toBe("3 months of spending, about $16,600");
    click(starter("Emergency fund"));
    expect(nameInput()!.value).toBe("Emergency fund");
    expect(container.querySelector<HTMLInputElement>('.bucket-new-form input[placeholder="Target amount (optional)"]')!.value).toBe("16600");
  });

  it("an example opens the form with that name filled in, inside the same block", () => {
    render();
    click(starter("Holiday"));
    const input = nameInput();
    expect(input).not.toBeNull();
    expect(input!.value).toBe("Holiday");
    expect(container.querySelector(".goals-empty .bucket-new-form")).not.toBeNull();
    expect(button("Create a goal")).toBeUndefined();
    expect(hasNewGoalTile()).toBe(false);
  });

  it("Create a goal opens an empty form, and Cancel brings the empty block back", () => {
    render();
    click(button("Create a goal"));
    expect(nameInput()!.value).toBe("");
    click(button("Cancel"));
    expect(nameInput()).toBeNull();
    expect(container.querySelector(".goals-empty")).not.toBeNull();
    expect(button("Create a goal")).toBeDefined();
  });

  it("saving an example creates a goal with that name", () => {
    const props = render();
    click(starter("Emergency fund"));
    const form = container.querySelector(".bucket-new-form") as HTMLFormElement;
    act(() => form.requestSubmit());
    expect(props.onCreateBucket).toHaveBeenCalledTimes(1);
    expect(vi.mocked(props.onCreateBucket).mock.calls[0][0]).toBe("Emergency fund");
  });

  it("with a goal there is no empty block, and the New goal tile is back", () => {
    render({ buckets: [bucket()] });
    expect(container.querySelector(".goals-empty")).toBeNull();
    expect(hasNewGoalTile()).toBe(true);
    expect(button("Create a goal")).toBeUndefined();
  });

  it("the New goal tile still opens an empty form once goals exist", () => {
    render({ buckets: [bucket()] });
    const tile = [...container.querySelectorAll("button")].find((b) => /New goal…/.test(b.textContent ?? ""));
    click(tile);
    expect(nameInput()!.value).toBe("");
    expect(container.querySelector(".buckets-grid .bucket-new-form")).not.toBeNull();
  });
});
