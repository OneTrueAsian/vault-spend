use budget_core::mobile_snapshot::{MAX_MOBILE_SNAPSHOT_BYTES, parse_mobile_snapshot, serialize_mobile_snapshot};
use serde_json::{Value, json};
const COMPLETE: &str = include_str!("fixtures/mobile_snapshot_v1.json");
const EMPTY: &str = include_str!("fixtures/mobile_snapshot_empty_v1.json");

#[test]
fn complete_and_empty_round_trip_without_store() {
    for fixture in [COMPLETE, EMPTY, include_str!("fixtures/mobile_snapshot_comparisons_v1.json")] {
        let snapshot = parse_mobile_snapshot(fixture, None).unwrap();
        let serialized = serialize_mobile_snapshot(&snapshot).unwrap();
        assert_eq!(
            serde_json::from_str::<Value>(fixture).unwrap(),
            serde_json::from_str::<Value>(&serialized).unwrap()
        );
    }
}

#[test]
fn invalid_contracts_fail_before_ingress() {
    let original: Value = serde_json::from_str(COMPLETE).unwrap();
    let cases = [
        ("/schemaVersion", json!(2)),
        ("/minimumViewerVersion", json!(2)),
        ("/overview/cash", json!(0.1)),
        ("/asOfDate", json!("2026-02-30")),
        ("/sequence", json!("01")),
        ("/history/months/0/month", json!("2026-11")),
        ("/accounts/0/accountType", json!("mystery")),
    ];
    for (path, value) in cases {
        let mut v = original.clone();
        *v.pointer_mut(path).unwrap() = value;
        assert!(parse_mobile_snapshot(&v.to_string(), None).is_err(), "accepted {path}");
    }
    for (path, key) in [("", "transactions"), ("/investments", "holdings")] {
        let mut v = original.clone();
        v.pointer_mut(path).unwrap()[key] = json!([]);
        assert!(parse_mobile_snapshot(&v.to_string(), None).is_err());
    }
    let mut v = original.clone();
    v.as_object_mut().unwrap().remove("calculators");
    assert!(parse_mobile_snapshot(&v.to_string(), None).is_err());
    let mut v = original.clone();
    let account = v["accounts"][0].clone();
    v["accounts"].as_array_mut().unwrap().push(account);
    assert!(parse_mobile_snapshot(&v.to_string(), None).is_err());
    assert!(parse_mobile_snapshot(COMPLETE, Some(("other", "profile-test"))).is_err());
    assert!(parse_mobile_snapshot(COMPLETE, Some(("installation-test", "other"))).is_err());
    assert!(parse_mobile_snapshot(&" ".repeat(MAX_MOBILE_SNAPSHOT_BYTES + 1), None).is_err());
}

#[test]
fn sequence_does_not_depend_on_javascript_numeric_precision() {
    let mut v: Value = serde_json::from_str(COMPLETE).unwrap();
    v["sequence"] = json!("9007199254740993");
    assert_eq!(parse_mobile_snapshot(&v.to_string(), None).unwrap().sequence, "9007199254740993");
    v["sequence"] = json!("18446744073709551616");
    assert!(parse_mobile_snapshot(&v.to_string(), None).is_err());
}

#[test]
fn shared_browser_compatibility_cases() {
    let original: Value = serde_json::from_str(COMPLETE).unwrap();
    let cases: Value = serde_json::from_str(include_str!("fixtures/mobile_snapshot_cases.json")).unwrap();
    for case in cases.as_array().unwrap() {
        let mut value = original.clone();
        *value.pointer_mut(case["path"].as_str().unwrap()).unwrap() = case["value"].clone();
        assert_eq!(
            parse_mobile_snapshot(&value.to_string(), None).is_ok(),
            case["valid"].as_bool().unwrap(),
            "{}",
            case["name"]
        );
    }
}
