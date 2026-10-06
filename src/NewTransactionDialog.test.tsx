// @vitest-environment jsdom
//
// Add transaction (s11): a Money out / Money in switch decides the sign instead of a typed minus
// sign; it reads Charge / Payment on a credit card or loan. A typed sign is ignored, and zero is
// refused.
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { act, type ComponentProps } from "react";
import { createRoot, type Root } from "react-dom/client";

vi.mock("@tauri-apps/api/core", () => ({ invoke: vi.fn(async () => null) }));

import { NewTransactionDialog } from "./Modal";
import type { Account } from "./types";

(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

function account(over: Partial<Account>): Account {
  return {
    id: 1,
    name: "Everyday Checking",
    account_type: "checking",
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
    ...over,
  } as Account;
}

const ACCOUNTS = [account({}), account({ id: 2, name: "Visa", account_type: "credit" })];

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

function render(over: Partial<ComponentProps<typeof NewTransactionDialog>> = {}) {
  const props: ComponentProps<typeof NewTransactionDialog> = {
    accounts: ACCOUNTS,
    categories: [],
    familyMembers: [],
    defaultAccountId: 1,
    budgetActuals: [],
    onCancel: vi.fn(),
    onSubmit: vi.fn(),
    ...over,
  };
  act(() => root.render(<NewTransactionDialog {...props} />));
  return props;
}

const direction = () => document.querySelector<HTMLElement>('[role="radiogroup"][aria-label="Direction"]');
const radios = () => [...(direction()?.querySelectorAll<HTMLButtonElement>('[role="radio"]') ?? [])];
const radio = (label: string) => radios().find((r) => r.textContent?.trim() === label);
const amountInput = () => document.querySelector<HTMLInputElement>("input[data-amount-input]");

function type(input: HTMLInputElement, value: string) {
  const setter = Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, "value")!.set!;
  act(() => {
    setter.call(input, value);
    input.dispatchEvent(new Event("input", { bubbles: true }));
  });
}

function fill(amount: string) {
  type(document.querySelector<HTMLInputElement>('input[placeholder=\'e.g. "Coffee shop"\']')!, "Coffee");
  type(amountInput()!, amount);
}

function submit() {
  const form = amountInput()!.closest("form")!;
  act(() => form.requestSubmit());
}

describe("NewTransactionDialog direction switch", () => {
  it("shows a Direction switch with Money out chosen, above a 0.00 amount field", () => {
    render();
    expect(direction()).not.toBeNull();
    expect(radios().map((r) => r.textContent?.trim())).toEqual(["Money out", "Money in"]);
    expect(radio("Money out")!.getAttribute("aria-checked")).toBe("true");
    expect(radio("Money in")!.getAttribute("aria-checked")).toBe("false");
    const input = amountInput()!;
    expect(input).not.toBeNull();
    expect(input.placeholder).toBe("0.00");
    expect(input.getAttribute("inputmode")).toBe("decimal");
    expect(direction()!.compareDocumentPosition(input) & Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy();
  });

  it("reads Charge / Payment for a credit card account", () => {
    render();
    act(() => document.querySelector<HTMLButtonElement>('.menu-select-toggle[aria-label="Account"], .menu-select-toggle')!.click());
    const visa = [...document.querySelectorAll<HTMLElement>("[role='menuitemradio']")].find((el) => el.textContent?.includes("Visa"))!;
    act(() => visa.click());
    expect(radios().map((r) => r.textContent?.trim())).toEqual(["Charge", "Payment"]);
  });

  it("saves 50 with Money out as -50", () => {
    const props = render();
    fill("50");
    submit();
    expect(props.onSubmit).toHaveBeenCalledTimes(1);
    expect(vi.mocked(props.onSubmit).mock.calls[0][3]).toBe("-50");
  });

  it("saves a typed -50 with Money in as 50: the switch decides", () => {
    const props = render();
    act(() => radio("Money in")!.click());
    expect(radio("Money in")!.getAttribute("aria-checked")).toBe("true");
    fill("-50");
    submit();
    expect(vi.mocked(props.onSubmit).mock.calls[0][3]).toBe("50");
  });

  it("refuses zero", () => {
    const props = render();
    fill("0");
    submit();
    expect(props.onSubmit).not.toHaveBeenCalled();
    expect(document.body.textContent).toContain("Enter an amount other than zero.");
  });

  it("keeps the empty and not-a-number messages", () => {
    const props = render();
    fill("");
    submit();
    expect(document.body.textContent).toContain("Enter an amount.");
    type(amountInput()!, "12abc");
    expect(document.body.textContent).toContain("That doesn't look like a number.");
    expect(props.onSubmit).not.toHaveBeenCalled();
  });
});
