// @vitest-environment jsdom
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import type { ComparisonSetup } from "./types";
import { pickMenuOption } from "../menuSelectTestUtils";

(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

const api = vi.hoisted(() => ({ saveComparisonSetup: vi.fn() }));
vi.mock("./api", () => ({ saveComparisonSetup: api.saveComparisonSetup }));

import { ComparisonSetupDialog } from "./ComparisonSetupDialog";

const members = [
  { id: 7, name: "Partner" },
  { id: 8, name: "Roommate" },
];

async function flush() {
  await act(async () => {
    await Promise.resolve();
    await Promise.resolve();
  });
}

describe("ComparisonSetupDialog", () => {
  let container: HTMLDivElement;
  let root: Root;
  const onSaved = vi.fn();
  const onCancel = vi.fn();

  beforeEach(() => {
    api.saveComparisonSetup.mockReset();
    onSaved.mockReset();
    onCancel.mockReset();
    container = document.createElement("div");
    document.body.append(container);
    root = createRoot(container);
  });
  afterEach(() => {
    act(() => root.unmount());
    container.remove();
  });

  const mount = (m = members) => act(() => root.render(<ComparisonSetupDialog generation={4} members={m} onSaved={onSaved} onCancel={onCancel} />));
  const q = (sel: string) => document.querySelector<HTMLElement>(sel);
  const type = (el: HTMLInputElement, value: string) =>
    act(() => {
      Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, "value")!.set!.call(el, value);
      el.dispatchEvent(new Event("input", { bubbles: true }));
    });
  const ageInput = () => q("[data-cmp-age]") as HTMLInputElement;
  const save = () => q("[data-cmp-setup-save]") as HTMLButtonElement;

  it("asks for an age before it will save, and says why", async () => {
    mount();
    act(() => save().click());
    await flush();
    expect(api.saveComparisonSetup).not.toHaveBeenCalled();
    expect(q("[role='alert']")?.textContent).toContain("Enter an age");
  });

  it("saves a household setup for the first time against revision 0, with the reference person's age", async () => {
    api.saveComparisonSetup.mockResolvedValue({ status: "saved", revision: 1, setup: {} });
    mount();
    type(ageInput(), "42");
    act(() => save().click());
    await flush();

    const [generation, revision, sent] = api.saveComparisonSetup.mock.calls[0] as [number, number, ComparisonSetup];
    expect([generation, revision]).toEqual([4, 0]);
    expect(sent.mode).toBe("household");
    expect(sent.householdReferencePerson).toEqual({ kind: "owner" });
    expect(sent.people.map((p) => p.inHousehold)).toEqual([true, true, true]);
    expect(sent.people[0].age?.age).toEqual({ kind: "exact", age: 42 });
    expect(onSaved).toHaveBeenCalledTimes(1);
  });

  it("leaves a roommate out of the household when unticked", async () => {
    api.saveComparisonSetup.mockResolvedValue({ status: "saved", revision: 1, setup: {} });
    mount();
    const roommate = [...document.querySelectorAll<HTMLLabelElement>(".cmp-members label")].find((l) => l.textContent === "Roommate")!;
    act(() => (roommate.querySelector("input") as HTMLInputElement).click());
    type(ageInput(), "30");
    act(() => save().click());
    await flush();
    const sent = api.saveComparisonSetup.mock.calls[0][2] as ComparisonSetup;
    expect(sent.people.find((p) => p.person.kind === "member" && p.person.id === 8)?.inHousehold).toBe(false);
  });

  it("uses the chosen person's age as the household reference and resets the age field", async () => {
    api.saveComparisonSetup.mockResolvedValue({ status: "saved", revision: 1, setup: {} });
    mount();
    type(ageInput(), "42");
    pickMenuOption(q("button[aria-label^='Reference person']")!, "member:7");
    expect(ageInput().value).toBe("");
    type(ageInput(), "67");
    act(() => save().click());
    await flush();
    const sent = api.saveComparisonSetup.mock.calls[0][2] as ComparisonSetup;
    expect(sent.householdReferencePerson).toEqual({ kind: "member", id: 7 });
    expect(sent.people.find((p) => p.person.kind === "member" && p.person.id === 7)?.age?.age).toEqual({ kind: "exact", age: 67 });
    expect(sent.people[0].age).toBeNull();
  });

  it("sets up an individual comparison for the chosen person", async () => {
    api.saveComparisonSetup.mockResolvedValue({ status: "saved", revision: 1, setup: {} });
    mount();
    pickMenuOption(q("button[aria-label^='Compare']")!, "individual");
    type(ageInput(), "29");
    act(() => save().click());
    await flush();
    const sent = api.saveComparisonSetup.mock.calls[0][2] as ComparisonSetup;
    expect(sent.mode).toBe("individual");
    expect(sent.individualPerson).toEqual({ kind: "owner" });
  });

  it("keeps the dialog open with the draft when the save is refused", async () => {
    api.saveComparisonSetup.mockResolvedValue({ status: "invalid", problems: [{ field: "x", message: "That age is not allowed." }] });
    mount();
    type(ageInput(), "42");
    act(() => save().click());
    await flush();
    expect(q("[role='alert']")?.textContent).toContain("That age is not allowed.");
    expect(ageInput().value).toBe("42");
    expect(onSaved).not.toHaveBeenCalled();
  });

  it("explains a conflict and surfaces a thrown error without closing", async () => {
    api.saveComparisonSetup.mockResolvedValueOnce({ status: "conflict", currentRevision: 1 });
    mount();
    type(ageInput(), "42");
    act(() => save().click());
    await flush();
    expect(q("[role='alert']")?.textContent).toContain("already set up");
    api.saveComparisonSetup.mockRejectedValueOnce("The active profile changed before this finished.");
    act(() => save().click());
    await flush();
    expect(q("[role='alert']")?.textContent).toContain("changed before this finished");
  });

  it("explains each question with an info tip", () => {
    mount();
    const tips = [...document.querySelectorAll<HTMLButtonElement>("[data-info-tip]")].map((b) => b.dataset.infoTip);
    expect(tips).toEqual(expect.arrayContaining(["Compare", "Who shares your finances?", "Whose age should we use?", "Age of me"]));
    for (const b of document.querySelectorAll<HTMLButtonElement>("[data-info-tip]")) {
      expect(document.getElementById(b.getAttribute("aria-describedby")!)?.textContent?.trim()).not.toBe("");
    }
  });

  it("discards the draft on cancel", () => {
    mount();
    type(ageInput(), "42");
    act(() => (q(".modal-actions .modal-secondary") as HTMLButtonElement).click());
    expect(onCancel).toHaveBeenCalled();
    expect(api.saveComparisonSetup).not.toHaveBeenCalled();
  });

  it("works for someone with no family members: no membership or person choice to make", () => {
    mount([]);
    expect(q(".cmp-members")).toBeNull();
    expect(q("button[aria-label^='Reference person']")).toBeNull();
  });
});
