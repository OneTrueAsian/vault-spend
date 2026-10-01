"""Build the bundled public benchmark package from official source files.

    python tools/benchmarks/build.py --sources tools/benchmarks/sources.json \
        --output core/data/benchmarks [--offline] [--check]

--offline   use only files already in the ignored cache (tools/benchmarks/.cache);
            never touch the network. This is the mode tests and release
            validation use.
--check     build in memory and fail if the result differs from --output.

Every downloaded file is verified against the sha256 pinned in sources.json, so
a silently revised workbook fails the build and has to be reviewed before the
pin is updated. Nothing here needs, stores or prints a credential.
"""
import argparse
import csv
import hashlib
import json
import os
import re
import sys
import tempfile
import urllib.request
from decimal import Decimal, InvalidOperation

import openpyxl

sys.path.insert(0, os.path.dirname(__file__))
import validate  # noqa: E402

MISSING = object()
SENTINELS = {"(B)", "(D)", "(X)", "(S)", "(NA)", "(Z)", "-", "--", "N", "X"}
MAX_COEFFICIENT_OF_VARIATION = Decimal("0.30")
CPI_START_YEAR = 2020


class SourceLayoutError(Exception):
    """A source workbook no longer looks the way the parser was reviewed against."""


class PackageInvalid(Exception):
    """The assembled package failed validation; nothing was written."""


# --------------------------------------------------------------------- primitives

def parse_number(cell):
    """Decimal for a real number (including 0 and negatives); MISSING for blanks/sentinels."""
    if cell is None or isinstance(cell, bool):
        return MISSING
    if isinstance(cell, (int, float)):
        return Decimal(repr(cell))
    text = str(cell).strip()
    if not text or text.upper() in SENTINELS or (text.startswith("(") and text.endswith(")")):
        return MISSING
    try:
        return Decimal(text.replace(",", "").replace("$", ""))
    except InvalidOperation:
        return MISSING


def money(value):
    """Plain decimal text: no exponent, no float noise, no trailing zeros."""
    return format(Decimal(value).normalize(), "f")


def parse_age_label(label):
    if label is None:
        return None
    text = str(label).strip().lstrip(".").strip()
    if re.match(r"^less than 35 years$", text, re.I):
        return (15, 34)
    m = re.match(r"^(\d+) to (\d+) years?$", text)
    if m:
        return (int(m.group(1)), int(m.group(2)))
    m = re.match(r"^(\d+)(?: years?)? and over$", text)
    if m:
        return (int(m.group(1)), None)
    return None


def _contains(a, b):
    if a == b:
        return False
    if a[0] > b[0]:
        return False
    if a[1] is None:
        return True
    return b[1] is not None and b[1] <= a[1]


def finest_cohorts(items, bounds=lambda i: (i["ageMin"], i["ageMax"])):
    """Drop roll-up bands (25-34 over 25-29 and 30-34) so published cohorts never overlap."""
    spans = [bounds(i) for i in items]
    return [i for i, s in zip(items, spans) if not any(_contains(s, t) for t in spans)]


def reliability(value, se):
    if se is None or se is MISSING:
        return "ok"
    if value == 0:
        return "unreliable" if se != 0 else "ok"
    return "unreliable" if abs(se / value) > MAX_COEFFICIENT_OF_VARIATION else "ok"


def _label(ws, row):
    v = ws.cell(row, 1).value
    return None if v is None else str(v).strip()


# ------------------------------------------------------------------ income workbooks

def parse_pinc01(path):
    """CPS ASEC PINC-01, all people / both sexes / all races: median income by age."""
    ws = openpyxl.load_workbook(path, data_only=True).worksheets[0]
    head = {_label(ws, r) for r in range(1, 13)}
    for needed in ("Total Work Experience", "Both Sexes", "All Races"):
        if needed not in head:
            raise SourceLayoutError(f"PINC-01: first block is not '{needed}'")
    age_row = next((r for r in range(1, ws.max_row + 1) if _label(ws, r) == "Age"), None)
    if age_row is None:
        raise SourceLayoutError("PINC-01: no 'Age' section")
    header = next((r for r in range(age_row + 1, age_row + 4) if _label(ws, r) == "Characteristic"), None)
    if header is None:
        raise SourceLayoutError("PINC-01: no header row under 'Age'")
    col = next((c for c in range(2, ws.max_column + 1) if ws.cell(header, c).value == "Median income"), None)
    sub = header + 1
    if (col is None or "Value" not in str(ws.cell(sub, col).value)
            or "Standard error" not in str(ws.cell(sub, col + 1).value)):
        raise SourceLayoutError("PINC-01: 'Median income' value/standard-error columns not found")
    out = []
    for r in range(sub + 1, ws.max_row + 1):
        label = _label(ws, r)
        if label is None or label.startswith("Mean age"):
            break
        bounds = parse_age_label(label)
        if bounds is None:
            continue
        out.append({"ageMin": bounds[0], "ageMax": bounds[1], "label": label,
                    "median": parse_number(ws.cell(r, col).value),
                    "medianSe": parse_number(ws.cell(r, col + 1).value),
                    "row": r, "column": col})
    return finest_cohorts(out)


