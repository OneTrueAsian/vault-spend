/**
 * Strict display verification for the combined harness (owner instruction of 21 October 2026: "one expected amount appears" is not proof of a ranking).
 * Test-only and independent of src/askVault/answer.ts: dollars, month names, dates and plurals are formatted here from the reply's exact strings.
 * It checks, for the reply the card was given:
 *  - every ranked or broken-down row, in order: the label, the amount and the detail, and the number of rows;
 *  - the headline total and purchase count of a total, the "no spending" wording of an empty period, and both totals and the difference of a comparison.
 * Problems are returned as text; an empty list means the card displayed the reply faithfully.
 */
type Row = { label: string; amount: string; detail: string; vendorLabel?: boolean; requireLabel?: boolean };
type Period = {
  total: string; purchaseCount: number; categoryCount?: number;
  from?: string; to?: string; dayCount?: number;
  categories?: { category: string | null; amount: string; purchaseCount: number }[];
  purchases?: { description: string; amount: string; parentAmount: string; date: string }[];
  memberTotals?: { name: string | null; total: string; purchaseCount: number }[];
  months?: { month: string; total: string; purchaseCount: number; coverage?: string }[];
  categoryTotals?: { category: string; total: string; purchaseCount: number }[];
  vendorTotals?: { term: string; total: string; purchaseCount: number }[];
  average?: { basis: "per-month" | "per-purchase"; numerator: string; denominator: number; value: string | null } | null;
};
export type ReplyValue = { contractVersion?: number; kind: string; periods: Period[]; difference: string | null;
  comparison?: { comparable: boolean; absoluteChange: string; percentChange: string | null; percentOutcome: string } | null };

export const money = (amount: string) => {
  const negative = amount.startsWith("-"), [whole, cents = "00"] = amount.replace("-", "").split(".");
  return `${negative ? "-" : ""}$${whole.replace(/\B(?=(\d{3})+(?!\d))/g, ",")}.${cents.padEnd(2, "0")}`;
};
const MONTHS = ["January", "February", "March", "April", "May", "June", "July", "August", "September", "October", "November", "December"];
const longDate = (iso: string) => `${MONTHS[Number(iso.slice(5, 7)) - 1]} ${Number(iso.slice(8, 10))}, ${iso.slice(0, 4)}`;
const monthName = (month: string) => `${MONTHS[Number(month.slice(5, 7)) - 1]} ${month.slice(0, 4)}`;
const purchases = (n: number) => `${n} ${n === 1 ? "purchase" : "purchases"}`;
const cents = (amount: string) => BigInt(amount.replace(".", ""));
const range = (from: string, to: string) => from === to ? longDate(from) : `${from.slice(0, 4) === to.slice(0, 4) ? longDate(from).replace(/, \d{4}$/, "") : longDate(from)} to ${longDate(to)}`;
// Financial-Rules R5a: month recording evidence is distinct from spending and is
// qualified in the result. This test-only wording map does not import answer.ts.
const COVERAGE: Record<string, string> = {
  complete: "Records support a full month", "in-progress": "Month still in progress", "partial-period": "Only part of this month was requested",
  "partly-recorded": "Recording started partway through this month", "before-records": "Before recording began; spending unknown",
  "no-records": "No records; spending unknown", "records-end": "Records do not continue past this month; spending may be incomplete",
};

