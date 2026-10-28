// @vitest-environment jsdom
//
// QA-GAP-001 (owner-approved 27 Oct 2026): the pickers that choose where something new goes leave hidden accounts out.
// A picker that is already set to a hidden account keeps showing it, and import rows that name a hidden account are
// not told it is new.
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { act } from "react";
import { createRoot, type Root } from "react-dom/client";

vi.mock("@tauri-apps/api/core", () => ({ invoke: vi.fn(async () => null) }));
vi.mock("@tauri-apps/api/event", () => ({ listen: vi.fn(() => Promise.resolve(vi.fn())) }));
vi.mock("@tauri-apps/api/webview", () => ({ getCurrentWebview: () => ({ onDragDropEvent: () => Promise.resolve(vi.fn()) }) }));
vi.mock("./profileUiState", () => ({ getCurrentGeneration: () => Promise.resolve(7) }));

import { BucketsView } from "./BucketsView";
import { HoldingImportDialog } from "./HoldingImportDialog";
import { ImportReviewDialog } from "./ImportReviewDialog";
import { ChooseImportAccountDialog, NewTransactionDialog } from "./Modal";
import { RecurringView } from "./RecurringView";
import type { ImportReview } from "./useImportReview";
import type { Account, Bucket } from "./types";

(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

const acct = (id: number, name: string, over: Partial<Account> = {}): Account =>
  ({
    id, name, account_type: "checking", starting_balance: "0", current_balance: "0", institution: null, mask: null,
    interest_rate: null, excluded_from_debt_payoff: false, member_id: null, member_name: null, checkpoint_date: null,
    icon_key: null, import_flip_signs: null, hidden: false, ...over,
  }) as Account;
const ACCOUNTS = [acct(1, "Checking"), acct(2, "Old Savings", { account_type: "savings", hidden: true }), acct(3, "Card", { account_type: "credit" })];

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

/** Opens the MenuSelect whose trigger carries this aria-label (or other selector) and lists its choices. */
function choices(trigger: Element): string[] {
  act(() => (trigger as HTMLElement).click());
  const labels = [...document.querySelectorAll("[role='menuitemradio']")].map((o) => (o.textContent ?? "").replace("✓", "").trim());
  act(() => (trigger as HTMLElement).click());
  return labels;
}
const byLabel = (label: string) => [...document.querySelectorAll("button[aria-label]")].find((b) => b.getAttribute("aria-label")!.startsWith(label))!;

describe("Add transaction", () => {
  const show = (defaultAccountId: number | null) =>
    act(() =>
      root.render(
        <NewTransactionDialog accounts={ACCOUNTS} categories={[]} familyMembers={[]} defaultAccountId={defaultAccountId} budgetActuals={[]} onCancel={vi.fn()} onSubmit={vi.fn()} />,
      ),
    );

  it("does not offer a hidden account", () => {
    show(1);
    expect(choices(byLabel("Account"))).toEqual(["Checking", "Card"]);
  });

  it("does not start on a hidden account even when it was the last one used", () => {
    show(2);
    const trigger = byLabel("Account") as HTMLElement;
    expect(trigger.textContent).toContain("Checking");
    expect(trigger.textContent).not.toContain("Old Savings");
  });
});

describe("the import account question", () => {
  it("does not offer a hidden account", () => {
    act(() => root.render(<ChooseImportAccountDialog accounts={ACCOUNTS} onCancel={vi.fn()} onChoose={vi.fn()} onNewAccount={vi.fn()} />));
    expect(choices(document.querySelector("[data-import-account]")!)).toEqual(["Checking", "Card", "+ New account"]);
  });
});

describe("import review", () => {
  const review = (overrides: Partial<ImportReview["pendingImport"]> = {}, rowAccount: string | null = null) =>
    ({
      pendingImport: {
        path: "C:/bank.csv", invertAmounts: false, defaultAccountId: 1,
        preview: {
          rows: [{ index: 0, date: "2026-09-21", description: "SHOP", amount: "-10.00", is_duplicate: false, account_name: rowAccount, category: null, matched_category: "Groceries", suggestion: null }],
          row_errors: 0, unmatched_categories: [], review_token: "t", choice_below: 0.5,
        },
        ...overrides,
      },
      includedIndices: new Set([0]), accountOverrides: new Map(), importCategoryChoices: {}, importRowChoices: new Map(),
      setImportRowChoices: vi.fn(), begin: vi.fn(), toggleIncluded: vi.fn(), toggleSelectAllImportRows: vi.fn(), setImportRowAccount: vi.fn(),
      updateImportCategoryChoices: vi.fn(), leaveRestOfRowsUncategorized: vi.fn(), confirmPendingImport: vi.fn(), cancelPendingImport: vi.fn(), notice: null,
    }) as unknown as ImportReview;
  const show = (r: ImportReview) =>
    act(() => root.render(<ImportReviewDialog review={r} accounts={ACCOUNTS} categoryOptions={["Groceries"]} busy={false} />));

  it("offers visible accounts for a row, and a row's own hidden account if it is the one chosen", () => {
    show(review());
    expect(choices(byLabel('Account for "SHOP"'))).toEqual(["Checking", "Card"]);
    show(review({ defaultAccountId: 2 }));
    expect(choices(byLabel('Account for "SHOP"'))).toEqual(["Checking", "Old Savings", "Card"]);
  });

  it("does not call a row 'new' when its account column names a hidden account", () => {
    show(review({}, "old savings"));
    expect(document.body.textContent).not.toContain("(new)");
    show(review({}, "Brand New Bank"));
    expect(document.body.textContent).toContain("CSV: Brand New Bank (new)");
  });
});

describe("goals", () => {
  const goal = (over: Partial<Bucket> = {}): Bucket => ({
    id: 5, name: "Holiday", target_amount: "800.00", saved_amount: "0.00", target_date: null, account_id: null, account_name: null,
    member_id: null, member_name: null, sinking_amount: null, color: null, icon_key: null, tracks_account: false, monthly_pace: "0", ...over,
  });
  const show = (buckets: Bucket[]) =>
    act(() =>
      root.render(<BucketsView buckets={buckets} accounts={ACCOUNTS} familyMembers={[]} onCreateBucket={vi.fn()} onUpdateBucketDetails={vi.fn()} onAddContribution={vi.fn()} onDeleteBucket={vi.fn()} />),
    );
  const press = (text: string) => act(() => [...document.querySelectorAll("button")].find((b) => b.textContent?.trim().startsWith(text))!.click());

  it("leaves a hidden account out of a new goal's linked-account choices", () => {
    show([goal()]);
    act(() => [...document.querySelectorAll("button")].find((b) => /New goal/.test(b.textContent ?? ""))!.click());
    expect(choices(byLabel("Linked account"))).toEqual(["No linked account", "Checking", "Card"]);
  });

  it("keeps a goal's hidden linked account in its Edit form, and leaves other hidden accounts out", () => {
    show([goal({ account_id: 2, account_name: "Old Savings" })]);
    press("Edit");
    expect(choices(byLabel("Linked account"))).toEqual(["No linked account", "Checking", "Old Savings", "Card"]);
  });
});

describe("recurring", () => {
  it("leaves a hidden account out of a new recurring item's linked-account choices", () => {
    act(() =>
      root.render(
        <RecurringView recurring={[]} matches={[]} totals={{ monthly_expense: "0", annual_expense: "0", monthly_income: "0", annual_income: "0" }}
          candidates={[]} accounts={ACCOUNTS} familyMembers={[]} categoryIconMap={{}} onCreate={vi.fn()} onUpdate={vi.fn()} onDelete={vi.fn()}
          onSetStatus={vi.fn()} onAddCandidate={vi.fn()} onDismissCandidate={vi.fn()} onIgnorePriceChange={vi.fn(async () => {})} />,
      ),
    );
    const add = [...document.querySelectorAll("button")].find((b) => /^(\+ )?Add (a )?(recurring|bill)/i.test(b.textContent?.trim() ?? "") || /New recurring/i.test(b.textContent ?? ""));
    expect(add, "an add button").toBeDefined();
    act(() => add!.click());
    expect(choices(byLabel("Linked account"))).toEqual(["No linked account", "Checking", "Card"]);
  });
});

describe("holding import", () => {
  it("does not offer a hidden investment account", async () => {
    const investments = [acct(7, "Brokerage", { account_type: "investment" }), acct(8, "Old IRA", { account_type: "investment", hidden: true })];
    await act(async () => root.render(<HoldingImportDialog accounts={investments} onClose={vi.fn()} onSaved={vi.fn(async () => {})} />));
    expect(choices(byLabel("Import account"))).toEqual(["Brokerage"]);
  });
});
