# Benchmark ingestion tools

Maintainer-only tooling that produces the public reference package bundled with Vault Spend
(`core/data/benchmarks/`: `manifest.json`, `records.json`, `cpi.json`). The app never calls
these sources at runtime and needs no API key. No user data is involved.

## Setup

```powershell
python -m venv .venv-benchmarks
.\.venv-benchmarks\Scripts\pip install -r tools/benchmarks/requirements.txt
```

`requirements.txt` is tools-only; nothing here is an app dependency.

## Commands

```powershell
python -m unittest discover -s tools/benchmarks -p "test_*.py"   # offline tests, synthetic fixtures
python tools/benchmarks/build.py --sources tools/benchmarks/sources.json --output core/data/benchmarks --offline --check
python tools/benchmarks/validate.py core/data/benchmarks
```

* `build.py` without `--offline` downloads missing files into `tools/benchmarks/.cache/` (ignored by git).
  Every file is checked against the `sha256` pinned in `sources.json`; a revised source fails the build
  until a maintainer reviews it and updates the pin.
* `--offline` never touches the network; tests and release validation use it.
* `--check` rebuilds in memory and fails if `core/data/benchmarks/` differs. Same inputs give byte-identical output.
* Writing validates and stages all files before replacing them individually. Validation failure leaves
  the previous package untouched; an I/O failure during replacement can leave a mixed package, which
  must pass `validate.py` before use. Replacement is atomic per file, not across all three files.
* `validate.py` rejects synthetic packages, duplicate ids, overlapping age bands for one definition,
  non-decimal or missing values, unknown sources, and CPI bases that were never published.

## What is in the package (2026.10.2)

| Metric | Mode | Source | Population | Notes |
| --- | --- | --- | --- | --- |
| income | individual | CPS ASEC 2026 PINC-01 | people 15+ with money income | median, 5-year cohorts, standard error |
| income | household | CPS ASEC 2026 HINC-02 | households by age of householder | median, 5-year cohorts, standard error |
| savings | household | SIPP 2025 wealth tables (Table 1) | households holding financial-institution assets | median, holders only |
| investments | household | SIPP wealth tables | holders of retirement accounts / of stocks and mutual funds | median, holders only |
| debt | household | SIPP debt tables | holders of total / home / credit-card / student-loan debt | median, holders only |
| spending | household | BLS Consumer Expenditure Surveys 2024 API series | consumer units by age of reference person | mean, all consumer units; no standard errors published by these series |

Not shipped, and documented under `gaps` in the manifest: every individual-mode domain except income
(the other sources publish households or consumer units only).
The app shows these as visible "unavailable" cards; nothing is substituted.

## Decisions a reviewer should know about

* **Finest cohorts only.** Roll-up rows (25-34 over 25-29 and 30-34) are dropped so a definition never has
  overlapping bands. A user who enters the band 25-34 therefore gets a cohort choice (see Task 3).
* **One statistic per definition/cohort.** Census references use medians; the BLS CE spending reference
  uses the published mean and labels that difference. Means and medians are not substituted for one another.
* **Holders only.** SIPP medians are conditional on owning the asset (the workbook notes say so). The
  all-households statistic is not derivable from a median, so no "all peers" reference is shipped for them.
* **Income dollar basis.** CPS income is for 2025 in 2025 dollars. The October 2025 CPI was never published,
  so no complete 2025 annual average exists; the package prices 2025 flows at the July 2025 CPI (midyear).
  `validate.py` refuses an `annual_average` basis unless all twelve months are present.
* **CPI source.** FRED's `CPIAUCNS` is the BLS CPI-U all items, U.S. city average, not seasonally adjusted
  (`CUUR0000SA0`); the BLS download host returns 403 to scripts. Re-check against bls.gov when refreshing.
* **Reliability.** A cell is flagged `unreliable` when its standard error exceeds 30% of the estimate.
  That threshold is maintainer-proposed and needs sign-off; Census publishes no single cut-off for these tables.
  Currently one cell is flagged (student loans, 75 and over).
* **Release dates.** Wealth and debt tables show an internet release date of 2026-07-15. The CPS table
  workbooks carry no release date, so `released` is `null` for them.

## Refreshing

1. Confirm an official release exists (do not infer from the calendar).
2. Update URLs and delete the stale cache files; run `build.py` without `--offline`, review the new hash,
   update the pin in `sources.json`, bump `packageVersion`.
3. Re-run the tests, review changed definitions, cohorts, suppressed cells and gaps, then commit the new package.

Authenticated Census API access (ACS B19049, which needs a `CENSUS_API_KEY`) is not used by the current
package. If it is added later, read the key from the environment and never print the key-bearing URL.
