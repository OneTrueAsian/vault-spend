import type { AgeInput, ComparisonCardResult, MetricId, Money, PersonRef, Reference, Universe } from "./types";

const MINUS = "−";

/** Whole dollars ("$1,234", "-$1,234"): published figures are rounded, so cents would overstate them. */
export function formatWhole(amount: Money | number): string {
  const n = typeof amount === "number" ? amount : parseFloat(amount);
  const body = Math.abs(n).toLocaleString("en-US", { minimumFractionDigits: 0, maximumFractionDigits: 0 });
  return n < 0 && Math.round(Math.abs(n)) !== 0 ? `-$${body}` : `$${body}`;
}

/** "25–34", "75 and over", or a single age. */
export function ageGroupLabel(ageMin: number, ageMax: number | null): string {
  if (ageMax === null) return `${ageMin} and over`;
  return ageMin === ageMax ? String(ageMin) : `${ageMin}–${ageMax}`;
}

export function ageInputLabel(age: AgeInput): string {
  return age.kind === "exact" ? String(age.age) : ageGroupLabel(age.min, age.max);
}

export function cohortLabel(option: { ageMin: number; ageMax: number | null }): string {
  return `Ages ${ageGroupLabel(option.ageMin, option.ageMax)}`;
}

/** "+20%", "−12.5%" — null when the percent is undefined (a zero or negative reference). */
export function percentLabel(percent: string | null): string | null {
  if (percent === null) return null;
  const n = parseFloat(percent);
  if (n === 0) return "0%";
  const body = `${Math.abs(n)}%`;
  return n > 0 ? `+${body}` : `${MINUS}${body}`;
}

/** "$22 above · +20%". Display only; the numbers come from the backend. */
export function differenceText(dollars: Money, percent: string | null): string {
  const n = parseFloat(dollars);
  if (n === 0) return "Same as the peer figure";
  const amount = formatWhole(Math.abs(n));
  const direction = n > 0 ? "above" : "below";
  const pct = percentLabel(percent);
  return pct ? `${amount} ${direction} · ${pct}` : `${amount} ${direction}`;
}

/** Bar lengths as percentages of the longer one. Geometry only, never a financial total. */
export function barWidths(you: Money, peer: Money): { you: number; peer: number } {
  const a = Math.max(parseFloat(you), 0);
  const b = Math.max(parseFloat(peer), 0);
  const max = Math.max(a, b);
  if (max === 0) return { you: 0, peer: 0 };
  return { you: (a / max) * 100, peer: (b / max) * 100 };
}

const TITLES: Record<MetricId, string> = {
  spending: "Spending",
  investments: "Investments",
  income: "Income",
  savings: "Savings",
  debt: "Debt",
};

export const metricTitle = (metric: MetricId) => TITLES[metric];

export function unitSuffix(unit: Reference["unit"]): string {
  return unit === "usd_per_year" ? "per year" : unit === "usd_per_month" ? "per month" : "balance";
}

export function populationLabel(universe: Universe): string {
  return universe === "all" ? "All peers" : "Only people who hold this";
}

const MONTHS = ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"];

function monthYear(iso: string): string {
  const [y, m] = iso.split("-");
  return `${MONTHS[parseInt(m, 10) - 1]} ${y}`;
}

export function referencePeriodLabel(period: { kind: "flow" | "stock"; from: string; to: string }): string {
  if (period.kind === "stock") return monthYear(period.to);
  if (period.from.endsWith("-01-01") && period.to.endsWith("-12-31") && period.from.slice(0, 4) === period.to.slice(0, 4)) {
    return period.from.slice(0, 4);
  }
  return `${monthYear(period.from)} – ${monthYear(period.to)}`;
}

export interface CardNotice {
  title: string;
  body: string;
  tone: "info" | "warning";
}

/** What a card says when it is not a plain comparison. A missing benchmark is described as the
 * benchmark's limit; it is never worded as something the person got wrong. */
export function cardNotice(result: ComparisonCardResult): CardNotice | null {
  const has = (code: string) => result.reasons.some((r) => r.code === code);
  switch (result.status) {
    case "comparable":
      return null;
    case "approximate":
      return {
        title: "Approximate",
        body: "No published age group matches exactly, so the nearest published group is shown. Treat the difference as a rough guide.",
        tone: "warning",
      };
    case "cohort_choice_required":
      return {
        title: "Choose the age group to compare with",
        body: "The age range you entered spans more than one published group. Pick the one to use for this comparison.",
        tone: "info",
      };
    case "incomplete":
      return {
        title: "Confirm your figures",
        body: "Some of what makes up your figure is unassigned or not yet confirmed, so there is no peer comparison yet. Review it under Your details below.",
        tone: "info",
      };
    case "not_comparable":
      return {
        title: "Not comparable / outside benchmark population",
        body: "The published figure only describes people who hold this, and your figure is zero, so the two are not comparable.",
        tone: "info",
      };
    case "unreliable":
      return {
        title: "Reference too uncertain",
        body: "The survey's own margin of error for this age group is too large to use as a comparison.",
        tone: "info",
      };
    case "unavailable":
      if (has("benchmark_removed")) {
        return {
          title: "Benchmark no longer available in the current reference package",
          body: "The public source that supported this comparison is not in the current reference data.",
          tone: "info",
        };
      }
      if (has("no_matching_age_benchmark")) {
        return { title: "No matching age benchmark", body: "No published figure covers your age group.", tone: "info" };
      }
      if (has("unit_mismatch")) {
        return { title: "Different kinds of figure", body: "Your figure and the published one are not measured the same way.", tone: "info" };
      }
      if (has("cpi_unavailable")) {
        return { title: "Cannot adjust for inflation", body: "The price data needed to bring the published figure up to date is missing.", tone: "info" };
      }
      return {
        title: "No matching benchmark",
        body: "Public sources do not publish a comparable figure for this, so nothing is substituted.",
        tone: "info",
      };
    case "missing_input":
      return null;
  }
}

const SOURCE_LABELS: Record<string, string> = {
  cps_pinc01_2026: "U.S. Census Bureau, CPS ASEC 2026",
  cps_hinc02_2026: "U.S. Census Bureau, CPS ASEC 2026",
  sipp_wealth_2024: "U.S. Census Bureau, SIPP 2025",
  sipp_debt_2024: "U.S. Census Bureau, SIPP 2025",
};

/** A readable source name; an id the app does not know is shown as is. */
export const sourceLabel = (sourceId: string): string => SOURCE_LABELS[sourceId] ?? sourceId.replace(/_/g, " ");

/** "Me" for the profile owner, otherwise the family member's name (or a placeholder if deleted). */
export function personLabel(person: PersonRef, members: { id: number; name: string }[]): string {
  if (person.kind === "owner") return "Me";
  return members.find((m) => m.id === person.id)?.name ?? "Someone who was removed";
}