/** One list or table the card shows: `heading` is the table caption, or null for the plain ranked list. */
export type Table = { heading: string | null; rows: Row[] };
/** The lists and tables the card shows for this reply, in order; the first is the main list (inline rows, then "Show all"), the rest sit in expandable notes. */
export function expectedTables(value: ReplyValue): Table[] {
  // A list with no rows is not drawn (an empty ranking shows only the "No spending found" headline).
  return rawTables(value).filter(t => t.rows.length > 0);
}
function rawTables(value: ReplyValue): Table[] {
  const p = value.periods[0];
  if (value.kind === "rank-categories") return [{ heading: null, rows: (p.categories ?? []).map(r => ({ label: r.category ?? "No category", amount: money(r.amount), detail: purchases(r.purchaseCount) })) }];
  if (value.kind === "rank-purchases") return [{ heading: null, rows: (p.purchases ?? []).map(r => ({ label: r.description, amount: money(r.amount),
    detail: longDate(r.date) + (cents(r.amount) !== cents(r.parentAmount) ? ` · part of a ${money(r.parentAmount)} purchase` : "") })) }];
  // Only the version 2 comparison lists its two periods in a table (answer.ts version2Comparison); a version 1 comparison states them in the headline.
  if (value.kind === "compare") return value.contractVersion !== 2 ? [] : [{ heading: "Compared periods", rows: value.periods.slice(0, 2).map(q => ({ label: "", requireLabel: true, amount: money(q.total),
    detail: q.from && q.to ? `${range(q.from, q.to)} · ${q.dayCount} ${q.dayCount === 1 ? "day" : "days"}` : "" })) }];
  if (value.kind !== "total") return [];
  const stores: Row[] = (p.vendorTotals?.length ?? 0) > 1 ? p.vendorTotals!.map(r => ({ label: r.term, vendorLabel: true, amount: money(r.total), detail: r.purchaseCount === 0 ? "no purchases" : purchases(r.purchaseCount) })) : [];
  const tables: Table[] = [];
  if (p.memberTotals?.length) tables.push({ heading: "Spending by family member", rows: p.memberTotals.map(r => ({ label: r.name ?? "Not assigned to anyone", amount: money(r.total), detail: purchases(r.purchaseCount) })) });
  if (p.months?.length) tables.push({ heading: "Spending by month", rows: p.months.map(r => ({ label: monthName(r.month), amount: money(r.total),
    detail: `${purchases(r.purchaseCount)}${r.coverage ? ` · ${COVERAGE[r.coverage] ?? "Unknown coverage"}` : ""}${p.average?.basis === "per-month" ? r.coverage === "complete" ? " · Included in average" : " · Left out of average" : ""}` })) });
  if ((p.categoryTotals?.length ?? 0) > 1) tables.push({ heading: "Spending by category", rows: p.categoryTotals!.map(r => ({ label: r.category, amount: money(r.total), detail: purchases(r.purchaseCount) })) });
  if (tables.length) { if (stores.length) tables.push({ heading: "Spending by store", rows: stores }); return tables; }
  return stores.length ? [{ heading: null, rows: stores }] : [];
}

const rowsOf = (tr: Element): Row => ({ label: tr.querySelector("th")?.textContent ?? "", amount: tr.querySelector("td.amount-col")?.textContent ?? "", detail: tr.querySelectorAll("td")[1]?.textContent ?? "" });
/** Every list and table displayed under `root`, in document order. */
export function readTables(root: ParentNode): Table[] {
  const out: Table[] = [];
  for (const el of root.querySelectorAll("ol.ledger-qa-rows, table.ledger-qa-breakdown")) {
    if (el.tagName === "OL") out.push({ heading: null, rows: [...el.querySelectorAll("li")].map(li => { const sp = li.querySelectorAll("span"); return { label: sp[0]?.textContent ?? "", amount: sp[1]?.textContent ?? "", detail: sp[2]?.textContent ?? "" }; }) });
    else out.push({ heading: el.querySelector("caption")?.textContent ?? null, rows: [...el.querySelectorAll("tbody tr")].map(rowsOf) });
  }
  return out;
}

/** Problems comparing the expected rows with the displayed ones. `limit` is how many the card shows inline before "Show all". */
export function rowProblems(expected: Row[], shown: Row[]): string[] {
  const problems: string[] = [];
  if (shown.length !== expected.length) problems.push(`shows ${shown.length} rows, expected ${expected.length}`);
  expected.forEach((row, i) => {
    const got = shown[i];
    if (!got) return;
    // Native vendor terms are case/space/punctuation normalized; UI labels retain the typed name.
    // Compare the name's identity without importing the production matcher as its own oracle.
    const vendorKey = (name: string) => name.toLowerCase().replace(/[^\p{L}\p{N}]/gu, "");
    const sameLabel = row.vendorLabel ? vendorKey(got.label) === vendorKey(row.label) : got.label === row.label;
    if (row.label !== "" && !sameLabel) problems.push(`row ${i + 1} label "${got.label}", expected "${row.label}"`);
    if (row.requireLabel && !got.label.trim()) problems.push(`row ${i + 1} label is empty`);
    if (got.amount !== row.amount) problems.push(`row ${i + 1} amount "${got.amount}", expected "${row.amount}"`);
    if (row.detail !== "" && !got.detail.startsWith(row.detail)) problems.push(`row ${i + 1} detail "${got.detail}", expected "${row.detail}"`);
  });
  return problems;
}