def parse_hinc02(path):
    """CPS ASEC HINC-02: median household income by age of householder."""
    ws = openpyxl.load_workbook(path, data_only=True).worksheets[0]
    if _label(ws, 9) != "Characteristic":
        raise SourceLayoutError("HINC-02: header row moved")
    columns = {}
    for c in range(2, ws.max_column + 1):
        sub, top = ws.cell(11, c).value, ws.cell(10, c).value
        label = sub if sub is not None else top
        bounds = parse_age_label(label)
        if bounds is not None and str(label).strip() != "Total":
            columns[c] = bounds
    med = next((r for r in range(12, ws.max_row + 1) if (_label(ws, r) or "").startswith("Median income")), None)
    if med is None or "Standard error" not in (_label(ws, med + 1) or ""):
        raise SourceLayoutError("HINC-02: median income rows not found")
    out = [{"ageMin": b[0], "ageMax": b[1], "label": str(ws.cell(11, c).value or ws.cell(10, c).value),
            "median": parse_number(ws.cell(med, c).value),
            "medianSe": parse_number(ws.cell(med + 1, c).value),
            "row": med, "column": c} for c, b in columns.items()]
    return finest_cohorts(out)


# -------------------------------------------------------------------- SIPP workbooks

def sipp_columns(ws):
    """Map 'Group|Sub' (or just 'Group') header keys to column numbers."""
    cols, group = {}, None
    for c in range(2, ws.max_column + 1):
        top, sub = ws.cell(3, c).value, ws.cell(4, c).value
        if top is not None:
            group = str(top).strip()
        if sub is not None:
            cols[f"{group}|{str(sub).strip()}"] = c
        elif top is not None:
            cols[group] = c
    return cols


def parse_sipp(path, sheet, se_sheet, keys):
    wb = openpyxl.load_workbook(path, data_only=True)
    ws, se_ws = wb[sheet], wb[se_sheet]
    cols = sipp_columns(ws)
    for key in keys:
        if key not in cols:
            raise SourceLayoutError(f"{sheet}: column {key!r} not found")
    start = next((r for r in range(1, ws.max_row + 1) if _label(ws, r) == "Age of Householder"), None)
    if start is None:
        raise SourceLayoutError(f"{sheet}: no 'Age of Householder' section")
    rows = []
    for r in range(start + 1, ws.max_row + 1):
        bounds = parse_age_label(_label(ws, r))
        if bounds is None:
            break
        if _label(se_ws, r) != _label(ws, r):
            raise SourceLayoutError(f"{se_sheet}: row {r} does not line up with {sheet}")
        rows.append((r, bounds))
    keep = {i["b"] for i in finest_cohorts([{"b": b} for _, b in rows], bounds=lambda i: i["b"])}
    out = []
    for key in keys:
        for r, b in rows:
            if b not in keep:
                continue
            c = cols[key]
            out.append({"key": key, "ageMin": b[0], "ageMax": b[1], "label": _label(ws, r),
                        "value": parse_number(ws.cell(r, c).value),
                        "se": parse_number(se_ws.cell(r, c).value), "row": r, "column": c})
    return out


# ----------------------------------------------------------------------- assembly

def col_letter(n):
    return openpyxl.utils.get_column_letter(n)


def _flow(year):
    return {"kind": "flow", "from": f"{year}-01-01", "to": f"{year}-12-31"}


def _record(src, metric, mode, definition, population, universe, stat, unit, period, basis, cell, annotation):
    value, se = cell["value"], cell["se"]
    se_dec = None if se is MISSING else se
    return {
        "id": f"{definition}:{cell['ageMin']}-{'' if cell['ageMax'] is None else cell['ageMax']}",
        "metric": metric, "mode": mode, "definitionId": definition, "population": population,
        "universe": universe, "geography": "US", "ageMin": cell["ageMin"], "ageMax": cell["ageMax"],
        "statistic": stat, "value": money(value), "unit": unit, "period": period, "dollarBasis": basis,
        "sourceId": src["id"], "sourceUrl": src["url"],
        "sourceLocator": f"{src['file']}!{cell.get('sheet', '')}{'!' if cell.get('sheet') else ''}"
                         f"{col_letter(cell['column'])}{cell['row']} ({cell['label']})",
        "uncertainty": None if se_dec is None else {"kind": "se", "value": money(se_dec)},
        "annotation": annotation, "reliability": reliability(value, se_dec),
    }


