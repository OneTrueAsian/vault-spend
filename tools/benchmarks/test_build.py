"""Offline tests for the benchmark ingestion tools.

Every number below is SYNTHETIC. The fixture workbooks mimic the layout of the
real Census releases but their values are invented, so nothing here can be
mistaken for (or promoted into) production output.
"""
import json
import os
import sys
import tempfile
import unittest
from decimal import Decimal

import openpyxl

sys.path.insert(0, os.path.dirname(__file__))
import build  # noqa: E402
import validate  # noqa: E402


def _read(path):
    with open(path, "rb") as f:
        return f.read()


def _pinc_fixture(path, median_cell=49870, se_cell=857):
    wb = openpyxl.Workbook()
    ws = wb.active
    ws.title = "pinc01"
    ws["A2"] = "PINC-01. SYNTHETIC"
    ws["A7"] = "Total Work Experience"
    ws["A8"] = "Both Sexes"
    ws["A9"] = "All Races"
    ws["A27"] = "Age"
    header = ["Characteristic", "Total", "Median income", None, "Mean income", None]
    for c, v in enumerate(header, 1):
        ws.cell(28, c, v)
    for c, v in enumerate(["", "", "Value   (Dol.)", "Standard error (Dol.)",
                           "Value   (Dol.)", "Standard error (Dol.)"], 1):
        ws.cell(29, c, v)
    rows = [
        ("....Total, 15 years and over", 100, 46960, 226, 70390, 424),
        ("..15 to 24 years", 10, 17420, 443, 25670, 579),
        ("..25 to 34 years", 20, 52130, 255, 66750, 759),
        ("....25 to 29 years", 10, median_cell, se_cell, 58060, 863),
        ("....30 to 34 years", 10, 56980, 559, 75520, 1164),
        ("65 years and over", 10, 34610, 328, 57870, 598),
        ("..75 years and over", 5, 31640, 378, 51770, 801),
        ("Mean age", 45.8, "(X)", "(X)", "(X)", "(X)"),
    ]
    for i, row in enumerate(rows, 30):
        for c, v in enumerate(row, 1):
            ws.cell(i, c, v)
    wb.save(path)


def _hinc_fixture(path):
    wb = openpyxl.Workbook()
    ws = wb.active
    ws["A9"] = "Characteristic"
    ws["C9"] = "Under 65 years"
    ws["C10"] = "Total under 65 years"
    ws["D10"] = "15 to 24 years"
    ws["E10"] = "25 to 34 years"
    ws["H10"] = "65 to 74 years"
    ws["E11"] = "Total"
    ws["F11"] = "25 to 29 years"
    ws["G11"] = "30 to 34 years"
    ws["H11"] = "Total"
    ws["I11"] = "65 to 69 years"
    ws["J10"] = "75 years and over"
    medians = ["Median income (dollars)", 87460, 101900, 60870, 94880, 87640, 101100, 59680, 68800, 50880]
    ses = ["..Standard error (dollars)", 632, 468, 957, 1731, 2254, 844, 664, 1192, 893]
    for c, v in enumerate(medians, 1):
        ws.cell(54, c, v)
    for c, v in enumerate(ses, 1):
        ws.cell(55, c, v)
    wb.save(path)


def _sipp_fixture(path, cells, include_se=True):
    """cells: {(age_label, column_key): value}. Columns follow the SIPP two-row header."""
    wb = openpyxl.Workbook()
    wb.remove(wb.active)
    for name, scale in (("Table 1", 1), ("Table 1A", 0.1)):
        ws = wb.create_sheet(name)
        ws["A3"] = "Characteristic"
        ws["B3"] = "Total Debt"
        ws["C3"] = "Secured Debt"
        ws["G3"] = "Unsecured Debt"
        ws["C4"] = "Total"
        ws["D4"] = "Home Debt"
        ws["G4"] = "Total"
        ws["H4"] = "Credit Card Debt"
        ws["A17"] = "Age of Householder"
        ws["A18"] = "Less than 35 years"
        ws["A19"] = "35 to 44 years"
        ws["A20"] = ".75 and over"
        ws["A21"] = "Generation of Householder"
        cols = {"Total Debt": 2, "Secured Debt|Home Debt": 4, "Unsecured Debt|Credit Card Debt": 8}
        for (age, key), v in cells.items():
            row = {"Less than 35 years": 18, "35 to 44 years": 19, ".75 and over": 20}[age]
            val = v if not isinstance(v, (int, float)) or scale == 1 else v // 10
            ws.cell(row, cols[key], val)
    wb.save(path)


