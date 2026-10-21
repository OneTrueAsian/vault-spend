/** Executable specification for the native retirement-context reader (prerequisite 4).
 *
 * Seeds describe a fictional profile; `expected` replies are written by hand; `referenceRetirementContext` is a
 * separately written reference model of the same rules. Both must agree on every fixture. A backend worker
 * proves its Rust reader against the same seeds and expected replies. Synthetic, same-author evidence. */
import type { AskDataRevision } from "./types";
import { RETIREMENT_ROSTER_LIMIT, compareRetirementRosterRows } from "./retirementNativeContract";
import type { RetirementContextReply, RetirementRosterReply } from "./retirementNativeContract";

export type SeedAccount = {
  id: number; name: string; type: "checking" | "savings" | "credit" | "loan" | "investment"; startingBalance: string;
  /** Balance checkpoints in insertion order. The latest DATE on or before today wins; two on one date go to the later insertion
   *  (core/src/store/accounts.rs latest_checkpoint: ORDER BY reset_date DESC, id DESC). */
  resets?: { date: string; balance: string }[];
  holdings?: { shares: string; price: string }[];
  transactions?: { date: string; amount: string; deleted?: boolean }[];
};
export type NativeSeed = {
  profile: { generation: number; sessionRevision: number; revision: AskDataRevision; locked?: boolean };
  accounts: SeedAccount[];
  plans?: { accountId: number; monthly: string | null; returnPct: string; withdrawMonth: string | null }[];
  inflationPct?: string | null;
};
export type NativeOrigin = { generation: number; sessionRevision: number };
export type NativeExpectation = { reply: RetirementContextReply } | { error: "account_unavailable" | "stale_data" | "stale_profile" };
export type RosterExpectation = { reply: RetirementRosterReply } | { error: "stale_data" | "stale_profile" | "too_many_accounts" };
export type NativeFixture = {
  id: string; covers: string[]; note: string; today: string; seed: NativeSeed; accountId: number;
  expectedRevision?: AskDataRevision | null; origin?: NativeOrigin; expected: NativeExpectation;
};

// ---- Reference model -------------------------------------------------------------------------------------------
type Dec = { c: bigint; s: number };
const parse = (text: string): Dec => {
  const [w, f = ""] = text.replace("-", "").split(".");
  const c = BigInt(w + f); return { c: text.startsWith("-") ? -c : c, s: f.length };
};
const align = (a: Dec, b: Dec): [bigint, bigint, number] => { const s = Math.max(a.s, b.s); return [a.c * 10n ** BigInt(s - a.s), b.c * 10n ** BigInt(s - b.s), s]; };
const add = (a: Dec, b: Dec): Dec => { const [x, y, s] = align(a, b); return { c: x + y, s }; };
const mul = (a: Dec, b: Dec): Dec => ({ c: a.c * b.c, s: a.s + b.s });
/** Normalised plain decimal: no trailing fractional zeros, no negative zero. */
function text({ c, s }: Dec): string {
  while (s > 0 && c % 10n === 0n) { c /= 10n; s--; }
  const neg = c < 0n, digits = (neg ? -c : c).toString().padStart(s + 1, "0");
  return (neg ? "-" : "") + (s ? digits.slice(0, -s) + "." + digits.slice(-s) : digits);
}
const month = (day: string) => day.slice(0, 7);
const monthIndex = (m: string) => Number(m.slice(0, 4)) * 12 + Number(m.slice(5, 7)) - 1;
const monthText = (index: number) => `${String(Math.floor(index / 12)).padStart(4, "0")}-${String((index % 12) + 1).padStart(2, "0")}`;

function worthOf(account: SeedAccount, today: string): { amount: string | null; basis: "holdings" | "transactions" | "none" } {
  if (account.holdings?.length) return { amount: text(account.holdings.reduce((sum, h) => add(sum, mul(parse(h.shares), parse(h.price))), { c: 0n, s: 0 })), basis: "holdings" };
  const live = (account.transactions ?? []).filter(t => !t.deleted && t.date <= today);
  const resets = (account.resets ?? []).filter(r => r.date <= today);
  const reset = resets.reduce<{ date: string; balance: string } | null>((best, r) => (!best || r.date >= best.date ? r : best), null);
  if (!reset && !live.length && parse(account.startingBalance).c === 0n) return { amount: null, basis: "none" };
  let balance = reset ? parse(reset.balance) : parse(account.startingBalance);
  for (const t of live) if (!reset || t.date > reset.date) balance = add(balance, parse(t.amount));
  return { amount: text(balance), basis: "transactions" };
}

