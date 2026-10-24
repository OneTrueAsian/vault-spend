/** Synthetic, hand-calculated contract fixtures. No production calculator/formatter is implemented here. */
import type { Projection } from "../accumulation";
import type { ConfirmedRetirementScenario, RetirementCalculation, RetirementEstimate, RetirementIllustration, RetirementLiveContext } from "./retirementScenarioContract";

export type RetirementContractExample = {
  id: string;
  input: ConfirmedRetirementScenario;
  live: RetirementLiveContext;
  extraDeposits: string;
  expected: RetirementCalculation;
};
const price = (roundedDollars: number, roundingStepDollars: 10 | 100 | 1000): RetirementEstimate => ({ roundedDollars, roundingStepDollars, sign: roundedDollars > 0 ? "positive" : roundedDollars < 0 ? "negative" : "zero", lessThanTen: false });
const projection = (points: Projection["points"], balanceAtWithdraw: number, contributions: number, growth: number): Projection => ({ points, balanceAtWithdraw, contributions, growth, withdrawals: [] });

/** Fresh copies prevent one test/worker mutating another example's terms. */
export function retirementContractExamples(): RetirementContractExample[] {
  const source = { generation: 1, sessionRevision: 2, revision: { local: 3, external: 4 }, settingsRevision: 5, asOf: "2026-10-17" };
  const live: RetirementLiveContext = { today: source.asOf, investmentAccounts: [{ id: 7, name: "Fictional IRA" }], source };
  const input: ConfirmedRetirementScenario = { intent: { version: 1, accountId: 7, extra: { kind: "monthly", amount: "50" }, startDate: source.asOf, retirementMonth: "2026-11" },
    context: { version: 1, account: { id: 7, name: "Fictional IRA", type: "investment" }, source, currentValue: "1000", contribution: { kind: "saved", monthlyAmount: "100" }, returnAssumption: { kind: "stored-plan", annualPct: "12" }, retirementMonth: "2026-11" },
    assumptions: { view: "balances", monthlyContribution: { basis: "context", amount: "100" }, returns: { kind: "confirmed-return", annualPct: "12", basis: "stored-plan", sensitivity: null }, purchasingPower: { kind: "nominal" } }, confirmed: true };
  const noGrowth: RetirementIllustration = { annualReturnPct: "0", baseline: projection([{ month: 0, balance: 1000 }, { month: 1, balance: 1100 }], 1100, 100, 0),
    scenario: projection([{ month: 0, balance: 1000 }, { month: 1, balance: 1150 }], 1150, 150, 0), display: { baseline: price(1100, 100), scenario: price(1200, 100), difference: price(50, 10) } };
  const growth: RetirementIllustration = { annualReturnPct: "12", baseline: projection([{ month: 0, balance: 1000 }, { month: 1, balance: 1110 }], 1110, 100, 10),
    scenario: projection([{ month: 0, balance: 1000 }, { month: 1, balance: 1160 }], 1160, 150, 10), display: { baseline: price(1100, 100), scenario: price(1200, 100), difference: price(50, 10) } };
  const monthly: RetirementContractExample = { id: "one-month-monthly", input, live, extraDeposits: "50.00", expected: { kind: "preview", scenario: input, months: 1, extraDeposits: "50.00", seriesUnit: "nominal-dollars", displayUnit: "nominal-dollars", noGrowth, confirmedReturn: growth, sensitivity: [] } };
  const once = structuredClone(monthly); once.id = "one-month-once"; once.input.intent.extra.kind = "once";
  if (once.expected.kind !== "preview") throw Error("Fixture error"); once.expected.scenario = once.input;
  once.expected.noGrowth.scenario = projection([{ month: 0, balance: 1050 }, { month: 1, balance: 1150 }], 1150, 100, 0);
  once.expected.confirmedReturn!.scenario = projection([{ month: 0, balance: 1050 }, { month: 1, balance: 1160.5 }], 1160.5, 100, 10.5);
  const zero = structuredClone(once); zero.id = "zero-month-once"; zero.input.intent.retirementMonth = "2026-10";
  if (zero.expected.kind !== "preview") throw Error("Fixture error"); zero.expected.scenario = zero.input; zero.expected.months = 0;
  for (const illustration of [zero.expected.noGrowth, zero.expected.confirmedReturn!]) {
    illustration.baseline = projection([{ month: 0, balance: 1000 }], 1000, 0, 0); illustration.scenario = projection([{ month: 0, balance: 1050 }], 1050, 0, 0);
    illustration.display = { baseline: price(1000, 100), scenario: price(1100, 100), difference: price(50, 10) };
  }
  const deposit = structuredClone(monthly); deposit.id = "1200-month-deposits-only"; deposit.extraDeposits = "12.00";
  deposit.live.today = "2000-02-29"; deposit.live.source.asOf = deposit.live.today;
  deposit.input.context.source.asOf = deposit.live.today; deposit.input.context.currentValue = null; deposit.input.context.contribution = { kind: "missing" }; deposit.input.context.returnAssumption = { kind: "application-default", annualPct: "7" };
  deposit.input.intent.startDate = deposit.live.today; deposit.input.intent.retirementMonth = "2100-02"; deposit.input.intent.extra.amount = "0.01";
  deposit.input.assumptions = { view: "extra-deposits-only", monthlyContribution: null, returns: { kind: "no-growth" }, purchasingPower: { kind: "nominal" } };
  deposit.expected = { kind: "extra-deposits-only", scenario: deposit.input, months: 1200, extraDeposits: "12.00", unit: "nominal-dollars", growthForecastMade: false };
  return [monthly, once, zero, deposit];
}