class NumberAndAgeParsing(unittest.TestCase):
    def test_age_labels_keep_their_published_bounds(self):
        self.assertEqual(build.parse_age_label("....25 to 29 years"), (25, 29))
        self.assertEqual(build.parse_age_label(".75 and over"), (75, None))
        self.assertEqual(build.parse_age_label("75 years and over"), (75, None))
        self.assertEqual(build.parse_age_label("Less than 35 years"), (15, 34))
        self.assertIsNone(build.parse_age_label("Total, 15 years and over"))

    def test_zero_is_a_value_not_missing(self):
        self.assertEqual(build.parse_number(0), Decimal("0"))

    def test_provider_sentinels_are_missing_not_zero(self):
        for s in ("(B)", "(D)", "(X)", "(S)", "(NA)", "-", None):
            self.assertIs(build.parse_number(s), build.MISSING)

    def test_negative_values_survive(self):
        # Signed financial values (net losses) must not be treated as sentinels.
        self.assertEqual(build.parse_number(-1250), Decimal("-1250"))

    def test_money_serialises_without_exponent_or_float_noise(self):
        self.assertEqual(build.money(Decimal("49870")), "49870")
        self.assertEqual(build.money(Decimal("0.1645")), "0.1645")
        self.assertEqual(build.money(Decimal("1E+3")), "1000")

    def test_reliability_flags_high_variance(self):
        self.assertEqual(build.reliability(Decimal("100"), Decimal("10")), "ok")
        self.assertEqual(build.reliability(Decimal("100"), Decimal("45")), "unreliable")
        self.assertEqual(build.reliability(Decimal("100"), None), "ok")
        self.assertEqual(build.reliability(Decimal("0"), Decimal("5")), "unreliable")


class IncomeParsers(unittest.TestCase):
    def setUp(self):
        self.tmp = tempfile.TemporaryDirectory()
        self.addCleanup(self.tmp.cleanup)

    def test_age_cell_keeps_its_population(self):
        path = os.path.join(self.tmp.name, "pinc.xlsx")
        _pinc_fixture(path)
        rec = next(r for r in build.parse_pinc01(path) if (r["ageMin"], r["ageMax"]) == (25, 29))
        self.assertEqual(rec["median"], Decimal("49870"))
        self.assertEqual(rec["medianSe"], Decimal("857"))
        self.assertEqual(rec["row"], 33)
        self.assertEqual(rec["column"], 3)

    def test_pinc_returns_only_the_finest_published_cohorts(self):
        path = os.path.join(self.tmp.name, "pinc.xlsx")
        _pinc_fixture(path)
        bounds = sorted((r["ageMin"], r["ageMax"]) for r in build.parse_pinc01(path))
        # 25-34 is a roll-up of 25-29 and 30-34; including both would overlap.
        self.assertEqual(bounds, [(15, 24), (25, 29), (30, 34), (75, None)])

    def test_pinc_rejects_a_workbook_whose_block_is_not_all_people(self):
        path = os.path.join(self.tmp.name, "pinc.xlsx")
        _pinc_fixture(path)
        wb = openpyxl.load_workbook(path)
        wb.active["A8"] = "Male"
        wb.save(path)
        with self.assertRaises(build.SourceLayoutError):
            build.parse_pinc01(path)

    def test_pinc_rejects_changed_headers(self):
        path = os.path.join(self.tmp.name, "pinc.xlsx")
        _pinc_fixture(path)
        wb = openpyxl.load_workbook(path)
        wb.active["C28"] = "Average income"
        wb.save(path)
        with self.assertRaises(build.SourceLayoutError):
            build.parse_pinc01(path)

    def test_hinc_uses_the_row_11_cohort_when_it_exists(self):
        path = os.path.join(self.tmp.name, "hinc.xlsx")
        _hinc_fixture(path)
        recs = {(r["ageMin"], r["ageMax"]): r for r in build.parse_hinc02(path)}
        self.assertEqual(sorted(recs, key=lambda b: b[0]),
                         [(15, 24), (25, 29), (30, 34), (65, 69), (75, None)])
        self.assertEqual(recs[(25, 29)]["median"], Decimal("87640"))
        self.assertEqual(recs[(25, 29)]["medianSe"], Decimal("2254"))
        self.assertEqual(recs[(75, None)]["median"], Decimal("50880"))


