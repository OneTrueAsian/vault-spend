"""Validate a benchmark package (manifest.json, records.json, cpi.json).

check() works on parsed data and returns a list of human-readable problems;
an empty list means the package may ship. No network access.

    python tools/benchmarks/validate.py core/data/benchmarks
"""
import hashlib
import json
import os
import re
import sys

FORMAT_VERSION = 1
METRICS = {"spending", "investments", "income", "savings", "debt"}
MODES = {"household", "individual"}
STATISTICS = {"mean", "median"}
UNITS = {"usd_per_year", "usd_per_month", "usd_balance"}
UNIVERSES = {"all", "holders"}
RELIABILITY = {"ok", "unreliable"}
DECIMAL = re.compile(r"^-?\d+(\.\d+)?$")
MONTH = re.compile(r"^\d{4}-(0[1-9]|1[0-2])$")
DATE = re.compile(r"^\d{4}-\d{2}-\d{2}$")
REQUIRED = (
    "id", "metric", "mode", "definitionId", "population", "universe", "geography",
    "ageMin", "ageMax", "statistic", "value", "unit", "period", "dollarBasis",
    "sourceId", "sourceUrl", "sourceLocator", "uncertainty", "annotation", "reliability",
)


def _overlap(a, b):
    a_hi = float("inf") if a[1] is None else a[1]
    b_hi = float("inf") if b[1] is None else b[1]
    return a[0] <= b_hi and b[0] <= a_hi


def check(manifest, records, cpi):
    errs = []
    if manifest.get("formatVersion") != FORMAT_VERSION:
        errs.append(f"formatVersion {manifest.get('formatVersion')!r} is not supported (expected {FORMAT_VERSION})")
    if manifest.get("synthetic"):
        errs.append("package is tagged synthetic; synthetic fixtures must never ship")

    source_ids = {s.get("id") for s in manifest.get("sources", [])}
    months = cpi.get("months", {})
    for m, v in months.items():
        if not MONTH.match(m) or not DECIMAL.match(str(v)):
            errs.append(f"cpi month {m!r}={v!r} is malformed")
    latest = manifest.get("cpi", {}).get("latestMonth")
    if latest not in months:
        errs.append(f"cpi latestMonth {latest!r} is not in the bundled series")

    seen_ids = set()
    groups = {}
    for rec in records:
        rid = rec.get("id", "<no id>")
        for field in REQUIRED:
            if field not in rec:
                errs.append(f"{rid}: missing field {field}")
        if rid in seen_ids:
            errs.append(f"duplicate record id {rid}")
        seen_ids.add(rid)
        if rec.get("metric") not in METRICS:
            errs.append(f"{rid}: unknown metric {rec.get('metric')!r}")
        if rec.get("mode") not in MODES:
            errs.append(f"{rid}: unknown mode {rec.get('mode')!r}")
        if rec.get("statistic") not in STATISTICS:
            errs.append(f"{rid}: unknown statistic {rec.get('statistic')!r}")
        if rec.get("unit") not in UNITS:
            errs.append(f"{rid}: unknown unit {rec.get('unit')!r}")
        if rec.get("universe") not in UNIVERSES:
            errs.append(f"{rid}: unknown universe {rec.get('universe')!r}")
        if rec.get("reliability") not in RELIABILITY:
            errs.append(f"{rid}: unknown reliability {rec.get('reliability')!r}")
        value = rec.get("value")
        if not isinstance(value, str) or not DECIMAL.match(value):
            errs.append(f"{rid}: value must be a decimal string, got {value!r}")
        unc = rec.get("uncertainty")
        if unc is not None and (unc.get("kind") not in ("moe90", "se") or not DECIMAL.match(str(unc.get("value", "")))):
            errs.append(f"{rid}: malformed uncertainty {unc!r}")
        if rec.get("sourceId") not in source_ids:
            errs.append(f"{rid}: unknown source {rec.get('sourceId')!r}")
        lo, hi = rec.get("ageMin"), rec.get("ageMax")
        if not isinstance(lo, int) or (hi is not None and (not isinstance(hi, int) or hi < lo)):
            errs.append(f"{rid}: bad age bounds {lo!r}..{hi!r}")
        period = rec.get("period") or {}
        if period.get("kind") not in ("flow", "stock") or not DATE.match(str(period.get("from"))) \
                or not DATE.match(str(period.get("to"))):
            errs.append(f"{rid}: malformed period {period!r}")
        basis = rec.get("dollarBasis") or {}
        if basis.get("kind") == "month":
            if basis.get("period") not in months:
                errs.append(f"{rid}: dollar basis month {basis.get('period')!r} is not in the cpi series")
        elif basis.get("kind") == "annual_average":
            y = str(basis.get("period"))
            if not all(f"{y}-{m:02d}" in months for m in range(1, 13)):
                errs.append(f"{rid}: annual-average cpi basis {y} needs all 12 published months")
        else:
            errs.append(f"{rid}: unknown dollar basis {basis!r}")
        if isinstance(lo, int):
            key = (rec.get("metric"), rec.get("mode"), rec.get("definitionId"), rec.get("population"),
                   rec.get("universe"), rec.get("geography"), rec.get("statistic"))
            groups.setdefault(key, []).append((lo, hi, rid))

    for key, items in groups.items():
        items.sort(key=lambda t: t[0])
        for i, a in enumerate(items):
            for b in items[i + 1:]:
                if _overlap(a, b):
                    errs.append(f"overlap in {key[2]}: {a[2]} ({a[0]}-{a[1]}) and {b[2]} ({b[0]}-{b[1]})")
    return errs


def _load(directory, name):
    with open(os.path.join(directory, name), "rb") as f:
        raw = f.read()
    return raw, json.loads(raw.decode("utf-8"))


def check_dir(directory):
    try:
        records_raw, records = _load(directory, "records.json")
        _, manifest = _load(directory, "manifest.json")
        _, cpi = _load(directory, "cpi.json")
    except (OSError, ValueError) as exc:
        return [f"cannot read package: {exc}"]
    errs = check(manifest, records, cpi)
    if manifest.get("recordsSha256") != hashlib.sha256(records_raw).hexdigest():
        errs.append("manifest recordsSha256 does not match records.json")
    return errs


def main(argv):
    if len(argv) != 2:
        print(__doc__)
        return 2
    errs = check_dir(argv[1])
    for e in errs:
        print("INVALID:", e)
    if not errs:
        print("package valid")
    return 1 if errs else 0


if __name__ == "__main__":
    sys.exit(main(sys.argv))
