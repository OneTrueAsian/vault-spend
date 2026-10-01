// @vitest-environment jsdom
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import type { Account, Asset, FamilyMember } from "../types";
import type { ComparisonSetup, SaveResponse, SetupResponse } from "./types";
import { emptySetup, setAge, setHouseholdTotal, setInHousehold, setPersonIncome, syncPeople } from "./setupDraft";
import { pickMenuOption } from "../menuSelectTestUtils";

(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

const api = vi.hoisted(() => ({
  getComparisonSetup: vi.fn(),
  saveComparisonSetup: vi.fn(),
  generation: 4 as number | null,
}));

vi.mock("./api", () => ({
  useGeneration: () => api.generation,
  getComparisonSetup: api.getComparisonSetup,
  saveComparisonSetup: api.saveComparisonSetup,
  getComparisons: vi.fn(),
}));

import { ComparisonDetailsPanel } from "./ComparisonDetailsPanel";

const members: FamilyMember[] = [
  { id: 7, name: "Partner" },
  { id: 8, name: "Roommate" },
];

function account(id: number, name: string, type: string): Account {
  return {
    id,
    name,
    account_type: type,
    starting_balance: "0",
    current_balance: "0",
    institution: null,
    mask: null,
    interest_rate: null,
    excluded_from_debt_payoff: false,
    member_id: null,
    member_name: null,
    checkpoint_date: null,
    icon_key: null,
    import_flip_signs: null,
  };
}

const accounts: Account[] = [
  account(1, "Checking", "checking"),
  account(2, "Brokerage", "investment"),
  account(3, "Visa", "credit"),
  account(4, "Mortgage", "loan"),
];
const assets: Asset[] = [{ id: 5, name: "Rental", asset_type: "property", value: "100000", valued_on: "2026-09-01", notes: null, member_id: null, member_name: null }];

const stored = (): ComparisonSetup => {
  let s = syncPeople(emptySetup("household"), members);
  s = setAge(s, { kind: "owner" }, { kind: "exact", age: 42 }, "2026-09-01");
  return { ...s, householdReferencePerson: { kind: "owner" } };
};
const response = (setup: ComparisonSetup | null, revision = 2): SetupResponse => ({ generation: 4, revision, setup, repairs: [] });

async function flush() {
  await act(async () => {
    await Promise.resolve();
    await Promise.resolve();
  });
}

describe("ComparisonDetailsPanel", () => {
  let container: HTMLDivElement;
  let root: Root;

  beforeEach(() => {
    api.getComparisonSetup.mockReset();
    api.saveComparisonSetup.mockReset();
    api.generation = 4;
    container = document.createElement("div");
    document.body.append(container);
    root = createRoot(container);
  });
  afterEach(() => {
    act(() => root.unmount());
    container.remove();
  });

  const mount = async () => {
    act(() => root.render(<ComparisonDetailsPanel accounts={accounts} assets={assets} familyMembers={members} />));
    await flush();
  };
  const q = (sel: string) => container.querySelector<HTMLElement>(sel);
  const input = (label: string) => container.querySelector<HTMLInputElement>(`input[aria-label="${label}"]`)!;
  const type = (el: HTMLInputElement, value: string) =>
    act(() => {
      const setter = Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, "value")!.set!;
      setter.call(el, value);
      el.dispatchEvent(new Event("input", { bubbles: true }));
    });
  const save = () => q("[data-cmp-settings-save]") as HTMLButtonElement;
  const trigger = (label: string) => container.querySelector<HTMLElement>(`button[aria-label^="${label}"]`)!;

  it("offers to start when nothing has been set up, then lists the owner and family", async () => {
    api.getComparisonSetup.mockResolvedValue(response(null, 0));
    await mount();
    expect(q("[data-cmp-settings-start]")).not.toBeNull();
    act(() => q("[data-cmp-settings-start]")!.click());
    expect(q("[data-cmp-person='owner']")).not.toBeNull();
    expect(q("[data-cmp-person='member:7']")).not.toBeNull();
    expect(save().disabled).toBe(false);
  });

  it("starts clean: Save and Discard are off until something is edited", async () => {
    api.getComparisonSetup.mockResolvedValue(response(stored()));
    await mount();
    expect(save().disabled).toBe(true);
    expect((q("[data-cmp-settings-discard]") as HTMLButtonElement).disabled).toBe(true);
  });

  it("saves an edited age against the revision it loaded and reports success", async () => {
    api.getComparisonSetup.mockResolvedValue(response(stored(), 2));
    api.saveComparisonSetup.mockImplementation(async (_g: number, _r: number, setup: ComparisonSetup) => ({ status: "saved", revision: 3, setup }) satisfies SaveResponse);
    await mount();
    type(input("Age of Me: age"), "43");
    expect(save().disabled).toBe(false);
    act(() => save().click());
    await flush();

    const [generation, revision, sent] = api.saveComparisonSetup.mock.calls[0] as [number, number, ComparisonSetup];
    expect([generation, revision]).toEqual([4, 2]);
    expect(sent.people[0].age?.age).toEqual({ kind: "exact", age: 43 });
    expect(q("[data-cmp-settings-message]")?.textContent).toBe("Saved.");
    expect(save().disabled).toBe(true);
  });

  it("never saves a half-typed age", async () => {
    api.getComparisonSetup.mockResolvedValue(response(stored()));
    await mount();
    type(input("Age of Me: age"), "4x");
    expect(container.textContent).toContain("Enter an age from 18 to 120");
    expect(save().disabled).toBe(true);
  });

  it("accepts an age range as an equal alternative", async () => {
    api.getComparisonSetup.mockResolvedValue(response(stored()));
    api.saveComparisonSetup.mockImplementation(async (_g: number, _r: number, setup: ComparisonSetup) => ({ status: "saved", revision: 3, setup }));
    await mount();
    pickMenuOption(trigger("Age of Me: how to enter it"), "band");
    type(input("Age of Me: youngest age in the range"), "25");
    type(input("Age of Me: oldest age in the range (leave empty for no upper limit)"), "34");
    act(() => save().click());
    await flush();
    expect((api.saveComparisonSetup.mock.calls[0][2] as ComparisonSetup).people[0].age?.age).toEqual({ kind: "band", min: 25, max: 34 });
  });

  it("changes household or individual mode here, not on the Comparisons page", async () => {
    api.getComparisonSetup.mockResolvedValue(response(stored()));
    api.saveComparisonSetup.mockImplementation(async (_g: number, _r: number, setup: ComparisonSetup) => ({ status: "saved", revision: 3, setup }));
    await mount();
    pickMenuOption(trigger("Comparison mode"), "individual");
    act(() => save().click());
    await flush();
    expect((api.saveComparisonSetup.mock.calls[0][2] as ComparisonSetup).mode).toBe("individual");
  });

  it("lets a roommate be left out of the financial unit", async () => {
    api.getComparisonSetup.mockResolvedValue(response(stored()));
    api.saveComparisonSetup.mockImplementation(async (_g: number, _r: number, setup: ComparisonSetup) => ({ status: "saved", revision: 3, setup }));
    await mount();
    const box = q("[data-cmp-person='member:8'] input[type='checkbox']") as HTMLInputElement;
    act(() => box.click());
    act(() => save().click());
    await flush();
    const sent = api.saveComparisonSetup.mock.calls[0][2] as ComparisonSetup;
    expect(sent.people.find((p) => p.person.kind === "member" && p.person.id === 8)?.inHousehold).toBe(false);
  });

  it("keeps both income methods' amounts when switching between them", async () => {
    let s = stored();
    s = setHouseholdTotal(s, { value: "120000", measuredOn: "2026-09-01", explanation: "Tax return" });
    s = setPersonIncome(s, { kind: "owner" }, { value: "70000", measuredOn: "2026-09-01", explanation: "Pay stub" });
    api.getComparisonSetup.mockResolvedValue(response(s));
    api.saveComparisonSetup.mockImplementation(async (_g: number, _r: number, setup: ComparisonSetup) => ({ status: "saved", revision: 3, setup }));
    await mount();
    pickMenuOption(trigger("Household income method"), "by_person");
    expect(container.textContent).toContain("Me: income per year");
    act(() => save().click());
    await flush();
    const sent = api.saveComparisonSetup.mock.calls[0][2] as ComparisonSetup;
    expect(sent.income.householdMethod).toBe("by_person");
    expect(sent.income.householdTotal?.value).toBe("120000");
    expect(sent.income.perPerson[0].grossAnnual.value).toBe("70000");
  });

  it("includes only people who share the finances in per-person income", async () => {
    let s = setInHousehold(stored(), { kind: "member", id: 8 }, false);
    s = { ...s, income: { ...s.income, householdMethod: "by_person" } };
    api.getComparisonSetup.mockResolvedValue(response(s));
    await mount();
    expect(container.textContent).toContain("Partner: income per year");
    expect(container.textContent).not.toContain("Roommate: income per year");
  });

  it("treats the note on a typed amount as optional", async () => {
    api.getComparisonSetup.mockResolvedValue(response(stored()));
    await mount();
    type(input("Household income per year"), "$85,000");
    expect(container.textContent).not.toContain("Say where this figure came from");
    expect(container.querySelector("[data-cmp-amount='Household income per year'] .cmp-note-input input")?.getAttribute("placeholder")).toBe("Where this came from (optional)");
  });

  it("rejects a malformed amount without emitting it", async () => {
    api.getComparisonSetup.mockResolvedValue(response(stored()));
    await mount();
    type(input("Household income per year"), "lots");
    expect(container.textContent).toContain("Enter a dollar amount");
    expect(save().disabled).toBe(true);
  });

  it("marks a card to leave out of the Debt comparison only", async () => {
    api.getComparisonSetup.mockResolvedValue(response(stored()));
    api.saveComparisonSetup.mockImplementation(async (_g: number, _r: number, setup: ComparisonSetup) => ({ status: "saved", revision: 3, setup }));
    await mount();
    const row = [...container.querySelectorAll<HTMLElement>("[data-cmp-group='debt'] .cmp-settings-row")].find((r) => r.textContent?.includes("Visa"))!;
    act(() => (row.querySelector("input[type='checkbox']") as HTMLInputElement).click());
    act(() => save().click());
    await flush();
    expect((api.saveComparisonSetup.mock.calls[0][2] as ComparisonSetup).debtExclusions).toEqual([{ kind: "account", id: 3 }]);
  });

  it("classifies an investment account and a debt type", async () => {
    api.getComparisonSetup.mockResolvedValue(response(stored()));
    api.saveComparisonSetup.mockImplementation(async (_g: number, _r: number, setup: ComparisonSetup) => ({ status: "saved", revision: 3, setup }));
    await mount();
    pickMenuOption(trigger("Brokerage: investment type"), "retirement");
    pickMenuOption(trigger("Mortgage: type of debt"), "mortgage");
    act(() => save().click());
    await flush();
    const sent = api.saveComparisonSetup.mock.calls[0][2] as ComparisonSetup;
    expect(sent.investmentClasses).toEqual([{ source: { kind: "account", id: 2 }, class: "retirement" }]);
    expect(sent.debtClasses).toEqual([{ source: { kind: "account", id: 4 }, class: "mortgage" }]);
  });

  it("records a balance confirmation with today's date", async () => {
    api.getComparisonSetup.mockResolvedValue(response(stored()));
    api.saveComparisonSetup.mockImplementation(async (_g: number, _r: number, setup: ComparisonSetup) => ({ status: "saved", revision: 3, setup }));
    await mount();
    act(() => (q("[data-cmp-confirm='savings']") as HTMLButtonElement).click());
    act(() => save().click());
    await flush();
    const confirmations = (api.saveComparisonSetup.mock.calls[0][2] as ComparisonSetup).balanceConfirmations;
    expect(confirmations).toHaveLength(1);
    expect(confirmations[0].metric).toBe("savings");
    expect(confirmations[0].confirmedOn).toMatch(/^\d{4}-\d{2}-\d{2}$/);
  });

  it("splits a shared account by percentage", async () => {
    api.getComparisonSetup.mockResolvedValue(response(stored()));
    api.saveComparisonSetup.mockImplementation(async (_g: number, _r: number, setup: ComparisonSetup) => ({ status: "saved", revision: 3, setup }));
    await mount();
    type(input("Checking: share of Me (%)"), "60");
    type(input("Checking: share of Partner (%)"), "40");
    expect(container.textContent).toContain("100% assigned");
    act(() => save().click());
    await flush();
    expect((api.saveComparisonSetup.mock.calls[0][2] as ComparisonSetup).allocations).toEqual([
      { source: { kind: "account", id: 1 }, person: { kind: "owner" }, basisPoints: 6000 },
      { source: { kind: "account", id: 1 }, person: { kind: "member", id: 7 }, basisPoints: 4000 },
    ]);
  });

  it("shows every problem the backend finds and keeps the draft", async () => {
    api.getComparisonSetup.mockResolvedValue(response(stored()));
    api.saveComparisonSetup.mockResolvedValue({ status: "invalid", problems: [{ field: "a", message: "Shares add up to more than 100%." }, { field: "b", message: "Say where this figure came from." }] });
    await mount();
    type(input("Age of Me: age"), "50");
    act(() => save().click());
    await flush();
    expect(q("[data-cmp-problems]")?.textContent).toContain("Shares add up to more than 100%.");
    expect(q("[data-cmp-problems]")?.textContent).toContain("Say where this figure came from.");
    expect(input("Age of Me: age").value).toBe("50");
  });

  it("keeps the person's edits when someone else saved first", async () => {
    api.getComparisonSetup.mockResolvedValue(response(stored(), 2));
    api.saveComparisonSetup.mockResolvedValue({ status: "conflict", currentRevision: 5 });
    await mount();
    type(input("Age of Me: age"), "50");
    act(() => save().click());
    await flush();
    expect(q("[data-cmp-settings-message]")?.textContent).toContain("changed somewhere else");
    expect(input("Age of Me: age").value).toBe("50");
    api.saveComparisonSetup.mockResolvedValue({ status: "saved", revision: 6, setup: stored() });
    act(() => save().click());
    await flush();
    expect(api.saveComparisonSetup.mock.calls[1][1]).toBe(5);
  });

  it("discards edits back to what was saved", async () => {
    api.getComparisonSetup.mockResolvedValue(response(stored()));
    await mount();
    type(input("Age of Me: age"), "50");
    act(() => (q("[data-cmp-settings-discard]") as HTMLButtonElement).click());
    expect(save().disabled).toBe(true);
  });

  it("lists saved details that point at deleted people or accounts", async () => {
    api.getComparisonSetup.mockResolvedValue({ ...response(stored()), repairs: [{ kind: "missing_person", field: "allocations[0].person", person: { kind: "member", id: 99 } }] });
    await mount();
    expect(q("[data-cmp-settings-repairs]")?.textContent).toContain("no longer in this profile");
  });

  it("reports a failed load and can retry", async () => {
    api.getComparisonSetup.mockRejectedValueOnce("The active profile changed before this finished.");
    await mount();
    expect(container.textContent).toContain("Could not load comparison settings");
    api.getComparisonSetup.mockResolvedValue(response(stored()));
    act(() => (container.querySelector(".modal-secondary") as HTMLButtonElement).click());
    await flush();
    expect(q("[data-cmp-person='owner']")).not.toBeNull();
  });

  it("picks up a family member added while it is open, without losing other edits", async () => {
    api.getComparisonSetup.mockResolvedValue(response(stored()));
    await mount();
    type(input("Age of Me: age"), "50");
    const more: FamilyMember[] = [...members, { id: 9, name: "Newcomer" }];
    act(() => root.render(<ComparisonDetailsPanel accounts={accounts} assets={assets} familyMembers={more} />));
    await flush();
    expect(q("[data-cmp-person='member:9']")).not.toBeNull();
    expect(input("Age of Me: age").value).toBe("50");
  });

  it("does not load before the profile generation is known", async () => {
    api.generation = null;
    await mount();
    expect(api.getComparisonSetup).not.toHaveBeenCalled();
  });
});