class SippParser(unittest.TestCase):
    def setUp(self):
        self.tmp = tempfile.TemporaryDirectory()
        self.addCleanup(self.tmp.cleanup)
        self.path = os.path.join(self.tmp.name, "debt.xlsx")
        _sipp_fixture(self.path, {
            ("Less than 35 years", "Total Debt"): 53000,
            ("35 to 44 years", "Secured Debt|Home Debt"): "(B)",
            ("35 to 44 years", "Unsecured Debt|Credit Card Debt"): 0,
            (".75 and over", "Total Debt"): 78500,
        })

    def test_two_row_headers_resolve_to_group_and_column(self):
        cols = build.sipp_columns(openpyxl.load_workbook(self.path)["Table 1"])
        self.assertEqual(cols["Total Debt"], 2)
        self.assertEqual(cols["Secured Debt|Home Debt"], 4)
        self.assertEqual(cols["Unsecured Debt|Credit Card Debt"], 8)

    def test_value_and_standard_error_pair_up(self):
        recs = build.parse_sipp(self.path, "Table 1", "Table 1A", ["Total Debt"])
        young = next(r for r in recs if r["ageMin"] == 15)
        self.assertEqual(young["value"], Decimal("53000"))
        self.assertEqual(young["se"], Decimal("5300.0"))
        self.assertEqual(young["row"], 18)

    def test_suppressed_cell_is_reported_not_zeroed(self):
        recs = build.parse_sipp(self.path, "Table 1", "Table 1A", ["Secured Debt|Home Debt"])
        cell = next(r for r in recs if r["ageMin"] == 35)
        self.assertIs(cell["value"], build.MISSING)

    def test_genuine_zero_is_kept(self):
        recs = build.parse_sipp(self.path, "Table 1", "Table 1A", ["Unsecured Debt|Credit Card Debt"])
        cell = next(r for r in recs if r["ageMin"] == 35)
        self.assertEqual(cell["value"], Decimal("0"))

    def test_open_ended_age_band_has_no_upper_bound(self):
        recs = build.parse_sipp(self.path, "Table 1", "Table 1A", ["Total Debt"])
        old = next(r for r in recs if r["ageMin"] == 75)
        self.assertIsNone(old["ageMax"])

    def test_missing_column_is_a_layout_error(self):
        with self.assertRaises(build.SourceLayoutError):
            build.parse_sipp(self.path, "Table 1", "Table 1A", ["Student Loans"])

    def test_age_section_stops_before_the_next_section(self):
        recs = build.parse_sipp(self.path, "Table 1", "Table 1A", ["Total Debt"])
        self.assertEqual(len(recs), 3)


def _record(**over):
    rec = {
        "id": "r1", "metric": "income", "mode": "household", "definitionId": "d",
        "population": "Households", "universe": "all", "geography": "US",
        "ageMin": 25, "ageMax": 29, "statistic": "median", "value": "100.00",
        "unit": "usd_per_year",
        "period": {"kind": "flow", "from": "2025-01-01", "to": "2025-12-31"},
        "dollarBasis": {"kind": "month", "period": "2025-12"},
        "sourceId": "s1", "sourceUrl": "https://example.gov/x", "sourceLocator": "A1",
        "uncertainty": {"kind": "se", "value": "5"}, "annotation": None,
        "reliability": "ok",
    }
    rec.update(over)
    return rec


