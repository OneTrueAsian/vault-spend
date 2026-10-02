//! The reviewed public benchmark package that ships inside the app (`core/data/benchmarks`).
//! Loading re-validates everything the maintainer tools check, so a corrupted or hand-edited
//! package is refused at runtime instead of producing a quietly wrong comparison.
use super::types::{ComparisonMode, DollarBasis, MetricId, Reference};
use rust_decimal::Decimal;
use serde::Deserialize;
use sha2::{Digest, Sha256};
use std::collections::{BTreeMap, HashSet};
use std::str::FromStr;
use std::sync::OnceLock;

pub const FORMAT_VERSION: u32 = 1;

const BUNDLED_MANIFEST: &str = include_str!("../../data/benchmarks/manifest.json");
const BUNDLED_RECORDS: &str = include_str!("../../data/benchmarks/records.json");
const BUNDLED_CPI: &str = include_str!("../../data/benchmarks/cpi.json");

#[derive(Debug)]
pub enum PackageError {
    /// The files are not the JSON shape we expect.
    Parse(String),
    /// The files parse but break a package rule (checksum, overlap, unknown basis, ...).
    Invalid(String),
}

impl std::fmt::Display for PackageError {
    fn fmt(&self, f: &mut std::fmt::Formatter<'_>) -> std::fmt::Result {
        match self {
            PackageError::Parse(m) => write!(f, "benchmark package could not be read: {m}"),
            PackageError::Invalid(m) => write!(f, "benchmark package is invalid: {m}"),
        }
    }
}

impl std::error::Error for PackageError {}

#[derive(Debug, Clone, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct SourceInfo {
    pub id: String,
    pub url: String,
    #[serde(default)]
    pub provider: Option<String>,
    #[serde(default)]
    pub dataset: Option<String>,
    #[serde(default)]
    pub released: Option<String>,
    pub retrieved: String,
}

/// A metric/mode the package deliberately does not cover, with the documented reason.
#[derive(Debug, Clone, Deserialize)]
pub struct Gap {
    pub metric: MetricId,
    pub mode: ComparisonMode,
    pub reason: String,
}

#[derive(Debug, Deserialize)]
#[serde(rename_all = "camelCase")]
struct ManifestFile {
    format_version: u32,
    package_version: String,
    synthetic: bool,
    records_sha256: String,
    cpi: ManifestCpi,
    #[serde(default)]
    gaps: Vec<Gap>,
    sources: Vec<SourceInfo>,
}

#[derive(Debug, Deserialize)]
#[serde(rename_all = "camelCase")]
struct ManifestCpi {
    latest_month: String,
}

#[derive(Debug, Deserialize)]
struct CpiFile {
    months: BTreeMap<String, String>,
}

#[derive(Debug)]
pub struct Package {
    package_version: String,
    latest_cpi_month: String,
    references: Vec<Reference>,
    cpi: BTreeMap<String, Decimal>,
    gaps: Vec<Gap>,
    sources: Vec<SourceInfo>,
}

fn invalid<T>(message: impl Into<String>) -> Result<T, PackageError> {
    Err(PackageError::Invalid(message.into()))
}

fn overlaps(a: &Reference, b: &Reference) -> bool {
    let a_hi = a.age_max.map_or(u64::MAX, u64::from);
    let b_hi = b.age_max.map_or(u64::MAX, u64::from);
    u64::from(a.age_min) <= b_hi && u64::from(b.age_min) <= a_hi
}

impl Package {
    /// The package compiled into the app. Validated once, on first use.
    pub fn bundled() -> Result<&'static Package, &'static PackageError> {
        static BUNDLED: OnceLock<Result<Package, PackageError>> = OnceLock::new();
        BUNDLED
            .get_or_init(|| Package::from_json(BUNDLED_MANIFEST, BUNDLED_RECORDS, BUNDLED_CPI))
            .as_ref()
    }