def read_cpi(path):
    months = {}
    with open(path, newline="", encoding="utf-8") as f:
        for row in csv.DictReader(f):
            date, value = row["observation_date"], (row.get("CPIAUCNS") or "").strip()
            if not value or value == "." or int(date[:4]) < CPI_START_YEAR:
                continue
            months[date[:7]] = money(Decimal(value))
    return months


def assemble(config, cache_dir):
    """Parse every cached source into (manifest, records, cpi, suppressed)."""
    by_id = {s["id"]: s for s in config["sources"]}
    path = lambda sid: os.path.join(cache_dir, by_id[sid]["file"])  # noqa: E731
    records, suppressed = [], []

    def add(src_id, metric, mode, definition, population, universe, stat, unit, period, basis, cells, note=None, sheet=""):
        for cell in cells:
            cell = dict(cell, sheet=sheet)
            if cell["value"] is MISSING:
                suppressed.append({"definitionId": definition, "ageMin": cell["ageMin"],
                                   "ageMax": cell["ageMax"], "reason": "suppressed or not published by the source"})
                continue
            records.append(_record(by_id[src_id], metric, mode, definition, population, universe, stat,
                                   unit, period, basis, cell, note))

    income_basis = {"kind": "month", "period": "2025-07"}
    income_note = ("Income year 2025 reported in 2025 dollars; priced at the July 2025 CPI because the "
                   "October 2025 CPI was never published, so no complete annual average exists.")

    def as_cells(rows):
        return [{"ageMin": r["ageMin"], "ageMax": r["ageMax"], "label": r["label"], "value": r["median"],
                 "se": r["medianSe"], "row": r["row"], "column": r["column"]} for r in rows]

    add("cps_pinc01_2026", "income", "individual", "cps_pinc01_money_income_median",
        "People 15 and over with money income, all work experience, both sexes, all races", "holders",
        "median", "usd_per_year", _flow(2025), income_basis, as_cells(parse_pinc01(path("cps_pinc01_2026"))),
        income_note)
    add("cps_hinc02_2026", "income", "household", "cps_hinc02_money_income_median",
        "Households by age of householder, total money income", "all",
        "median", "usd_per_year", _flow(2025), income_basis, as_cells(parse_hinc02(path("cps_hinc02_2026"))),
        income_note)

    stock = {"kind": "stock", "from": "2024-12-31", "to": "2024-12-31"}
    wealth_basis = {"kind": "month", "period": "2024-12"}
    wealth_note = "Median among households that own the asset; households without it are not in the base."
    debt_note = "Median among households that owe this debt type; households without it are not in the base."
    wealth = path("sipp_wealth_2024")
    for definition, metric, key, label in (
        ("sipp_financial_institution_assets_median", "savings", "Assets at Financial Institutions|Total",
         "Households holding assets at financial institutions (checking, savings, money market, CDs)"),
        ("sipp_retirement_accounts_median", "investments", "Retirement accounts|Total",
         "Households holding retirement accounts (IRA, Keogh, 401(k), TSP)"),
        ("sipp_stocks_mutual_funds_median", "investments", "Stocks and Mutual Fund Shares",
         "Households holding stocks or mutual fund shares"),
    ):
        add("sipp_wealth_2024", metric, "household", definition, label, "holders", "median", "usd_balance",
            stock, wealth_basis, parse_sipp(wealth, "Table 1", "Table 1A", [key]), wealth_note, "Table 1")
    debt = path("sipp_debt_2024")
    for definition, key, label in (
        ("sipp_total_debt_median", "Total Debt", "Households with any debt"),
        ("sipp_home_debt_median", "Secured Debt|Home Debt", "Households with home debt"),
        ("sipp_credit_card_debt_median", "Unsecured Debt|Credit Card Debt", "Households with credit card debt"),
        ("sipp_student_loan_median", "Unsecured Debt|Student Loans", "Households with student loans"),
    ):
        add("sipp_debt_2024", "debt", "household", definition, label, "holders", "median", "usd_balance",
            stock, wealth_basis, parse_sipp(debt, "Table 1", "Table 1A", [key]), debt_note, "Table 1")

    cpi_months = read_cpi(os.path.join(cache_dir, config["cpi"]["file"]))
    cpi = {"series": config["cpi"]["series"], "months": cpi_months}
    manifest = {
        "formatVersion": validate.FORMAT_VERSION,
        "packageVersion": config["packageVersion"],
        "transformationVersion": config["transformationVersion"],
        "synthetic": False,
        "sources": [{k: s[k] for k in ("id", "provider", "dataset", "url", "sha256", "released", "retrieved")}
                    for s in config["sources"]],
        "cpi": {"series": config["cpi"]["series"], "note": config["cpi"]["note"],
                "url": config["cpi"]["url"], "sha256": config["cpi"]["sha256"],
                "latestMonth": max(cpi_months)},
        "gaps": config["gaps"],
        "suppressed": sorted(suppressed, key=lambda s: (s["definitionId"], s["ageMin"])),
        "capabilities": sorted({(r["metric"], r["mode"], r["definitionId"], r["universe"]) for r in records}),
    }
    manifest["capabilities"] = [dict(zip(("metric", "mode", "definitionId", "universe"), c))
                                for c in manifest["capabilities"]]
    return manifest, records, cpi