def _package(records, **manifest_over):
    manifest = {
        "formatVersion": 1, "packageVersion": "test", "synthetic": False,
        "transformationVersion": "1",
        "sources": [{"id": "s1", "url": "https://example.gov/x", "sha256": "0" * 64,
                     "released": "2026-07-15", "retrieved": "2026-09-30"}],
        "cpi": {"series": "CPIAUCNS", "latestMonth": "2025-12"},
        "gaps": [], "capabilities": [],
    }
    manifest.update(manifest_over)
    cpi = {"series": "CPIAUCNS", "months": {"2025-12": "300.000"}}
    return manifest, records, cpi


CE_SERIES = {
    "CXUTOTALEXPLB0402M": {"label": "Under Age 25", "ageMin": 15, "ageMax": 24},
    "CXUTOTALEXPLB0403M": {"label": "from Age 25 to 34", "ageMin": 25, "ageMax": 34},
    "CXUTOTALEXPLB0407M": {"label": "Age 65 or over", "ageMin": 65, "ageMax": None},
    "CXUTOTALEXPLB0408M": {"label": "from Age 65 to 74", "ageMin": 65, "ageMax": 74},
    "CXUTOTALEXPLB0409M": {"label": "Age 75 or over", "ageMin": 75, "ageMax": None},
}


def _bls_response(values, year="2024", status="REQUEST_SUCCEEDED", response_time=123):
    """A BLS API v2 response shaped like the real one. Values are SYNTHETIC."""
    return {
        "status": status, "responseTime": response_time, "message": [],
        "Results": {"series": [
            {"seriesID": sid, "data": [] if v is None else [{"year": year, "period": "A01", "periodName": "Annual", "value": v,
                                                             "footnotes": [{}]}]}
            for sid, v in values.items()
        ]},
    }


