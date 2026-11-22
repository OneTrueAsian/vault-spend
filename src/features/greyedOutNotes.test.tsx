// @vitest-environment jsdom
// VS-68: a greyed-out button says what it is waiting for. Forms that open on demand say it straight away; boxes that are
// always on screen say it once they have been used, so an untouched settings card shows no red text.
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { act, useState } from "react";
import { createRoot, type Root } from "react-dom/client";
import { BackupsBlock } from "./backups/BackupsBlock";
import { ManageFamilyMembersDialog } from "./household/ManageFamilyMembersDialog";
import { PeopleCard } from "./household/PeopleCard";
import { ManageCategoriesDialog } from "./transactions/ManageCategoriesDialog";
import { NewCategoryDialog } from "./transactions/NewCategoryDialog";
import { TransactionSavedFilters } from "./transactions/TransactionSavedFilters";
import { ProfilesSection } from "./profiles/ProfilesSection";
import { LivePricesSection } from "./investments/LivePricesSection";
import { PropertyAssetsSection } from "./investments/PropertyAssets";
import { BudgetSuggestDialog } from "./budgets/BudgetSuggestDialog";
import { AddWidgetDialog } from "./dashboard/AddWidgetDialog";
import { DashboardLayoutToolbar } from "./dashboard/DashboardLayoutToolbar";
import { AmountEditor } from "./comparisons/AmountEditor";
import type { Account } from "../shared/lib/types";

vi.mock("@tauri-apps/plugin-opener", () => ({ openUrl: vi.fn() }));

(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

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

const render = (node: React.ReactNode) => act(() => root.render(node));
const note = (attr: string) => document.querySelector(`[${attr}]`)?.textContent ?? null;
const button = (label: string, scope: ParentNode = document) =>
  [...scope.querySelectorAll<HTMLButtonElement>("button")].find((b) => b.textContent?.trim() === label)!;
const input = (placeholder: string) => document.querySelector<HTMLInputElement>(`input[placeholder='${placeholder}']`)!;
const type = (el: HTMLInputElement, text: string) =>
  act(() => {
    Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, "value")!.set!.call(el, text);
    el.dispatchEvent(new Event("input", { bubbles: true }));
  });
const focus = (el: HTMLElement) => act(() => el.focus());

/** An always-on box: quiet until used, then names what is missing until something is typed. */
function expectAfterFirstUse(attr: string, box: HTMLInputElement, action: HTMLButtonElement, text: string) {
  expect(action.disabled).toBe(true);
  expect(note(attr)).toBeNull();
  focus(box);
  expect(note(attr)).toBe(text);
  type(box, "Something");
  expect(note(attr)).toBeNull();
  expect(action.disabled).toBe(false);
  type(box, "  ");
  expect(note(attr)).toBe(text);
}

/** A form that opened on demand: names what is missing straight away, until it is typed. */
function expectStraightAway(attr: string, box: HTMLInputElement, action: HTMLButtonElement, text: string) {
  expect(action.disabled).toBe(true);
  expect(note(attr)).toBe(text);
  type(box, "Something");
  expect(note(attr)).toBeNull();
  expect(action.disabled).toBe(false);
}

describe("always-on boxes say what is missing once used (VS-68)", () => {
  it("Settings › Second copy folder", () => {
    render(<BackupsBlock backups={[]} onCreateBackupNow={vi.fn()} onRestoreBackup={vi.fn()} copyDir={null} onSetCopyDir={vi.fn()} onBrowseCopyDir={vi.fn()} isProtected={false} />);
    expectAfterFirstUse("data-backup-copy-missing", document.querySelector<HTMLInputElement>("input[aria-label='Second backup folder']")!,
      button("Start copying"), "Enter a folder, or choose one with Browse.");
  });

  it("Manage family members › Add", () => {
    render(<ManageFamilyMembersDialog members={[]} onCancel={vi.fn()} onCreate={vi.fn()} onRename={vi.fn()} onDelete={vi.fn()} />);
    expectAfterFirstUse("data-new-member-missing", input('New family member, e.g. "Alex"'), button("Add"), "Enter a name.");
  });

  it("Manage categories › Add", () => {
    render(<ManageCategoriesDialog categories={[]} categoryIconMap={{}} onCancel={vi.fn()} onCreate={vi.fn()} onSetIcon={vi.fn()} onRename={vi.fn()} onDelete={vi.fn()} />);
    expectAfterFirstUse("data-new-category-missing", input('New category, e.g. "Pet Care"'), button("Add"), "Enter a category name.");
  });

  it("Settings › Profiles › New profile", () => {
    render(<ProfilesSection profiles={[{ id: "a", name: "Sam", is_active: true, icon_key: null, is_password_protected: false }]}
      onCreateProfile={vi.fn()} onUseExistingDataFile={vi.fn()} onSwitchProfile={vi.fn()} onRenameProfile={vi.fn()}
      onSetProfileIcon={vi.fn()} onDeleteProfile={vi.fn()} onProtected={vi.fn()} />);
    expectAfterFirstUse("data-new-profile-missing", input('New profile, e.g. "Alex"'), button("New profile"), "Enter a name for the new profile.");
  });

  it("Settings › Live prices API key", () => {
    render(<LivePricesSection settings={{ enabled: false, provider: "finnhub", last_refreshed_at: null, requests_used_today: 0, requests_limit: null }}
      onSetApiKey={vi.fn()} onRefreshNow={vi.fn()} />);
    expectAfterFirstUse("data-api-key-missing", document.querySelector<HTMLInputElement>("input[type='password']")!, button("Save"), "Paste your API key.");
  });
});

