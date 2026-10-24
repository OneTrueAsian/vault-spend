import { array, boolean, date, integer, nullable, object, string } from "../contractChecks";
import { TransactionError } from "../transactionContracts";
import { addMoney, compareMoney, isMoney, subtractMoney } from "./money";
import type { AskVaultSnapshotV2 } from "./contractV2";
import { checkVersion2, periodExtraShape, snapshotExtraShape } from "./contractV2";
import type { AskDataRevision, AskKind, AskFamilyMember, AskVaultRequest, AskVaultRequestV2 } from "./types";

export type AskCategoryRow = { category: string | null; amount: string; purchaseCount: number };
export type AskPurchaseRow = {
  transactionId: number;
  accountId: number;
  date: string;
  description: string;
  amount: string;
  parentAmount: string;
};
export type AskVendorRow = { description: string; purchaseCount: number };
export type AskVendorTotal = { term: string; total: string; purchaseCount: number };
export type AskLeftOut = { total: string; purchaseCount: number; vendors: AskVendorRow[]; categories: AskCategoryRow[] };
export type AskPeriodResult = {
  from: string;
  to: string;
  dayCount: number;
  endsToday: boolean;
  historyCoverage: "unknown";
  total: string;
  purchaseCount: number;
  categoryCount: number;
  categories: AskCategoryRow[];
  purchases: AskPurchaseRow[];
  /** The names a store filter matched, most purchases first (at most 10). */
  vendors: AskVendorRow[];
  vendorNameCount: number;
  /** One line per store asked for, in order; the totals add up to `total`. */
  vendorTotals: AskVendorTotal[];
  /** What the exclusions removed. */
  leftOut: AskLeftOut;
};
export type AskVaultSnapshot = {
  contractVersion: 1;
  context: { generation: number; sessionRevision: number };
  revision: AskDataRevision;
  asOf: string;
  kind: AskKind;
  spendingBasis: "gross-negative-allocations";
  thresholdBasis: "absolute-parent-amount";
  periods: AskPeriodResult[];
  difference: string | null;
};

const money = (v: unknown) => isMoney(v);
const positiveId = (v: unknown) => integer(v) && (v as number) > 0;
const categoryRow = object({ category: nullable(string), amount: money, purchaseCount: integer });
const purchaseRow = object({ transactionId: positiveId, accountId: positiveId, date, description: string, amount: money, parentAmount: money });
const vendorRow = object({ description: string, purchaseCount: integer });
const vendorTotal = object({ term: string, total: money, purchaseCount: integer });
const leftOut = object({ total: money, purchaseCount: integer, vendors: array(vendorRow), categories: array(categoryRow) });
const periodResult = object({
  from: date,
  to: date,
  dayCount: integer,
  endsToday: boolean,
  historyCoverage: (v) => v === "unknown",
  total: money,
  purchaseCount: integer,
  categoryCount: integer,
  categories: array(categoryRow),
  purchases: array(purchaseRow),
  vendors: array(vendorRow),
  vendorNameCount: integer,
  vendorTotals: array(vendorTotal),
  leftOut,
});
const shapeFor = (version: 1 | 2) => object({
  contractVersion: (v) => v === version,
  context: object({ generation: integer, sessionRevision: integer }),
  revision: object({ local: integer, external: integer }),
  asOf: date,
  kind: (v) => v === "total" || v === "rank-categories" || v === "rank-purchases" || v === "compare",
  spendingBasis: (v) => v === "gross-negative-allocations",
  thresholdBasis: (v) => v === "absolute-parent-amount",
  periods: array(periodResult),
  difference: nullable((v) => typeof v === "string" && /^-?\d+(?:\.\d+)?$/.test(v)),
});
const shapeV1 = shapeFor(1);
const shapeV2 = shapeFor(2);

const days = (from: string, to: string) => Math.round((Date.parse(to + "T00:00:00Z") - Date.parse(from + "T00:00:00Z")) / 86_400_000) + 1;
const descending = (rows: { amount: string }[]) => rows.every((row, i) => i === 0 || compareMoney(rows[i - 1].amount, row.amount) >= 0);