/** The existing Accumulation rule: up to six complete months before this one, starting no earlier than the first deposit. */
function historyOf(account: SeedAccount, today: string): RetirementContextReply["contribution"] {
  const deposits = (account.transactions ?? []).filter(t => !t.deleted && t.date <= today && parse(t.amount).c > 0n).sort((a, b) => a.date.localeCompare(b.date));
  if (!deposits.length) return { kind: "missing" };
  const end = monthIndex(month(today)) - 1, start = Math.max(monthIndex(month(deposits[0].date)), end - 5);
  if (end < start) return { kind: "missing" };
  // Exact decimal sum of every deposit in the window, then ONE division and ONE half-away-from-zero rounding to cents.
  let sum: Dec = { c: 0n, s: 0 };
  for (const d of deposits) { const index = monthIndex(month(d.date)); if (index >= start && index <= end) sum = add(sum, parse(d.amount)); }
  const months = BigInt(end - start + 1), numerator = sum.c * 100n, denominator = 10n ** BigInt(sum.s) * months;
  const rounded = (2n * numerator + denominator) / (2n * denominator); // deposits are positive, so half-up is half-away-from-zero
  return { kind: "history", monthlyAmount: text({ c: rounded, s: 2 }), fromMonth: monthText(start), toMonth: monthText(end), monthCount: end - start + 1 };
}

export function referenceRetirementContext(fixture: Pick<NativeFixture, "seed" | "today" | "accountId" | "expectedRevision" | "origin">): NativeExpectation {
  const { seed, today, accountId } = fixture, p = seed.profile;
  if (p.locked || (fixture.origin && (fixture.origin.generation !== p.generation || fixture.origin.sessionRevision !== p.sessionRevision))) return { error: "stale_profile" };
  const revision = fixture.expectedRevision;
  if (revision && (revision.local !== p.revision.local || revision.external !== p.revision.external)) return { error: "stale_data" };
  const account = seed.accounts.find(a => a.id === accountId);
  if (!account || account.type !== "investment") return { error: "account_unavailable" };
  const plan = seed.plans?.find(row => row.accountId === accountId);
  const inflation = seed.inflationPct;
  const contribution = plan && plan.monthly !== null ? { kind: "saved" as const, monthlyAmount: text(parse(plan.monthly)) } : historyOf(account, today);
  return { reply: {
    contractVersion: 1, context: { generation: p.generation, sessionRevision: p.sessionRevision }, revision: { ...p.revision }, asOf: today,
    account: { id: account.id, name: account.name, type: "investment" }, worth: worthOf(account, today), contribution,
    returnAssumption: plan ? { kind: "stored-plan", annualPct: text(parse(plan.returnPct)) } : { kind: "application-default", annualPct: "7" },
    inflation: inflation != null ? { kind: "stored", pct: text(parse(inflation)) } : { kind: "application-default", pct: "3" },
    retirementMonth: plan?.withdrawMonth ?? null,
  } };
}

export function referenceRetirementRoster(seed: NativeSeed, today: string, origin?: NativeOrigin, expectedRevision?: AskDataRevision | null): RosterExpectation {
  const p = seed.profile;
  if (p.locked || (origin && (origin.generation !== p.generation || origin.sessionRevision !== p.sessionRevision))) return { error: "stale_profile" };
  if (expectedRevision && (expectedRevision.local !== p.revision.local || expectedRevision.external !== p.revision.external)) return { error: "stale_data" };
  const accounts = seed.accounts.filter(a => a.type === "investment").map(a => ({ id: a.id, name: a.name })).sort(compareRetirementRosterRows);
  if (accounts.length > RETIREMENT_ROSTER_LIMIT) return { error: "too_many_accounts" }; // never a partial list
  return { reply: { contractVersion: 1, context: { generation: p.generation, sessionRevision: p.sessionRevision }, revision: { ...p.revision }, asOf: today, accounts } };
}