describe("forms that open on demand say what is missing straight away (VS-68)", () => {
  it("New category", () => {
    render(<NewCategoryDialog onCancel={vi.fn()} onSubmit={vi.fn()} />);
    expectStraightAway("data-new-category-missing", input('e.g. "Pet Care"'), button("Add category"), "Enter a category name.");
  });

  it("Household › People › Rename", () => {
    render(<PeopleCard members={[{ id: 1, name: "Alex" }]} onRename={vi.fn()} onRemove={vi.fn()} />);
    act(() => button("Rename").click());
    const box = document.querySelector<HTMLInputElement>("input[aria-label='Name for Alex']")!;
    expect(note("data-person-name-missing")).toBeNull();
    type(box, "");
    expect(button("Save").disabled).toBe(true);
    expect(note("data-person-name-missing")).toBe("Enter a name.");
    type(box, "Alexa");
    expect(note("data-person-name-missing")).toBeNull();
  });

  it("Transactions › Save current filter", () => {
    function Harness() {
      const [name, setName] = useState("");
      return <TransactionSavedFilters savedFilters={[]} applySavedFilter={vi.fn()} deleteSavedFilter={vi.fn()} savingFilter saveCurrentFilter={vi.fn()}
        newFilterName={name} setNewFilterName={setName} setSavingFilter={vi.fn()} transferCandidatePairs={[]} setTransferReviewOpen={vi.fn()}
        autoLinkedPairs={[]} setAutoLinkReviewOpen={vi.fn()} />;
    }
    render(<Harness />);
    expectStraightAway("data-filter-name-missing", input('e.g. "Uncategorized this month"'), button("Save"), "Enter a name for this filter.");
  });

  it("Dashboard › Save layout as", () => {
    function Harness() {
      const [name, setName] = useState("");
      const layout = { customizeMode: false, setCustomizeMode: vi.fn(), customPresets: [], savingLayout: true, setSavingLayout: vi.fn(),
        newLayoutName: name, setNewLayoutName: setName, saveCurrentLayout: vi.fn(), deleteCustomLayout: vi.fn() };
      return <DashboardLayoutToolbar onSetLayoutWidgets={vi.fn()} onOpenAddWidget={vi.fn()} presetKey="custom"
        layout={layout as unknown as Parameters<typeof DashboardLayoutToolbar>[0]["layout"]} />;
    }
    render(<Harness />);
    expectStraightAway("data-layout-name-missing", input('e.g. "Weekly check-in"'), button("Save"), "Enter a name for this layout.");
  });

  it("Investments › Add property or valuable", () => {
    render(<PropertyAssetsSection assets={[]} familyMembers={[]} onCreate={vi.fn()} onUpdateValue={vi.fn()} onSetMember={vi.fn()} onDelete={vi.fn()} />);
    act(() => button("Add property or valuable").click());
    expectStraightAway("data-property-name-missing", input('e.g. "Home"'), button("Save"), "Enter a name, like Home.");
  });

  it("Budget › Suggest from my average: nothing ticked", () => {
    render(<BudgetSuggestDialog monthLabel="November" onApply={vi.fn()} onCancel={vi.fn()}
      suggestions={{ months_used: 3, lines: [{ category: "Groceries", budget_group: "Living", current: "400.00", suggested: "450" }] }} />);
    const apply = () => [...document.querySelectorAll<HTMLButtonElement>("button")].find((b) => b.textContent?.startsWith("Apply"))!;
    // Groceries already has a budget, so it starts unticked.
    expect(apply().disabled).toBe(true);
    expect(note("data-suggest-missing")).toBe("Tick at least one category to apply.");
    act(() => document.querySelector<HTMLInputElement>("[data-suggest-row='Groceries'] input")!.click());
    expect(note("data-suggest-missing")).toBeNull();
    expect(apply().disabled).toBe(false);
  });

  it("Add widget › Pin a specific item: quiet until the row is used", () => {
    render(<AddWidgetDialog currentWidgets={[]} accounts={[{ id: 1, name: "Checking" } as Account]} buckets={[]} holdings={[]}
      safeToSpendEnabled={false} onAdd={vi.fn()} onCancel={vi.fn()} />);
    const row = [...document.querySelectorAll<HTMLElement>(".category-manage-row")].find((r) => r.textContent?.startsWith("Account"))!;
    expect(button("Add", row).disabled).toBe(true);
    expect(note("data-pin-missing")).toBeNull();
    focus(row.querySelector<HTMLButtonElement>("button")!);
    expect(row.querySelector("[data-pin-missing]")?.textContent).toBe("Choose one to pin.");
  });

  it("Comparisons › an amount's date and note say to enter the amount first", () => {
    render(<AmountEditor label="Home value" value={null} onChange={vi.fn()} />);
    const noteBox = document.querySelector<HTMLInputElement>(".cmp-note-input input")!;
    expect(noteBox.disabled).toBe(true);
    expect(noteBox.placeholder).toBe("Enter the amount first");
  });
});