class BlsApiSource(unittest.TestCase):
    """The BLS Consumer Expenditure figures come from the BLS API (bls.gov's pages reject scripts)."""

    def test_normalised_response_ignores_what_changes_between_calls(self):
        a = build.normalize_bls_response(_bls_response({"CXUTOTALEXPLB0403M": "60000"}, response_time=5))
        b = build.normalize_bls_response(_bls_response({"CXUTOTALEXPLB0403M": "60000"}, response_time=999))
        self.assertEqual(a, b)
        self.assertEqual(a, {"CXUTOTALEXPLB0403M": {"2024": "60000"}})

    def test_failed_request_is_an_error_not_an_empty_source(self):
        with self.assertRaises(build.SourceLayoutError):
            build.normalize_bls_response(_bls_response({"CXUTOTALEXPLB0403M": "60000"}, status="REQUEST_NOT_PROCESSED"))

    def test_ce_cohorts_carry_their_published_bounds_and_drop_the_roll_up(self):
        with tempfile.TemporaryDirectory() as d:
            path = os.path.join(d, "ce.json")
            with open(path, "wb") as f:
                f.write(build.bls_cache_bytes(build.normalize_bls_response(_bls_response(
                    {"CXUTOTALEXPLB0402M": "40000", "CXUTOTALEXPLB0403M": "60000", "CXUTOTALEXPLB0407M": "55000",
                     "CXUTOTALEXPLB0408M": "58000", "CXUTOTALEXPLB0409M": "50000"}))))
            cells = build.parse_ce(path, CE_SERIES, "2024")
        by_age = {(c["ageMin"], c["ageMax"]): c for c in cells}
        self.assertEqual(set(by_age), {(15, 24), (25, 34), (65, 74), (75, None)}, "65 and over is a roll-up of 65-74 and 75+")
        self.assertEqual(by_age[(25, 34)]["value"], Decimal("60000"))
        self.assertIs(by_age[(25, 34)]["se"], build.MISSING, "the API publishes no standard errors")
        self.assertEqual(by_age[(25, 34)]["locator"], "CXUTOTALEXPLB0403M/2024")

    def test_ce_value_missing_for_the_year_is_reported_missing_not_zero(self):
        with tempfile.TemporaryDirectory() as d:
            path = os.path.join(d, "ce.json")
            with open(path, "wb") as f:
                f.write(build.bls_cache_bytes(build.normalize_bls_response(_bls_response({"CXUTOTALEXPLB0403M": None}))))
            cells = build.parse_ce(path, {"CXUTOTALEXPLB0403M": CE_SERIES["CXUTOTALEXPLB0403M"]}, "2024")
        self.assertIs(cells[0]["value"], build.MISSING)

    def test_ce_series_not_in_the_response_is_a_layout_error(self):
        with tempfile.TemporaryDirectory() as d:
            path = os.path.join(d, "ce.json")
            with open(path, "wb") as f:
                f.write(build.bls_cache_bytes({}))
            with self.assertRaises(build.SourceLayoutError):
                build.parse_ce(path, {"CXUTOTALEXPLB0403M": CE_SERIES["CXUTOTALEXPLB0403M"]}, "2024")

    def test_api_source_is_fetched_with_its_request_and_pinned_on_the_normalised_bytes(self):
        sent = []

        def fake_post(url, body):
            sent.append((url, json.loads(body)))
            return _bls_response({"CXUTOTALEXPLB0403M": "60000"}, response_time=len(sent))

        normalized = build.bls_cache_bytes({"CXUTOTALEXPLB0403M": {"2024": "60000"}})
        src = {"id": "ce", "url": "https://api.example/ts", "file": "ce.json",
               "request": {"seriesid": ["CXUTOTALEXPLB0403M"], "startyear": "2024", "endyear": "2024"},
               "sha256": __import__("hashlib").sha256(normalized).hexdigest()}
        cpi = {"file": "cpi.csv", "url": "x", "sha256": __import__("hashlib").sha256(b"cpi").hexdigest()}
        with tempfile.TemporaryDirectory() as d:
            with open(os.path.join(d, "cpi.csv"), "wb") as f:
                f.write(b"cpi")
            build.ensure_cache({"sources": [src], "cpi": cpi}, d, offline=False, post_json=fake_post)
            self.assertEqual(_read(os.path.join(d, "ce.json")), normalized)
        self.assertEqual(sent, [("https://api.example/ts", src["request"])])


class PackageValidation(unittest.TestCase):
    def test_valid_package_passes(self):
        self.assertEqual(validate.check(*_package([_record()])), [])

    def test_synthetic_package_is_rejected_for_release(self):
        errs = validate.check(*_package([_record()], synthetic=True))
        self.assertTrue(any("synthetic" in e for e in errs))

    def test_duplicate_record_ids_are_rejected(self):
        errs = validate.check(*_package([_record(), _record()]))
        self.assertTrue(any("duplicate" in e for e in errs))

    def test_overlapping_ages_for_one_definition_are_rejected(self):
        a = _record(id="a", ageMin=25, ageMax=34)
        b = _record(id="b", ageMin=30, ageMax=39)
        errs = validate.check(*_package([a, b]))
        self.assertTrue(any("overlap" in e for e in errs))

    def test_adjacent_ages_are_not_an_overlap(self):
        a = _record(id="a", ageMin=25, ageMax=34)
        b = _record(id="b", ageMin=35, ageMax=44)
        self.assertEqual(validate.check(*_package([a, b])), [])

    def test_open_ended_band_overlaps_anything_above_it(self):
        a = _record(id="a", ageMin=65, ageMax=None)
        b = _record(id="b", ageMin=70, ageMax=74)
        self.assertTrue(any("overlap" in e for e in validate.check(*_package([a, b]))))

    def test_value_must_be_a_decimal_string_not_a_float(self):
        errs = validate.check(*_package([_record(value=100.5)]))
        self.assertTrue(any("value" in e for e in errs))

    def test_missing_value_is_rejected_rather_than_defaulted_to_zero(self):
        errs = validate.check(*_package([_record(value=None)]))
        self.assertTrue(any("value" in e for e in errs))

    def test_unknown_source_id_is_rejected(self):
        errs = validate.check(*_package([_record(sourceId="nope")]))
        self.assertTrue(any("source" in e for e in errs))

    def test_basis_month_missing_from_cpi_is_rejected(self):
        errs = validate.check(*_package([_record(dollarBasis={"kind": "month", "period": "1999-01"})]))
        self.assertTrue(any("cpi" in e.lower() for e in errs))

    def test_latest_cpi_month_must_exist_in_series(self):
        errs = validate.check(*_package([_record()], cpi={"series": "CPIAUCNS", "latestMonth": "2026-01"}))
        self.assertTrue(any("latestMonth" in e for e in errs))

    def test_annual_average_basis_needs_every_month_published(self):
        # The October 2025 CPI was never published, so a 2025 annual average cannot be built.
        basis = {"kind": "annual_average", "period": "2025"}
        errs = validate.check(*_package([_record(dollarBasis=basis)]))
        self.assertTrue(any("12 published months" in e for e in errs))

    def test_unsupported_format_version_is_rejected(self):
        errs = validate.check(*_package([_record()], formatVersion=99))
        self.assertTrue(any("formatVersion" in e for e in errs))

    def test_unknown_metric_or_mode_is_rejected(self):
        errs = validate.check(*_package([_record(metric="cheese", mode="alien")]))
        self.assertTrue(any("metric" in e for e in errs))
        self.assertTrue(any("mode" in e for e in errs))