// ---- Fixtures ----------------------------------------------------------------------------------------------------
const TODAY = "2026-10-17";
const profile = (extra: Partial<NativeSeed["profile"]> = {}): NativeSeed["profile"] => ({ generation: 3, sessionRevision: 11, revision: { local: 40, external: 7 }, ...extra });
const roth = (over: Partial<SeedAccount> = {}): SeedAccount => ({ id: 5, name: "Roth IRA", type: "investment", startingBalance: "0", ...over });
const dep = (date: string, amount: string, deleted = false) => ({ date, amount, ...(deleted ? { deleted } : {}) });
const reply = (over: Partial<RetirementContextReply> = {}): RetirementContextReply => ({
  contractVersion: 1, context: { generation: 3, sessionRevision: 11 }, revision: { local: 40, external: 7 }, asOf: TODAY,
  account: { id: 5, name: "Roth IRA", type: "investment" }, worth: { amount: null, basis: "none" }, contribution: { kind: "missing" },
  returnAssumption: { kind: "application-default", annualPct: "7" }, inflation: { kind: "application-default", pct: "3" }, retirementMonth: null, ...over,
});
const fx = (id: string, covers: string[], note: string, seed: Partial<NativeSeed> & { accounts: SeedAccount[] }, expected: NativeExpectation, extra: Partial<NativeFixture> = {}): NativeFixture =>
  ({ id, covers, note, today: TODAY, seed: { profile: profile(), ...seed }, accountId: 5, expected, ...extra });

