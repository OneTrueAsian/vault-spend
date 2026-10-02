//! Synthetic reference packages for tests. Every number is invented.
#![allow(dead_code)]
use budget_core::comparisons::package::{Package, PackageError};
use serde_json::{Value, json};
use sha2::{Digest, Sha256};

pub fn reference(id: &str, metric: &str, mode: &str, definition: &str, age_min: u32, age_max: Option<u32>, value: &str) -> Value {
    json!({
        "id": id, "metric": metric, "mode": mode, "definitionId": definition,
        "population": "Synthetic population", "universe": "all", "geography": "US",
        "ageMin": age_min, "ageMax": age_max, "statistic": "median", "value": value,
        "unit": "usd_per_year",
        "period": {"kind": "flow", "from": "2025-01-01", "to": "2025-12-31"},
        "dollarBasis": {"kind": "month", "period": "2025-12"},
        "sourceId": "s1", "sourceUrl": "https://example.gov/x", "sourceLocator": "A1",
        "uncertainty": {"kind": "se", "value": "5"}, "annotation": null, "reliability": "ok"
    })
}

pub fn cpi_json(months: &[(&str, &str)]) -> Value {
    let map: serde_json::Map<String, Value> = months.iter().map(|(m, v)| (m.to_string(), json!(v))).collect();
    json!({"series": "CPIAUCNS", "months": map})
}

pub fn default_cpi() -> Value {
    cpi_json(&[("2025-12", "300.000"), ("2026-06", "330.000")])
}

fn sha256_hex(raw: &str) -> String {
    Sha256::digest(raw.as_bytes()).iter().map(|b| format!("{b:02x}")).collect()
}

pub fn manifest_json(records_raw: &str, overrides: Value) -> Value {
    let mut m = json!({
        "formatVersion": 1, "packageVersion": "test", "synthetic": false, "transformationVersion": "1",
        "sources": [{"id": "s1", "url": "https://example.gov/x", "sha256": "0", "released": null, "retrieved": "2026-09-30"}],
        "cpi": {"series": "CPIAUCNS", "latestMonth": "2026-06"},
        "gaps": [], "suppressed": [], "capabilities": [],
        "recordsSha256": sha256_hex(records_raw),
    });
    if let Some(o) = overrides.as_object() {
        for (k, v) in o {
            m[k] = v.clone();
        }
    }
    m
}

pub fn package_with(records: Vec<Value>) -> Package {
    package_with_overrides(records, json!({}), default_cpi())
}

pub fn package_with_overrides(records: Vec<Value>, manifest: Value, cpi: Value) -> Package {
    try_package(records, manifest, cpi).expect("synthetic package should load")
}

pub fn try_package(records: Vec<Value>, manifest: Value, cpi: Value) -> Result<Package, PackageError> {
    let raw = serde_json::to_string_pretty(&records).unwrap();
    Package::from_json(&manifest_json(&raw, manifest).to_string(), &raw, &cpi.to_string())
}