class BuildIsDeterministic(unittest.TestCase):
    def test_same_inputs_give_identical_bytes(self):
        manifest, records, cpi = _package([_record(id="b"), _record(id="a", ageMin=30, ageMax=34)])
        with tempfile.TemporaryDirectory() as d1, tempfile.TemporaryDirectory() as d2:
            build.write_package(d1, manifest, records, cpi)
            build.write_package(d2, manifest, list(reversed(records)), cpi)
            for name in ("records.json", "manifest.json", "cpi.json"):
                self.assertEqual(_read(os.path.join(d1, name)), _read(os.path.join(d2, name)), name)

    def test_manifest_records_the_records_checksum(self):
        manifest, records, cpi = _package([_record()])
        with tempfile.TemporaryDirectory() as d:
            build.write_package(d, manifest, records, cpi)
            written = json.loads(_read(os.path.join(d, "manifest.json")))
            self.assertEqual(len(written["recordsSha256"]), 64)
            self.assertEqual(validate.check_dir(d), [])

    def test_failed_validation_leaves_the_previous_package_untouched(self):
        manifest, records, cpi = _package([_record()])
        with tempfile.TemporaryDirectory() as d:
            build.write_package(d, manifest, records, cpi)
            before = _read(os.path.join(d, "records.json"))
            bad = _record(id="x", value=None)
            with self.assertRaises(build.PackageInvalid):
                build.write_package(d, manifest, [bad], cpi)
            self.assertEqual(_read(os.path.join(d, "records.json")), before)


PACKAGE_DIR = os.path.join(os.path.dirname(__file__), "..", "..", "core", "data", "benchmarks")