export function retirementNativeFixtures(): NativeFixture[] {
  const planFull = { accountId: 5, monthly: "300.00", returnPct: "6.00", withdrawMonth: "2050-06" };
  return [
    fx("full-saved-plan-holdings", ["N1", "N2", "N3", "N4"], "holdings value, saved monthly amount, stored 6% return, saved inflation, saved withdraw month",
      { accounts: [roth({ holdings: [{ shares: "10.5", price: "200.00" }, { shares: "3", price: "1500.25" }] })], plans: [planFull], inflationPct: "2.5" },
      { reply: reply({ worth: { amount: "6600.75", basis: "holdings" }, contribution: { kind: "saved", monthlyAmount: "300" }, returnAssumption: { kind: "stored-plan", annualPct: "6" }, inflation: { kind: "stored", pct: "2.5" }, retirementMonth: "2050-06" }) }),
    fx("no-plan-row-default-return", ["N2", "E1"], "no plan row: the 7% default is application-default, never stored-plan",
      { accounts: [roth({ holdings: [{ shares: "1", price: "1000" }] })] }, { reply: reply({ worth: { amount: "1000", basis: "holdings" } }) }),
    fx("saved-zero-return", ["N2", "E1"], "a saved 0% return is stored-plan 0, distinct from missing and from the default",
      { accounts: [roth({ holdings: [{ shares: "1", price: "1000" }] })], plans: [{ accountId: 5, monthly: null, returnPct: "0", withdrawMonth: null }] },
      { reply: reply({ worth: { amount: "1000", basis: "holdings" }, returnAssumption: { kind: "stored-plan", annualPct: "0" } }) }),
    fx("saved-seven-is-only-a-candidate", ["N2", "E1"], "a saved 7% is stored-plan 7; history cannot tell it from an untouched default (documented limit)",
      { accounts: [roth({ holdings: [{ shares: "1", price: "1000" }] })], plans: [{ accountId: 5, monthly: null, returnPct: "7.00", withdrawMonth: null }] },
      { reply: reply({ worth: { amount: "1000", basis: "holdings" }, returnAssumption: { kind: "stored-plan", annualPct: "7" } }) }),
    fx("saved-zero-contribution-beats-history", ["N4", "E7"], "a saved 0 contribution is a saved choice and wins over deposit history",
      { accounts: [roth({ transactions: [dep("2026-08-05", "500"), dep("2026-09-05", "500")], holdings: [{ shares: "1", price: "2000" }] })], plans: [{ accountId: 5, monthly: "0.00", returnPct: "6", withdrawMonth: null }] },
      { reply: reply({ worth: { amount: "2000", basis: "holdings" }, contribution: { kind: "saved", monthlyAmount: "0" }, returnAssumption: { kind: "stored-plan", annualPct: "6" } }) }),
    fx("history-three-months", ["N3", "N4"], "no saved amount: mean of three complete months from the first deposit",
      { accounts: [roth({ transactions: [dep("2026-07-10", "300"), dep("2026-08-10", "300"), dep("2026-09-10", "300")] })] },
      { reply: reply({ worth: { amount: "900", basis: "transactions" }, contribution: { kind: "history", monthlyAmount: "300", fromMonth: "2026-07", toMonth: "2026-09", monthCount: 3 } }) }),
    fx("only-current-month-deposit", ["N4", "E7"], "a deposit only in the current month gives no usable contribution basis",
      { accounts: [roth({ transactions: [dep("2026-10-02", "400")] })] }, { reply: reply({ worth: { amount: "400", basis: "transactions" }, contribution: { kind: "missing" } }) }),
    fx("no-deposits-at-all", ["N4", "E7"], "no deposits: contribution is missing, not zero",
      { accounts: [roth({ startingBalance: "250" })] }, { reply: reply({ worth: { amount: "250", basis: "transactions" }, contribution: { kind: "missing" } }) }),
    fx("withdrawals-only", ["N3", "N4"], "money out is not a contribution; worth can be negative",
      { accounts: [roth({ transactions: [dep("2026-05-01", "-700")] })] }, { reply: reply({ worth: { amount: "-700", basis: "transactions" }, contribution: { kind: "missing" } }) }),
    fx("first-deposit-two-months-ago", ["N3", "N4"], "window starts at the first deposit month; the empty month counts as zero",
      { accounts: [roth({ transactions: [dep("2026-08-20", "200")] })] },
      { reply: reply({ worth: { amount: "200", basis: "transactions" }, contribution: { kind: "history", monthlyAmount: "100", fromMonth: "2026-08", toMonth: "2026-09", monthCount: 2 } }) }),
    fx("more-than-six-months-uses-six", ["N3", "N4"], "only the six complete months before this one count",
      { accounts: [roth({ transactions: [dep("2026-01-05", "9999"), dep("2026-04-05", "600"), dep("2026-05-05", "600"), dep("2026-06-05", "600"), dep("2026-07-05", "600"), dep("2026-08-05", "600"), dep("2026-09-05", "600")] })] },
      { reply: reply({ worth: { amount: "13599", basis: "transactions" }, contribution: { kind: "history", monthlyAmount: "600", fromMonth: "2026-04", toMonth: "2026-09", monthCount: 6 } }) }),
    fx("gap-months-count-as-zero", ["N3", "N4"], "zero months inside the window lower the mean",
      { accounts: [roth({ transactions: [dep("2026-04-05", "100"), dep("2026-09-05", "50")] })] },
      { reply: reply({ worth: { amount: "150", basis: "transactions" }, contribution: { kind: "history", monthlyAmount: "25", fromMonth: "2026-04", toMonth: "2026-09", monthCount: 6 } }) }),
    fx("mean-rounds-half-away", ["N3"], "5 cents over two months is 2.5 cents, which rounds to 3 cents",
      { accounts: [roth({ transactions: [dep("2026-08-01", "0.05")] })] },
      { reply: reply({ worth: { amount: "0.05", basis: "transactions" }, contribution: { kind: "history", monthlyAmount: "0.03", fromMonth: "2026-08", toMonth: "2026-09", monthCount: 2 } }) }),
    fx("tiny-mean-rounds-to-zero-history", ["N3", "N4"], "a history mean that rounds to 0.00 is still labelled history (not a saved 0)",
      { accounts: [roth({ transactions: [dep("2026-04-01", "0.01")] })] },
      { reply: reply({ worth: { amount: "0.01", basis: "transactions" }, contribution: { kind: "history", monthlyAmount: "0", fromMonth: "2026-04", toMonth: "2026-09", monthCount: 6 } }) }),
    fx("soft-deleted-and-future-deposits-ignored", ["N3"], "deleted rows and deposits dated after today never count",
      { accounts: [roth({ transactions: [dep("2026-08-05", "300"), dep("2026-09-05", "999", true), dep("2026-10-30", "777")] })] },
      { reply: reply({ worth: { amount: "300", basis: "transactions" }, contribution: { kind: "history", monthlyAmount: "150", fromMonth: "2026-08", toMonth: "2026-09", monthCount: 2 } }) }),
    fx("transfer-leg-counts-once", ["N3"], "a linked transfer into the account is one positive transaction on this account and counts once",
      { accounts: [roth({ transactions: [dep("2026-09-12", "250")] }), { id: 1, name: "Everyday Checking", type: "checking", startingBalance: "1000", transactions: [dep("2026-09-12", "-250")] }] },
      { reply: reply({ worth: { amount: "250", basis: "transactions" }, contribution: { kind: "history", monthlyAmount: "250", fromMonth: "2026-09", toMonth: "2026-09", monthCount: 1 } }) }),
    fx("holdings-replace-transaction-balance", ["N3", "E7"], "once holdings exist their value replaces the transaction balance entirely",
      { accounts: [roth({ startingBalance: "10", transactions: [dep("2026-09-05", "100")], holdings: [{ shares: "2", price: "25.5" }] })] },
      { reply: reply({ worth: { amount: "51", basis: "holdings" }, contribution: { kind: "history", monthlyAmount: "100", fromMonth: "2026-09", toMonth: "2026-09", monthCount: 1 } }) }),
    fx("balance-reset-checkpoint", ["N3"], "the latest checkpoint on or before today starts the balance; only later rows are added",
      { accounts: [roth({ startingBalance: "5", resets: [{ date: "2026-06-30", balance: "1000" }, { date: "2026-08-31", balance: "2000" }], transactions: [dep("2026-07-05", "100"), dep("2026-09-05", "30")] })] },
      { reply: reply({ worth: { amount: "2030", basis: "transactions" }, contribution: { kind: "history", monthlyAmount: "43.33", fromMonth: "2026-07", toMonth: "2026-09", monthCount: 3 } }) }),
    fx("backdated-checkpoint-latest-date-wins", ["N3", "F2"], "a checkpoint inserted later but dated earlier loses: the latest reset DATE wins, as in the native balance rule",
      { accounts: [roth({ startingBalance: "5", resets: [{ date: "2026-08-31", balance: "2000" }, { date: "2026-06-30", balance: "1000" }], transactions: [dep("2026-07-05", "100"), dep("2026-09-05", "30")] })] },
      { reply: reply({ worth: { amount: "2030", basis: "transactions" }, contribution: { kind: "history", monthlyAmount: "43.33", fromMonth: "2026-07", toMonth: "2026-09", monthCount: 3 } }) }),
    fx("same-date-checkpoints-later-insertion-wins", ["N3", "F2"], "two checkpoints on one date: the one recorded later wins",
      { accounts: [roth({ resets: [{ date: "2026-08-31", balance: "1500" }, { date: "2026-08-31", balance: "2000" }], transactions: [dep("2026-09-05", "30")] })] },
      { reply: reply({ worth: { amount: "2030", basis: "transactions" }, contribution: { kind: "history", monthlyAmount: "30", fromMonth: "2026-09", toMonth: "2026-09", monthCount: 1 } }) }),
    fx("same-date-checkpoints-reverse-order", ["N3", "F2"], "the same two checkpoints recorded in the opposite order give the other balance",
      { accounts: [roth({ resets: [{ date: "2026-08-31", balance: "2000" }, { date: "2026-08-31", balance: "1500" }], transactions: [dep("2026-09-05", "30")] })] },
      { reply: reply({ worth: { amount: "1530", basis: "transactions" }, contribution: { kind: "history", monthlyAmount: "30", fromMonth: "2026-09", toMonth: "2026-09", monthCount: 1 } }) }),
    fx("sub-cent-deposits-sum-before-rounding", ["N3", "F1"], "0.004 + 0.004 in one month is 0.008, which rounds once to 0.01 (rounding each deposit first would give 0)",
      { accounts: [roth({ transactions: [dep("2026-09-05", "0.004"), dep("2026-09-20", "0.004")] })] },
      { reply: reply({ worth: { amount: "0.008", basis: "transactions" }, contribution: { kind: "history", monthlyAmount: "0.01", fromMonth: "2026-09", toMonth: "2026-09", monthCount: 1 } }) }),
    fx("decimal-tie-rounds-away-from-zero", ["N3", "F1"], "1.005 is an exact tie in decimal and rounds up to 1.01 (a binary float gives 1)",
      { accounts: [roth({ transactions: [dep("2026-09-05", "1.005")] })] },
      { reply: reply({ worth: { amount: "1.005", basis: "transactions" }, contribution: { kind: "history", monthlyAmount: "1.01", fromMonth: "2026-09", toMonth: "2026-09", monthCount: 1 } }) }),
    fx("deposit-beyond-float-precision-stays-exact", ["N3", "F1"], "9007199254740993 is not representable as a double and must survive unchanged",
      { accounts: [roth({ transactions: [dep("2026-09-05", "9007199254740993")] })] },
      { reply: reply({ worth: { amount: "9007199254740993", basis: "transactions" }, contribution: { kind: "history", monthlyAmount: "9007199254740993", fromMonth: "2026-09", toMonth: "2026-09", monthCount: 1 } }) }),
    fx("many-small-deposits-across-months-exact-mean", ["N3", "F1"], "0.01 + 0.02 + 0.02 over three months is 0.05 / 3 = 0.01666..., which rounds to 0.02",
      { accounts: [roth({ transactions: [dep("2026-07-05", "0.01"), dep("2026-08-05", "0.02"), dep("2026-09-05", "0.02")] })] },
      { reply: reply({ worth: { amount: "0.05", basis: "transactions" }, contribution: { kind: "history", monthlyAmount: "0.02", fromMonth: "2026-07", toMonth: "2026-09", monthCount: 3 } }) }),
    fx("empty-account-worth-is-missing", ["N3", "E7"], "no holdings, no transactions, zero starting balance: worth is missing, never an invented zero",
      { accounts: [roth()] }, { reply: reply() }),
    fx("future-only-transaction-is-not-evidence", ["N3", "E7"], "a transaction dated after today does not make the worth known",
      { accounts: [roth({ transactions: [dep("2026-11-01", "100")] })] }, { reply: reply() }),
    fx("recorded-zero-is-not-missing", ["N3", "E7"], "holdings valued at 0 are a recorded 0, distinct from missing",
      { accounts: [roth({ holdings: [{ shares: "5", price: "0" }] })] }, { reply: reply({ worth: { amount: "0", basis: "holdings" } }) }),
    fx("negative-starting-balance", ["N3"], "a negative worth is reported exactly",
      { accounts: [roth({ startingBalance: "-500.50" })] }, { reply: reply({ worth: { amount: "-500.5", basis: "transactions" } }) }),
    fx("fractional-holdings-exact", ["N3"], "up to 28 decimal places stay exact",
      { accounts: [roth({ holdings: [{ shares: "0.0000000000000000000000000003", price: "3" }] })] }, { reply: reply({ worth: { amount: "0.0000000000000000000000000009", basis: "holdings" } }) }),
    fx("past-withdraw-month-stays-evidence", ["N2", "E3"], "a passed saved withdraw month is returned as a candidate; the calculator refuses it later",
      { accounts: [roth({ holdings: [{ shares: "1", price: "10" }] })], plans: [{ accountId: 5, monthly: "50", returnPct: "5", withdrawMonth: "2024-01" }] },
      { reply: reply({ worth: { amount: "10", basis: "holdings" }, contribution: { kind: "saved", monthlyAmount: "50" }, returnAssumption: { kind: "stored-plan", annualPct: "5" }, retirementMonth: "2024-01" }) }),
    fx("inflation-default-versus-stored-zero", ["N2", "U8"], "a stored 0% inflation is stored, not the default 3",
      { accounts: [roth({ holdings: [{ shares: "1", price: "10" }] })], inflationPct: "0.00" },
      { reply: reply({ worth: { amount: "10", basis: "holdings" }, inflation: { kind: "stored", pct: "0" } }) }),
    fx("year-boundary-window", ["N3", "N4"], "in January the window ends in December of the previous year",
      { accounts: [roth({ transactions: [dep("2025-10-05", "100"), dep("2025-12-05", "200")] })] },
      { reply: reply({ asOf: "2026-01-15", worth: { amount: "300", basis: "transactions" }, contribution: { kind: "history", monthlyAmount: "100", fromMonth: "2025-10", toMonth: "2025-12", monthCount: 3 } }) }, { today: "2026-01-15" }),
    fx("leap-day-as-of", ["N1", "N3"], "29 February as-of date: window ends in January",
      { accounts: [roth({ transactions: [dep("2024-01-10", "90")] })] },
      { reply: reply({ asOf: "2024-02-29", worth: { amount: "90", basis: "transactions" }, contribution: { kind: "history", monthlyAmount: "90", fromMonth: "2024-01", toMonth: "2024-01", monthCount: 1 } }) }, { today: "2024-02-29" }),
    fx("other-account-types-never-selectable", ["N1", "S1"], "a checking account is not an investment account",
      { accounts: [roth(), { id: 1, name: "Everyday Checking", type: "checking", startingBalance: "100" }] }, { error: "account_unavailable" }, { accountId: 1 }),
    fx("deleted-account-is-unavailable", ["N1", "S1"], "a deleted account no longer exists (accounts are hard-deleted)",
      { accounts: [roth()] }, { error: "account_unavailable" }, { accountId: 99 }),
    fx("profile-locked", ["N1", "I2"], "a locked profile never returns data", { profile: profile({ locked: true }), accounts: [roth()] }, { error: "stale_profile" }),
    fx("profile-switched-generation", ["N1", "I2"], "the caller's generation no longer matches the open profile",
      { accounts: [roth()] }, { error: "stale_profile" }, { origin: { generation: 2, sessionRevision: 11 } }),
    fx("session-revision-moved", ["N1", "I2"], "the caller's session revision no longer matches",
      { accounts: [roth()] }, { error: "stale_profile" }, { origin: { generation: 3, sessionRevision: 10 } }),
    fx("expected-revision-local-differs", ["N1", "I2", "E8"], "an expected revision that differs in the local counter is stale data",
      { accounts: [roth()] }, { error: "stale_data" }, { expectedRevision: { local: 39, external: 7 } }),
    fx("expected-revision-external-differs", ["N1", "I2", "E8"], "an expected revision that differs in the external counter is stale data",
      { accounts: [roth()] }, { error: "stale_data" }, { expectedRevision: { local: 40, external: 8 } }),
    fx("expected-revision-matches", ["N1", "I2"], "a matching expected revision reads normally",
      { accounts: [roth()] }, { reply: reply() }, { expectedRevision: { local: 40, external: 7 } }),
    fx("duplicate-names-are-different-accounts", ["N1", "P2"], "two accounts may share a name; the id selects one",
      { accounts: [roth({ holdings: [{ shares: "1", price: "5" }] }), roth({ id: 6, holdings: [{ shares: "1", price: "6" }] })] },
      { reply: reply({ account: { id: 6, name: "Roth IRA", type: "investment" }, worth: { amount: "6", basis: "holdings" } }) }, { accountId: 6 }),
  ];
}