const MAX_VENDOR_NAMES = 10;
function checkVendors(result: AskPeriodResult, request: AskVaultRequest): void {
  const { vendors, vendorNameCount, purchaseCount } = result;
  checkLeftOut(result, request);
  if (request.vendors.length === 0) {
    if (vendors.length || vendorNameCount || result.vendorTotals.length) invalid();
    return;
  }
  const lines = result.vendorTotals;
  if (lines.length !== request.vendors.length || lines.some((line, i) => line.term !== request.vendors[i])) invalid();
  if (compareMoney(lines.reduce((sum, line) => addMoney(sum, line.total), "0"), result.total) !== 0) invalid();
  if (lines.reduce((sum, line) => sum + line.purchaseCount, 0) !== purchaseCount) invalid();
  const counts = vendors.map((v) => v.purchaseCount);
  const listed = counts.reduce((a, b) => a + b, 0);
  if (vendors.length > MAX_VENDOR_NAMES || vendors.length > vendorNameCount) invalid();
  if (counts.some((n, i) => i > 0 && counts[i - 1] < n)) invalid();
  if (listed > purchaseCount || (vendors.length === vendorNameCount && listed !== purchaseCount)) invalid();
  if ((purchaseCount > 0) !== (vendorNameCount > 0)) invalid();
}

function checkLeftOut(result: AskPeriodResult, request: AskVaultRequest): void {
  const out = result.leftOut;
  const asked = request.excludeVendors.length > 0 || request.excludeCategories.length > 0;
  const names = out.vendors.map((v) => v.purchaseCount);
  if (!asked) {
    if (compareMoney(out.total, "0") !== 0 || out.purchaseCount || out.vendors.length || out.categories.length) invalid();
    return;
  }
  if ((compareMoney(out.total, "0") > 0) !== (out.purchaseCount > 0)) invalid();
  if (request.excludeVendors.length === 0 && out.vendors.length) invalid();
  if (out.vendors.length > MAX_VENDOR_NAMES || names.some((n, i) => i > 0 && names[i - 1] < n)) invalid();
  if (out.categories.some((c) => c.category === null || !request.excludeCategories.includes(c.category))) invalid();
}

function invalid(): never {
  throw new TransactionError("invalid_response", "The app received an incomplete answer. Ask again.");
}

/** What the Dashboard already knows, so a reply cannot vouch for its own roster. Required to check a "by family member" answer fully. */
export type AskKnownPeople = { familyMembers?: AskFamilyMember[] };

const isVersion2 = (request: AskVaultRequest | AskVaultRequestV2): request is AskVaultRequestV2 =>
  (request as { contractVersion?: unknown }).contractVersion === 2;

/**
 * Check a native spending reply against the request that produced it. A reply that does not echo the
 * question, or whose rows or money cannot be trusted, is refused rather than shown. A request without
 * `contractVersion` is a version 1 request and only a version 1 reply fits it; a version 2 request needs a
 * version 2 reply, which must also reproduce from its own numbers. `known` supplies the family roster for that check.
 */
export function validateAskVaultSnapshot(value: unknown, request: AskVaultRequestV2, known?: AskKnownPeople): AskVaultSnapshotV2;
export function validateAskVaultSnapshot(value: unknown, request: AskVaultRequest): AskVaultSnapshot;
export function validateAskVaultSnapshot(
  value: unknown,
  request: AskVaultRequest | AskVaultRequestV2,
  known?: AskKnownPeople,
): AskVaultSnapshot | AskVaultSnapshotV2 {
  const version2 = isVersion2(request);
  if (!(version2 ? shapeV2 : shapeV1)(value)) return invalid();
  if (version2 && !(snapshotExtraShape(value) && (value as { periods: unknown[] }).periods.every(periodExtraShape))) return invalid();
  const reply = value as AskVaultSnapshot;
  if (reply.kind !== request.kind || reply.periods.length !== request.periods.length) return invalid();

  reply.periods.forEach((result, index) => {
    const asked = request.periods[index];
    if (result.from !== asked.from || result.to !== asked.to) invalid();
    if (result.dayCount !== days(result.from, result.to)) invalid();
    if (result.endsToday !== (result.to === reply.asOf)) invalid();
    if (result.to > reply.asOf) invalid();
    const wantsCategories = request.kind === "rank-categories";
    const wantsPurchases = request.kind === "rank-purchases";
    if (!wantsCategories && result.categories.length) invalid();
    if (!wantsPurchases && result.purchases.length) invalid();
    if (result.categories.length > request.limit || result.purchases.length > request.limit) invalid();
    if (!descending(result.categories) || !descending(result.purchases)) invalid();
    checkVendors(result, request);
    if (result.categories.length > result.categoryCount || result.purchases.length > result.purchaseCount) invalid();
  });

  if (request.kind === "compare") {
    if (reply.difference === null) return invalid();
    // Compared as amounts, not as text: the native side writes "-4882.10" where subtraction here gives "-4882.1".
    if (compareMoney(subtractMoney(reply.periods[0].total, reply.periods[1].total), reply.difference) !== 0) return invalid();
  } else if (reply.difference !== null) {
    return invalid();
  }
  if (version2) {
    checkVersion2(value as AskVaultSnapshotV2, request, known?.familyMembers);
    return value as AskVaultSnapshotV2;
  }
  return reply;
}