class ShippedPackageGoldenCells(unittest.TestCase):
    """Values transcribed by hand from the official workbooks' own cells (not from parser output).

    The expected numbers below are the real published figures, so they live in the
    contract test for the shipped package rather than in the synthetic fixtures above.
    """

    @classmethod
    def setUpClass(cls):
        cls.by_id = {r["id"]: r for r in json.loads(_read(os.path.join(PACKAGE_DIR, "records.json")))}

    def test_shipped_package_is_valid_and_not_synthetic(self):
        self.assertEqual(validate.check_dir(PACKAGE_DIR), [])

    def test_individual_income_25_to_29_matches_pinc01(self):
        r = self.by_id["cps_pinc01_money_income_median:25-29"]
        self.assertEqual((r["value"], r["uncertainty"]["value"]), ("49870", "857"))
        self.assertEqual((r["mode"], r["statistic"], r["period"]["from"]), ("individual", "median", "2025-01-01"))

    def test_individual_income_75_plus_is_open_ended(self):
        r = self.by_id["cps_pinc01_money_income_median:75-"]
        self.assertEqual((r["value"], r["ageMax"]), ("31640", None))

    def test_household_income_cells_match_hinc02(self):
        for age, value in (("25-29", "87640"), ("30-34", "101100"), ("65-69", "71400"), ("75-", "50880")):
            self.assertEqual(self.by_id[f"cps_hinc02_money_income_median:{age}"]["value"], value, age)

    def test_household_debt_cells_match_sipp(self):
        self.assertEqual(self.by_id["sipp_total_debt_median:15-34"]["value"], "53000")
        self.assertEqual(self.by_id["sipp_home_debt_median:15-34"]["value"], "215000")
        self.assertEqual(self.by_id["sipp_credit_card_debt_median:15-34"]["value"], "4000")
        self.assertEqual(self.by_id["sipp_total_debt_median:35-44"]["value"], "128000")

    def test_suppressed_sipp_cell_is_absent_not_zero(self):
        # Home debt under 35 is published, but business debt for under-35s is "(B)" and not shipped at all;
        # a suppressed home-debt cell must never appear as a record.
        manifest = json.loads(_read(os.path.join(PACKAGE_DIR, "manifest.json")))
        for s in manifest["suppressed"]:
            self.assertNotIn(f"{s['definitionId']}:{s['ageMin']}-{'' if s['ageMax'] is None else s['ageMax']}", self.by_id)

    def test_every_sipp_record_is_a_household_holders_only_reference(self):
        for r in self.by_id.values():
            if r["definitionId"].startswith("sipp_"):
                self.assertEqual(r["universe"], "holders", r["id"])
                self.assertEqual(r["mode"], "household", r["id"])

    def test_income_is_priced_at_a_published_cpi_month(self):
        cpi = json.loads(_read(os.path.join(PACKAGE_DIR, "cpi.json")))
        r = self.by_id["cps_pinc01_money_income_median:25-29"]
        self.assertEqual(r["dollarBasis"], {"kind": "month", "period": "2025-07"})
        self.assertIn("2025-07", cpi["months"])
        self.assertNotIn("2025-10", cpi["months"])

    def test_household_spending_matches_the_bls_series_as_an_average(self):
        # Total average annual expenditures by age of reference person, 2024 (BLS series CXUTOTALEXPLB04..M,
        # titles confirmed on ALFRED): under 25 47283, 25-34 74475, 35-44 91229, 45-54 100327, 55-64 84946,
        # 65-74 65354, 75+ 55834.
        for age, value in (("15-24", "47283"), ("25-34", "74475"), ("35-44", "91229"), ("45-54", "100327"),
                           ("55-64", "84946"), ("65-74", "65354"), ("75-", "55834")):
            r = self.by_id[f"bls_ce_total_expenditures_mean:{age}"]
            self.assertEqual(r["value"], value, age)
            self.assertEqual((r["metric"], r["mode"], r["statistic"], r["universe"]), ("spending", "household", "mean", "all"))
            self.assertEqual(r["dollarBasis"], {"kind": "annual_average", "period": "2024"})
            self.assertEqual(r["period"], {"kind": "flow", "from": "2024-01-01", "to": "2024-12-31"})
        self.assertNotIn("bls_ce_total_expenditures_mean:65-", self.by_id, "65 and over is a roll-up and must not overlap")

    def test_unsupported_domains_are_documented_as_gaps(self):
        manifest = json.loads(_read(os.path.join(PACKAGE_DIR, "manifest.json")))
        gaps = {(g["metric"], g["mode"]) for g in manifest["gaps"]}
        shipped = {(c["metric"], c["mode"]) for c in manifest["capabilities"]}
        self.assertEqual(gaps & shipped, set())
        self.assertIn(("spending", "individual"), gaps)
        self.assertEqual(shipped, {("income", "individual"), ("income", "household"), ("savings", "household"),
                                   ("investments", "household"), ("debt", "household"), ("spending", "household")})


if __name__ == "__main__":
    unittest.main()