    pub fn from_json(manifest: &str, records: &str, cpi: &str) -> Result<Package, PackageError> {
        let manifest: ManifestFile = serde_json::from_str(manifest).map_err(|e| PackageError::Parse(format!("manifest: {e}")))?;
        if manifest.format_version != FORMAT_VERSION {
            return invalid(format!(
                "formatVersion {} is not supported (expected {FORMAT_VERSION})",
                manifest.format_version
            ));
        }
        if manifest.synthetic {
            return invalid("package is tagged synthetic; synthetic fixtures must never ship");
        }
        let digest: String = Sha256::digest(records.as_bytes()).iter().map(|b| format!("{b:02x}")).collect();
        if digest != manifest.records_sha256 {
            return invalid("records checksum does not match the manifest");
        }
        let references: Vec<Reference> = serde_json::from_str(records).map_err(|e| PackageError::Parse(format!("records: {e}")))?;
        let cpi_file: CpiFile = serde_json::from_str(cpi).map_err(|e| PackageError::Parse(format!("cpi: {e}")))?;
        let mut cpi_months = BTreeMap::new();
        for (month, text) in cpi_file.months {
            let value = Decimal::from_str(&text).map_err(|_| PackageError::Invalid(format!("cpi month {month} is not a decimal: {text:?}")))?;
            cpi_months.insert(month, value);
        }
        if !cpi_months.contains_key(&manifest.cpi.latest_month) {
            return invalid(format!("cpi latestMonth {} is not in the bundled series", manifest.cpi.latest_month));
        }

        let source_ids: HashSet<&str> = manifest.sources.iter().map(|s| s.id.as_str()).collect();
        let mut seen = HashSet::new();
        for r in &references {
            if !seen.insert(r.id.as_str()) {
                return invalid(format!("duplicate record id {}", r.id));
            }
            if !source_ids.contains(r.source_id.as_str()) {
                return invalid(format!("{}: unknown source {}", r.id, r.source_id));
            }
            match &r.dollar_basis {
                DollarBasis::Month { period } if !cpi_months.contains_key(period) => {
                    return invalid(format!("{}: dollar basis {period} is not in the cpi series", r.id));
                }
                DollarBasis::AnnualAverage { period } if !(1..=12).all(|m| cpi_months.contains_key(&format!("{period}-{m:02}"))) => {
                    return invalid(format!("{}: annual-average cpi basis {period} needs all 12 published months", r.id));
                }
                _ => {}
            }
            if r.age_max.is_some_and(|hi| hi < r.age_min) {
                return invalid(format!("{}: age bounds are reversed", r.id));
            }
        }
        for (i, a) in references.iter().enumerate() {
            for b in &references[i + 1..] {
                let same_definition = a.metric == b.metric
                    && a.mode == b.mode
                    && a.definition_id == b.definition_id
                    && a.population == b.population
                    && a.universe == b.universe
                    && a.geography == b.geography
                    && a.statistic == b.statistic;
                if same_definition && overlaps(a, b) {
                    return invalid(format!("age cohorts overlap in {}: {} and {}", a.definition_id, a.id, b.id));
                }
            }
        }

        Ok(Package {
            package_version: manifest.package_version,
            latest_cpi_month: manifest.cpi.latest_month,
            references,
            cpi: cpi_months,
            gaps: manifest.gaps,
            sources: manifest.sources,
        })
    }

    pub fn package_version(&self) -> &str {
        &self.package_version
    }

    pub fn latest_cpi_month(&self) -> &str {
        &self.latest_cpi_month
    }

    pub fn sources(&self) -> &[SourceInfo] {
        &self.sources
    }

    pub fn references(&self, metric: MetricId, mode: ComparisonMode) -> impl Iterator<Item = &Reference> {
        self.references.iter().filter(move |r| r.metric == metric && r.mode == mode)
    }

    pub fn reference_by_id(&self, id: &str) -> Option<&Reference> {
        self.references.iter().find(|r| r.id == id)
    }

    /// The documented reason this metric/mode has no benchmark, if the maintainers recorded one.
    pub fn gap_reason(&self, metric: MetricId, mode: ComparisonMode) -> Option<&str> {
        self.gaps.iter().find(|g| g.metric == metric && g.mode == mode).map(|g| g.reason.as_str())
    }

    pub fn cpi(&self, month: &str) -> Option<Decimal> {
        self.cpi.get(month).copied()
    }

    /// Average of a year's twelve CPI months; `None` unless every month was published.
    pub fn cpi_annual_average(&self, year: &str) -> Option<Decimal> {
        let mut sum = Decimal::ZERO;
        for m in 1..=12 {
            sum += self.cpi(&format!("{year}-{m:02}"))?;
        }
        Some(sum / Decimal::from(12))
    }
}