/** Headline and detail checks that do not depend on rows. `answer` is the card's answer element. */
export function summaryProblems(value: ReplyValue, answer: ParentNode): string[] {
  const headline = answer.querySelector(".ledger-qa-headline")?.textContent ?? "", detail = answer.querySelector(".ledger-qa-detail")?.textContent ?? "";
  const [a, b] = value.periods, problems: string[] = [];
  if (value.kind === "compare") {
    for (const p of [a, b]) if (!headline.includes(money(p.total))) problems.push(`headline lacks ${money(p.total)}`);
    const d = value.difference ?? "0.00", size = money(d.replace(/^-/, ""));
    const wanted = cents(d) > 0n ? `${size} more` : cents(d) < 0n ? `${size} less` : "the same amount";
    if (!detail.includes(wanted)) problems.push(`detail lacks "${wanted}"`);
    const comparison = value.comparison;
    if (comparison) {
      if (!comparison.comparable || comparison.percentChange === null) {
        if (/%/.test(detail)) problems.push("unexpected comparison percentage");
        if (comparison.comparable && comparison.percentOutcome === "from-zero" && !detail.includes("up from nothing")) problems.push("missing from-zero comparison explanation");
      } else {
        const change = cents(comparison.absoluteChange), percent = change === 0n ? "No change (0.0%)." : `${comparison.percentChange.replace(/^-/, "")}% ${change > 0n ? "more" : "less"}`;
        if (!detail.includes(percent)) problems.push(`comparison percentage lacks "${percent}"`);
      }
    }
    return problems;
  }
  // M2 Financial-Rules R7/R8 and VP-06/08: the average's value, basis and divisor
  // are financial outputs. A headline containing "averaged" is never an exemption.
  if (a.average) {
    const average = a.average, unit = average.basis === "per-month" ? "month" : "purchase";
    if (average.value === null) {
      const empty = average.basis === "per-month" ? "No monthly average available" : "No purchases to average";
      if (!headline.startsWith(empty)) problems.push(`average headline lacks "${empty}"`);
      if (!detail.includes(`${money(a.total)} recorded`)) problems.push(`average detail lacks ${money(a.total)} recorded`);
    } else {
      const expected = `You averaged ${money(average.value)} per ${unit}`;
      if (!headline.startsWith(expected)) problems.push(`average headline lacks "${expected}"`);
      const arithmetic = `${money(average.numerator)} ÷ ${average.denominator} ${unit}${average.denominator === 1 ? "" : "s"}`;
      if (!detail.includes(arithmetic)) problems.push(`average detail lacks "${arithmetic}"`);
    }
    return problems;
  }
  if (a.purchaseCount === 0) { if (!/^No spending found|^No purchases|^No monthly average/.test(headline)) problems.push(`empty period but headline is "${headline}"`); return problems; }
  if (value.kind === "total" && !headline.includes(money(a.total))) problems.push(`headline lacks ${money(a.total)}`);
  if (value.kind === "total" && !detail.includes(purchases(a.purchaseCount))) problems.push(`detail lacks "${purchases(a.purchaseCount)}"`);
  if (value.kind === "rank-categories" && a.categoryCount !== undefined) {
    const of = `${a.categories?.length ?? 0} of ${a.categoryCount} ${a.categoryCount === 1 ? "category" : "categories"}`;
    if (!detail.includes(of)) problems.push(`detail lacks "${of}"`);
  }
  if (value.kind === "rank-purchases" && !detail.includes(purchases(a.purchaseCount))) problems.push(`detail lacks "${purchases(a.purchaseCount)}"`);
  return problems;
}