/** Each way the answer to a review can go stale, and the counter that must expose it (E8: exact invalidation triggers). */
export type MutationScenario = { id: string; trigger: string; mutate: (seed: NativeSeed) => NativeSeed; changesContent: boolean };
export function retirementMutationScenarios(): MutationScenario[] {
  const local = (seed: NativeSeed, edit: (copy: NativeSeed) => void): NativeSeed => { const copy = structuredClone(seed); edit(copy); copy.profile.revision.local += 1; return copy; };
  return [
    { id: "add-deposit", trigger: "transaction-write", changesContent: true, mutate: s => local(s, c => { (c.accounts[0].transactions ??= []).push(dep("2026-09-20", "100")); }) },
    { id: "holding-price-refresh", trigger: "holding-write", changesContent: true, mutate: s => local(s, c => { c.accounts[0].holdings = [{ shares: "1", price: "1234" }]; }) },
    { id: "save-plan-return", trigger: "plan-save", changesContent: true, mutate: s => local(s, c => { c.plans = [{ accountId: 5, monthly: null, returnPct: "4", withdrawMonth: null }]; }) },
    { id: "save-inflation", trigger: "inflation-save", changesContent: true, mutate: s => local(s, c => { c.inflationPct = "4"; }) },
    { id: "rename-account", trigger: "account-edit", changesContent: true, mutate: s => local(s, c => { c.accounts[0].name = "Retirement IRA"; }) },
    { id: "change-account-type", trigger: "account-edit", changesContent: true, mutate: s => local(s, c => { c.accounts[0].type = "savings"; }) },
    { id: "delete-account", trigger: "account-edit", changesContent: true, mutate: s => local(s, c => { c.accounts = c.accounts.filter(a => a.id !== 5); }) },
    { id: "other-window-write", trigger: "external-write", changesContent: false, mutate: s => { const c = structuredClone(s); c.profile.revision.external += 1; return c; } },
    { id: "profile-switch", trigger: "profile-switch", changesContent: false, mutate: s => { const c = structuredClone(s); c.profile.generation += 1; return c; } },
    { id: "lock-and-unlock", trigger: "lock", changesContent: false, mutate: s => { const c = structuredClone(s); c.profile.sessionRevision += 1; return c; } },
  ];
}
