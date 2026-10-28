// @vitest-environment jsdom
//
// QA-FUNC-006: the member filter's "All members" (no filter, unassigned rows included) is not the same
// as every named member ticked (only people, unassigned rows left out). Ticking the last member must
// not silently turn the second into the first.
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { MemberFilterDropdown, type MemberFilterValue } from "./MemberFilterDropdown";
import type { FamilyMember } from "./types";

(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

const alex = { id: 1, name: "Alex" } as FamilyMember;
const blair = { id: 2, name: "Blair" } as FamilyMember;

let container: HTMLDivElement;
let root: Root;
beforeEach(() => {
  container = document.createElement("div");
  document.body.append(container);
  root = createRoot(container);
});
afterEach(() => {
  act(() => root.unmount());
  container.remove();
});

function show(members: FamilyMember[], value: MemberFilterValue) {
  const onChange = vi.fn();
  act(() => root.render(<MemberFilterDropdown members={members} value={value} onChange={onChange} />));
  act(() => container.querySelector<HTMLButtonElement>(".account-filter-toggle")!.click());
  return onChange;
}
const toggleLabel = () => container.querySelector(".account-filter-toggle")!.textContent!.replace("▾", "").trim();
const box = (name: string) =>
  [...container.querySelectorAll<HTMLLabelElement>(".account-filter-option")].find((l) => l.textContent === name)!.querySelector("input")!;
const press = (text: string) => act(() => [...container.querySelectorAll("button")].find((b) => b.textContent === text)!.click());

describe("MemberFilterDropdown", () => {
  it("starts as All members with everyone ticked", () => {
    show([alex, blair], "all");
    expect(toggleLabel()).toBe("All members");
    expect(box("Alex").checked && box("Blair").checked).toBe(true);
  });

  it("with one member, unticking then ticking them isolates that member instead of going back to All", () => {
    const onChange = show([alex], "all");
    act(() => box("Alex").click());
    expect(onChange).toHaveBeenLastCalledWith(new Set());
    act(() => root.render(<MemberFilterDropdown members={[alex]} value={new Set()} onChange={onChange} />));
    expect(toggleLabel()).toBe("No members");
    act(() => box("Alex").click());
    const next = onChange.mock.lastCall![0] as MemberFilterValue;
    expect(next).not.toBe("all");
    expect([...(next as Set<number>)]).toEqual([1]);
  });

  it("ticking the last unticked member gives every named member, not All", () => {
    const onChange = show([alex, blair], new Set([1]));
    act(() => box("Blair").click());
    const next = onChange.mock.lastCall![0] as MemberFilterValue;
    expect(next).not.toBe("all");
    expect([...(next as Set<number>)].sort()).toEqual([1, 2]);
  });

  it("labels every-named-member differently from All members, so the two are not mistaken", () => {
    show([alex, blair], new Set([1, 2]));
    expect(toggleLabel()).toBe("All named members");
    expect(toggleLabel()).not.toBe("All members");
  });

  it("names a single chosen member, and counts several", () => {
    show([alex, blair, { id: 3, name: "Casey" } as FamilyMember], new Set([2]));
    expect(toggleLabel()).toBe("Blair");
    act(() => root.render(<MemberFilterDropdown members={[alex, blair, { id: 3, name: "Casey" } as FamilyMember]} value={new Set([1, 2])} onChange={vi.fn()} />));
    expect(toggleLabel()).toBe("2 members");
  });

  it("Select all returns to the no-filter All, and Clear all selects none", () => {
    const onChange = show([alex, blair], new Set([1]));
    press("Select all");
    expect(onChange).toHaveBeenLastCalledWith("all");
    press("Clear all");
    expect(onChange).toHaveBeenLastCalledWith(new Set());
  });

  it("shows nothing when there are no family members", () => {
    act(() => root.render(<MemberFilterDropdown members={[]} value="all" onChange={vi.fn()} />));
    expect(container.querySelector(".account-filter")).toBeNull();
  });
});

it("names the only member when just one exists and is chosen", () => {
  const container2 = document.createElement("div");
  document.body.append(container2);
  const r = createRoot(container2);
  act(() => r.render(<MemberFilterDropdown members={[alex]} value={new Set([1])} onChange={vi.fn()} />));
  expect(container2.querySelector(".account-filter-toggle")!.textContent).toContain("Alex");
  act(() => r.unmount());
  container2.remove();
});
