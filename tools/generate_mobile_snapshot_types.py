"""Generate Rust/TypeScript wire types and JSON Schema together. No third-party packages.
Run from the repo root; --check detects drift without changing files.
Money retains Decimal precision; display rounding belongs to adapters, not this wire format.
"""
import argparse
import json
import subprocess
from pathlib import Path

ROOT = Path(__file__).resolve().parents[1]
def ref(name): return {"$ref": "#/$defs/" + name}
def nullable(value): return {"anyOf": [value, {"type": "null"}]}
def arr(value): return {"type": "array", "items": value}
def enum(*values): return {"type": "string", "enum": list(values)}
def integer(minimum=0, maximum=2147483647): return {"type": "integer", "minimum": minimum, "maximum": maximum}
def obj(**fields): return {"type": "object", "additionalProperties": False, "required": list(fields), "properties": fields}
S = ref("Label")
D = ref("Decimal")
N = nullable(D)
DATE = ref("Date")
MONTH = ref("Month")
ID = ref("OpaqueId")
B = {"type": "boolean"}
DEFS = {
    "Label": {"type": "string", "maxLength": 2048},
    "OpaqueId": {"type": "string", "minLength": 1, "maxLength": 128, "format": "opaque-id"},
    "Decimal": {"type": "string", "format": "exact-decimal", "maxLength": 29},
    "Sequence": {"type": "string", "format": "sequence", "maxLength": 20},
    "Date": {"type": "string", "format": "date"},
    "Month": {"type": "string", "format": "month"},
    "UtcTimestamp": {"type": "string", "format": "utc-timestamp"},
    "Availability": obj(state=enum("available", "partial", "unavailable"), reason=nullable(S)),
    "Sections": obj(**{s: ref("Availability") for s in ["overview", "accounts", "investments", "budgets", "reports", "comparisons", "calculators"]}),
    "Profile": obj(id=ID, name=S, icon=nullable(S)),
    "Overview": obj(netWorth=D, cash=D, debtContribution=D, investments=D, otherAccounts=D, propertyValue=D, propertyValuedFrom=nullable(DATE), propertyValuedThrough=nullable(DATE), averageMonthlySpend=N, runwayMonths=N),
    "Account": obj(id=ID, name=S, accountType=enum("checking", "savings", "credit", "loan", "investment", "other"), balance=D, startingBalance=D, netWorthContribution=D, owed=N, balanceBasis=enum("ledger", "holdings"), checkpointDate=nullable(DATE), memberId=nullable(ID), icon=nullable(S)),
    "Member": obj(id=ID, name=S),
    "QuoteCoverage": obj(state=enum("complete", "partial", "unavailable"), valuedPositions=integer(), totalPositions=integer(), quoteTimestamp=nullable(ref("UtcTimestamp")), previousCloseDate=nullable(DATE)),
    "InvestmentSummary": obj(accountId=ID, value=D, costBasis=N, unrealizedGain=N, dayChange=N, coverage=ref("QuoteCoverage")),
    "Investments": obj(value=D, costBasis=N, unrealizedGain=N, dayChange=N, coverage=ref("QuoteCoverage"), accounts=arr(ref("InvestmentSummary"))),
    "BudgetLine": obj(category=S, group=enum("income", "fixed", "flexible", "nonmonthly"), order=integer(), planned=D, actual=D, rollover=D, effectiveBudget=D, remaining=D, capEnabled=B, rolloverEnabled=B, alert=enum("none", "warning", "over")),
    "BudgetMonth": obj(month=MONTH, actualThrough=nullable(DATE), sourceMonth=nullable(MONTH), capFeatureEnabled=B, rolloverFeatureEnabled=B, lines=arr(ref("BudgetLine")), unbudgetedSpending=D, actualIncome=D, actualSpending=D),
    "MonthTotals": obj(month=MONTH, income=D, spending=D, savingsRatePct=N),
    "CategoryMonth": obj(month=MONTH, category=S, group=nullable(enum("income", "fixed", "flexible", "nonmonthly")), spending=D),
    "BudgetCategoryMonth": obj(month=MONTH, category=S, signedAmount=D),
    "DailySpend": obj(date=DATE, spending=D),
    "MonthBreakdown": obj(month=MONTH, id=nullable(ID), label=S, income=D, spending=D),
    "NetWorthPoint": obj(date=DATE, netWorth=D, cash=D, debtContribution=D, investments=D, propertyValue=D, valuationBasis=enum("current_saved_values", "recorded")),
    "ValuePoint": obj(date=DATE, value=D),
    "MemberWorth": obj(memberId=nullable(ID), label=S, value=D),
    "History": obj(fromMonth=nullable(MONTH), throughMonth=nullable(MONTH), actualThrough=DATE, months=arr(ref("MonthTotals")), categories=arr(ref("CategoryMonth")), budgetCategoryNet=arr(ref("BudgetCategoryMonth")), daily=arr(ref("DailySpend")), accounts=arr(ref("MonthBreakdown")), members=arr(ref("MonthBreakdown")), tags=arr(ref("MonthBreakdown")), merchants=arr(ref("MonthBreakdown")), netWorth=arr(ref("NetWorthPoint")), portfolio=arr(ref("ValuePoint")), memberNetWorth=arr(ref("MemberWorth"))),
    "DollarBasis": obj(kind=enum("month", "annual_average"), period=S),
    "ComparisonReference": obj(id=S, mode=enum("household", "individual"), definitionId=S, value=D, adjustedValue=D, uncertainty=N, uncertaintyKind=nullable(enum("moe90", "se")), unit=enum("usd_per_year", "usd_per_month", "usd_balance"), statistic=enum("mean", "median"), population=S, universe=enum("all", "holders"), geography=S, ageMin=integer(), ageMax=nullable(integer()), periodKind=enum("flow", "stock"), periodFrom=DATE, periodTo=DATE, dollarBasis=ref("DollarBasis"), adjustedBasisMonth=MONTH, cpiFactor=D, sourceId=S, sourceUrl=S, sourceLocator=S, annotation=nullable(S), reliability=enum("ok", "unreliable")),
    "ComparisonReason": obj(code=S, detail=nullable(S), options=arr(S)),
    "ComparisonResult": obj(metric=enum("spending", "investments", "income", "savings", "debt"), status=enum("comparable", "approximate", "missing_input", "incomplete", "unavailable", "unreliable", "cohort_choice_required", "not_comparable"), localValue=N, reference=nullable(ref("ComparisonReference")), dollarDifference=N, percentDifference=N, completeness=enum("confirmed", "partial", "unknown"), reasons=arr(ref("ComparisonReason"))),
    "ComparisonContributor": obj(label=S, gross=D, shareBasisPoints=integer(0, 10000), counted=D),
    "ComparisonClass": obj(label=S, value=D),
    "ComparisonSecondary": obj(label=S, result=ref("ComparisonResult")),
    "ComparisonCard": obj(result=ref("ComparisonResult"), visible=B, definitionId=nullable(S), stale=B, personalIncomeHint=B, metricUnit=enum("usd_per_year", "usd_per_month", "usd_balance"), periodKind=nullable(enum("flow", "stock")), periodFrom=nullable(DATE), periodTo=nullable(DATE), origin=enum("derived", "entered"), measuredOn=nullable(DATE), explanation=nullable(S), unallocated=D, trackedValue=N, contributors=arr(ref("ComparisonContributor")), excluded=arr(ref("ComparisonReason")), classTotals=arr(ref("ComparisonClass")), notes=arr(ref("ComparisonReason")), secondary=arr(ref("ComparisonSecondary"))),
    "Comparisons": obj(configured=B, packageVersion=nullable(S), setupRevision=ref("Sequence"), problem=nullable(S), cards=arr(ref("ComparisonCard"))),
    "ContributionMonth": obj(month=MONTH, moneyIn=D, moneyOut=D),
    "AccumulationPlan": obj(monthlyContribution=N, annualReturnPct=D, withdrawMonth=nullable(MONTH), withdrawYears=nullable(integer(1, 100))),
    "Accumulation": obj(accountId=ID, months=arr(ref("ContributionMonth")), totalIn=D, totalOut=D, net=D, firstDeposit=nullable(DATE), depositCount=integer(), plan=ref("AccumulationPlan"), valueHistory=arr(ref("ValuePoint"))),
    "DebtInput": obj(accountId=ID, owed=D, annualRatePct=N, excluded=B),
    "ScheduledFlow": obj(date=DATE, moneyIn=D, moneyOut=D),
    "Forecast": obj(throughDate=DATE, startBalance=D, trendDailyNet=D, everydayDailyNet=D, usesRecurring=B, schedule=arr(ref("ScheduledFlow"))),
    "GoalSummary": obj(id=ID, name=S, target=N, saved=D, targetDate=nullable(DATE), monthlyContribution=N, monthlyPace=D, tracksAccount=B, linkedAccountId=nullable(ID), memberId=nullable(ID)),
    "RecurringSummary": obj(monthlyIncome=D, monthlyExpense=D, annualIncome=D, annualExpense=D),
    "Calculators": obj(inflationPct=D, accumulation=arr(ref("Accumulation")), debts=arr(ref("DebtInput")), forecast=ref("Forecast"), goals=arr(ref("GoalSummary")), recurring=ref("RecurringSummary")),
    "MobileSnapshotV1": obj(schemaVersion={"type": "integer", "const": 1}, minimumViewerVersion={"type": "integer", "const": 1}, installationId=ID, profile=ref("Profile"), epoch=ID, sequence=ref("Sequence"), generatedAt=ref("UtcTimestamp"), asOfDate=DATE, currency={"type": "string", "const": "USD"}, sections=ref("Sections"), members=arr(ref("Member")), overview=ref("Overview"), accounts=arr(ref("Account")), investments=ref("Investments"), budgets=arr(ref("BudgetMonth")), history=ref("History"), comparisons=ref("Comparisons"), calculators=ref("Calculators")),
}

