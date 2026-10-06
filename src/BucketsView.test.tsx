// @vitest-environment jsdom
//
// Goals page (s9): an empty Goals page explains what a goal is and offers "Create a goal" plus three
// example names, instead of one grey line above a lone "+ New goal…" tile.
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
  it("shows one centred block with an explanation, Create a goal and three examples", () => {
    render();
    const blocks = container.querySelectorAll(".goals-empty");
    expect(blocks).toHaveLength(1);
    const block = blocks[0];
    expect(block.textContent).toContain("No goals yet");
    expect(block.textContent).toContain("Save toward something: a holiday, a new car, an emergency fund.");
    const create = button("Create a goal");
    expect(create).toBeDefined();
    expect(block.contains(create!)).toBe(true);
    expect(create!.classList.contains("modal-secondary")).toBe(false);
    for (const example of ["Emergency fund", "Holiday", "New car"]) {
      const b = button(example);
      expect(b, example).toBeDefined();
      expect(block.contains(b!)).toBe(true);
      expect(b!.classList.contains("modal-secondary")).toBe(true);
    }
    expect(hasNewGoalTile()).toBe(false);
    expect(container.querySelector(".empty-state")).toBeNull();
  });

  it("an example opens the form with that name filled in, inside the same block", () => {
    render();
    click(button("Holiday"));
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
    click(button("Emergency fund"));
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