# ------------------------------------------------------------------------- output

def _dump(obj):
    return (json.dumps(obj, sort_keys=True, indent=2, ensure_ascii=False) + "\n").encode("utf-8")


def package_bytes(manifest, records, cpi):
    records = sorted(records, key=lambda r: r["id"])
    records_raw = _dump(records)
    manifest = dict(manifest, recordsSha256=hashlib.sha256(records_raw).hexdigest())
    return {"records.json": records_raw, "manifest.json": _dump(manifest), "cpi.json": _dump(cpi)}, manifest, records


def write_package(directory, manifest, records, cpi):
    """Validate, then replace the package files atomically; on failure leave the old ones alone."""
    files, manifest, records = package_bytes(manifest, records, cpi)
    errs = validate.check(manifest, records, cpi)
    if errs:
        raise PackageInvalid("; ".join(errs))
    os.makedirs(directory, exist_ok=True)
    staged = {}
    try:
        for name, raw in files.items():
            fd, tmp = tempfile.mkstemp(dir=directory, prefix=name + ".", suffix=".tmp")
            with os.fdopen(fd, "wb") as f:
                f.write(raw)
            staged[name] = tmp
        for name, tmp in staged.items():
            os.replace(tmp, os.path.join(directory, name))
        staged.clear()
    finally:
        for tmp in staged.values():
            os.unlink(tmp)


# ---------------------------------------------------------------------------- CLI

def sha256_file(path):
    h = hashlib.sha256()
    with open(path, "rb") as f:
        for chunk in iter(lambda: f.read(1 << 16), b""):
            h.update(chunk)
    return h.hexdigest()


def ensure_cache(config, cache_dir, offline):
    os.makedirs(cache_dir, exist_ok=True)
    for src in list(config["sources"]) + [config["cpi"] | {"id": "cpi_u_all_items"}]:
        target = os.path.join(cache_dir, src["file"])
        if not os.path.exists(target):
            if offline:
                raise SystemExit(f"--offline: {src['file']} is not in {cache_dir}")
            req = urllib.request.Request(src["url"], headers={"User-Agent": "vault-spend-benchmark-build"})
            with urllib.request.urlopen(req, timeout=60) as resp, open(target, "wb") as out:
                out.write(resp.read())
        actual = sha256_file(target)
        if actual != src["sha256"]:
            raise SystemExit(f"{src['file']}: sha256 {actual} does not match the pinned {src['sha256']}. "
                             "The source changed; review it before updating sources.json.")


def main(argv=None):
    ap = argparse.ArgumentParser(description=__doc__, formatter_class=argparse.RawDescriptionHelpFormatter)
    ap.add_argument("--sources", required=True)
    ap.add_argument("--output", required=True)
    ap.add_argument("--cache", default=os.path.join(os.path.dirname(__file__), ".cache"))
    ap.add_argument("--offline", action="store_true")
    ap.add_argument("--check", action="store_true")
    args = ap.parse_args(argv)
    with open(args.sources, encoding="utf-8") as f:
        config = json.load(f)
    ensure_cache(config, args.cache, args.offline)
    manifest, records, cpi = assemble(config, args.cache)
    if args.check:
        files, manifest, records = package_bytes(manifest, records, cpi)
        errs = validate.check(manifest, records, cpi)
        stale = [n for n, raw in files.items()
                 if not os.path.exists(os.path.join(args.output, n)) or open(os.path.join(args.output, n), "rb").read() != raw]
        for e in errs:
            print("INVALID:", e)
        for n in stale:
            print("DIFFERS:", n)
        return 1 if errs or stale else 0
    write_package(args.output, manifest, records, cpi)
    print(f"wrote {len(records)} records to {args.output}")
    return 0


if __name__ == "__main__":
    sys.exit(main())