def ts_type(s):
    if "$ref" in s: return s["$ref"].split("/")[-1]
    if "anyOf" in s: return " | ".join(ts_type(v) for v in s["anyOf"])
    if "const" in s: return json.dumps(s["const"])
    if "enum" in s: return " | ".join(json.dumps(v) for v in s["enum"])
    if s["type"] == "array": return "(" + ts_type(s["items"]) + ")[]"
    return {"string": "string", "integer": "number", "boolean": "boolean", "null": "null"}[s["type"]]

def snake(value):
    return "".join("_" + c.lower() if c.isupper() else c for c in value)

def rust_type(s):
    if "$ref" in s: return s["$ref"].split("/")[-1]
    if "anyOf" in s: return "Option<" + rust_type(s["anyOf"][0]) + ">"
    if s["type"] == "array": return "Vec<" + rust_type(s["items"]) + ">"
    return {"string": "String", "integer": "u32", "boolean": "bool"}[s["type"]]

def outputs():
    schema = {"$schema": "https://json-schema.org/draft/2020-12/schema", "$ref": "#/$defs/MobileSnapshotV1", "$defs": DEFS}
    ts = ["// Generated by tools/generate_mobile_snapshot_types.py; do not edit.\n"]
    rust = ["// Generated by tools/generate_mobile_snapshot_types.py; do not edit.", "use serde::{Deserialize, Serialize};", ""]
    for name, s in DEFS.items():
        if s["type"] != "object":
            ts.append(f"export type {name} = {ts_type(s)};")
            rust.append(f"pub type {name} = {rust_type(s)};")
        else:
            ts.append("export interface " + name + " {")
            rust.extend(["#[derive(Debug, Clone, PartialEq, Serialize, Deserialize)]", '#[serde(rename_all = "camelCase", deny_unknown_fields)]', "pub struct " + name + " {"])
            for key, field in s["properties"].items():
                ts.append(f"  {key}: {ts_type(field)};")
                rust.append(f"    pub {snake(key)}: {rust_type(field)},")
            ts.append("}")
            rust.append("}")
    return {
        ROOT / "core/src/mobile_snapshot_v1.schema.json": json.dumps(schema, indent=2) + "\n",
        ROOT / "core/src/mobile_snapshot_types.rs": subprocess.run(["rustfmt", "--edition", "2024", "--config-path", str(ROOT / "rustfmt.toml"), "--emit", "stdout"], input="\n".join(rust) + "\n", text=True, capture_output=True, check=True).stdout,
        ROOT / "src/mobileSnapshotTypes.ts": "\n".join(ts) + "\n",
    }

if __name__ == "__main__":
    parser = argparse.ArgumentParser()
    parser.add_argument("--check", action="store_true")
    args = parser.parse_args()
    for path, text in outputs().items():
        if args.check:
            if path.read_text(encoding="utf-8") != text:
                raise SystemExit(f"Generated file differs: {path}")
        else:
            path.write_text(text, encoding="utf-8")
