import { describe, expect, it } from "vitest";
import {
  sourceLabel,
  ageGroupLabel,
  ageInputLabel,
  barWidths,
  cardNotice,
  cohortLabel,
  differenceText,
  formatWhole,
  metricTitle,
  percentLabel,
  populationLabel,
  referencePeriodLabel,
  unitSuffix,
} from "./format";
import type { CardStatus, ComparisonCardResult, Reason } from "./types";

function result(status: CardStatus, reasons: Reason[] = []): ComparisonCardResult {
  return { metric: "income", status, localValue: null, reference: null, dollarDifference: null, percentDifference: null, reasons, completeness: "unknown" };
}

describe("age groups", () => {
  it("labels closed and open cohorts the way the sources publish them", () => {
    expect(ageGroupLabel(25, 34)).toBe("25–34");
    expect(ageGroupLabel(75, null)).toBe("75 and over");
    expect(ageGroupLabel(18, 18)).toBe("18");
  });

  it("describes what the person entered", () => {
    expect(ageInputLabel({ kind: "exact", age: 42 })).toBe("42");
    expect(ageInputLabel({ kind: "band", min: 25, max: 34 })).toBe("25–34");
    expect(ageInputLabel({ kind: "band", min: 65, max: null })).toBe("65 and over");
  });

  it("labels a cohort option for a picker", () => {
    expect(cohortLabel({ ageMin: 30, ageMax: 34 })).toBe("Ages 30–34");
  });
});

describe("whole dollars", () => {
  it("rounds and groups without cents", () => {
    expect(formatWhole("110")).toBe("$110");
    expect(formatWhole("1234567.5")).toBe("$1,234,568");
    expect(formatWhole("-4200.2")).toBe("-$4,200");
    expect(formatWhole("-0.2")).toBe("$0");
  });
});

describe("differences", () => {
  it("signs the percent and uses a true minus", () => {
    expect(percentLabel("20")).toBe("+20%");
    expect(percentLabel("-12.5")).toBe("−12.5%");
    expect(percentLabel("0")).toBe("0%");
    expect(percentLabel(null)).toBeNull();
  });

  it("words the dollar difference as above or below the peer figure", () => {
    expect(differenceText("22", "20")).toBe("$22 above · +20%");
    expect(differenceText("-100", "-100")).toBe("$100 below · −100%");
    expect(differenceText("0", "0")).toBe("Same as the peer figure");
  });

  it("still words a dollar difference when the percent is undefined", () => {
    expect(differenceText("60", null)).toBe("$60 above");
  });
});

describe("bars", () => {
  it("scales both bars against the larger value", () => {
    expect(barWidths("50", "100")).toEqual({ you: 50, peer: 100 });
    expect(barWidths("200", "100")).toEqual({ you: 100, peer: 50 });
  });

  it("clamps negatives and handles two zeros", () => {
    expect(barWidths("-5", "100")).toEqual({ you: 0, peer: 100 });
    expect(barWidths("0", "0")).toEqual({ you: 0, peer: 0 });
  });
});

describe("labels", () => {
  it("names the metrics and their units", () => {
    expect(metricTitle("investments")).toBe("Investments");
    expect(unitSuffix("usd_per_year")).toBe("per year");
    expect(unitSuffix("usd_balance")).toBe("balance");
  });

  it("names the reference population honestly", () => {
    expect(populationLabel("all")).toBe("All peers");
    expect(populationLabel("holders")).toBe("Only people who hold this");
  });

  it("shows a flow's year and a stock's date", () => {
    expect(referencePeriodLabel({ kind: "flow", from: "2025-01-01", to: "2025-12-31" })).toBe("2025");
    expect(referencePeriodLabel({ kind: "stock", from: "2024-12-31", to: "2024-12-31" })).toBe("Dec 2024");
    expect(referencePeriodLabel({ kind: "flow", from: "2025-07-01", to: "2026-06-30" })).toBe("Jul 2025 – Jun 2026");
  });
});

describe("card notices", () => {
  it("says a gap is what the reference data lacks, never that no source publishes it", () => {
    const body = cardNotice(result("unavailable", [{ code: "no_benchmark" }]))?.body ?? "";
    expect(body).toBe("No published figure for this is included in the reference data, so nothing is substituted.");
    expect(body).not.toMatch(/do not publish/);
  });

  it("names the Consumer Expenditure source", () => {
    expect(sourceLabel("bls_ce_2024")).toBe("U.S. Bureau of Labor Statistics, Consumer Expenditure Surveys 2024");
  });

  it("explains a source gap as the benchmark's limit, not the person's mistake", () => {
    expect(cardNotice(result("unavailable", [{ code: "no_benchmark" }]))?.title).toBe("No matching benchmark");
    expect(cardNotice(result("unavailable", [{ code: "benchmark_removed" }]))?.title).toBe(
      "Benchmark no longer available in the current reference package",
    );
    expect(cardNotice(result("unavailable", [{ code: "no_matching_age_benchmark" }]))?.title).toBe("No matching age benchmark");
    expect(cardNotice(result("unreliable", [{ code: "reference_too_uncertain" }]))?.title).toBe("Reference too uncertain");
  });

  it("asks the person to finish confirming rather than showing a half comparison", () => {
    expect(cardNotice(result("incomplete"))?.title).toBe("Confirm your figures");
    expect(cardNotice(result("cohort_choice_required"))?.title).toBe("Choose the age group to compare with");
  });

  it("explains a zero against a holders-only benchmark", () => {
    expect(cardNotice(result("not_comparable", [{ code: "holders_only_zero_local" }]))?.title).toBe("Not comparable / outside benchmark population");
  });

  it("covers a figure below zero too, in plain words, when it is not comparable", () => {
    const body = cardNotice(result("not_comparable", [{ code: "holders_only_zero_local" }]))?.body ?? "";
    expect(body).toBe("This figure only describes people who have some, and yours is zero or less, so the two can't be compared.");
  });

  it("says what the Income card is waiting for when only each person's income can be compared", () => {
    const n = cardNotice({ ...result("missing_input"), metric: "income" });
    expect(n?.title).toBe("Add the household's age to compare this");
    expect(n?.body).toBe("Each person's own income is already compared under Explore.");
    expect(cardNotice({ ...result("missing_input"), metric: "savings" })).toBeNull();
  });

  it("warns on approximate cards and names the substituted cohort", () => {
    const n = cardNotice(result("approximate", [{ code: "nearest_cohort_used", cohort: "x:30-34" }]));
    expect(n?.title).toBe("Approximate");
    expect(n?.tone).toBe("warning");
  });

  it("has nothing to say about a plain comparison", () => {
    expect(cardNotice(result("comparable"))).toBeNull();
  });
});
