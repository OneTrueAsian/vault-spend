use super::*;
use serde_json::{Value, json};

fn fixtures() -> Vec<Value> {
    serde_json::from_str(include_str!("ask_vault_retirement_fixtures.json")).unwrap()
}
fn seed(f: &Value) -> Store {
    let store = Store::open_in_memory().unwrap();
    store.conn.execute("DELETE FROM app_settings", []).unwrap();
    for a in f["seed"]["accounts"].as_array().unwrap() {
        store
            .conn
            .execute(
                "INSERT INTO accounts(id,name,account_type,starting_balance) VALUES(?1,?2,?3,?4)",
                params![
                    a["id"].as_i64().unwrap(),
                    a["name"].as_str().unwrap(),
                    a["type"].as_str().unwrap(),
                    a["startingBalance"].as_str().unwrap()
                ],
            )
            .unwrap();
        for t in a["transactions"].as_array().into_iter().flatten() {
            store
                .conn
                .execute(
                    "INSERT INTO transactions(account_id,date,description,amount,fingerprint,deleted_at) VALUES(?1,?2,'fixture',?3,'fixture',?4)",
                    params![
                        a["id"].as_i64().unwrap(),
                        t["date"].as_str().unwrap(),
                        t["amount"].as_str().unwrap(),
                        t["deleted"].as_bool().filter(|d| *d).map(|_| "2026-01-01")
                    ],
                )
                .unwrap();
        }
        for (i, r) in a["resets"].as_array().into_iter().flatten().enumerate() {
            store
                .conn
                .execute(
                    "INSERT INTO balance_resets(account_id,period,reset_date,balance) VALUES(?1,?2,?3,?4)",
                    params![
                        a["id"].as_i64().unwrap(),
                        format!("fixture-{i}"),
                        r["date"].as_str().unwrap(),
                        r["balance"].as_str().unwrap()
                    ],
                )
                .unwrap();
        }
        for h in a["holdings"].as_array().into_iter().flatten() {
            store
                .conn
                .execute(
                    "INSERT INTO holdings(account_id,symbol,name,shares,price,cost_basis) VALUES(?1,'TEST','fixture',?2,?3,'0')",
                    params![a["id"].as_i64().unwrap(), h["shares"].as_str().unwrap(), h["price"].as_str().unwrap()],
                )
                .unwrap();
        }
    }
    for p in f["seed"]["plans"].as_array().into_iter().flatten() {
        let date = p["withdrawMonth"].as_str().map(|s| format!("{s}-01"));
        store
            .conn
            .execute(
                "INSERT INTO investment_plans(account_id,monthly_contribution,annual_return_pct,withdraw_date) VALUES(?1,?2,?3,?4)",
                params![
                    p["accountId"].as_i64().unwrap(),
                    p["monthly"].as_str(),
                    p["returnPct"].as_str().unwrap(),
                    date
                ],
            )
            .unwrap();
    }
    if let Some(pct) = f["seed"]["inflationPct"].as_str() {
        store
            .conn
            .execute("INSERT INTO app_settings(id,inflation_pct) VALUES(1,?1)", params![pct])
            .unwrap();
    }
    store
}

#[test]
fn retirement_native_37_executable_frozen_context_cases_match_exactly_without_writes() {
    let mut failures = Vec::new();
    let mut checked = 0;
    for f in fixtures() {
        // Profile/session/revision refusals belong to the command tests, not a fabricated core authorization layer.
        if f["expected"]["error"].as_str().is_some_and(|e| e != "account_unavailable") {
            continue;
        }
        // Owner approved 18 October: this exact-duplicate fixture remains protocol/parser-only on the UNIQUE-name schema.
        // The real native counterpart is the visually-identical-Unicode fixture below; no schema/data is altered to fake parity.
        if f["id"] == "duplicate-names-are-different-accounts" {
            continue;
        }
        let store = seed(&f);
        let date = f["today"].as_str().unwrap().parse().unwrap();
        let before = store.read_revision().unwrap();
        let got = store.retirement_context(f["accountId"].as_i64().unwrap(), date);
        if f["expected"]["error"] == "account_unavailable" {
            assert!(matches!(got, Err(RetirementReadError::AccountUnavailable)), "{}", f["id"]);
        } else {
            let expected = &f["expected"]["reply"];
            let want = json!({"account":expected["account"],"worth":expected["worth"],"contribution":expected["contribution"],"returnAssumption":expected["returnAssumption"],"inflation":expected["inflation"],"retirementMonth":expected["retirementMonth"]});
            let actual = got.map(|v| serde_json::to_value(v).unwrap());
            if actual.as_ref().ok() != Some(&want) {
                failures.push(format!("{}: {:?} != {}", f["id"], actual, want));
            }
        }
        assert_eq!(before, store.read_revision().unwrap());
        checked += 1;
    }
    assert_eq!(
        checked, 37,
        "all 37 executable core fixtures must be exercised; five origin/revision refusals belong to command tests and the duplicate-name seed has a separate schema test"
    );
    assert!(failures.is_empty(), "{}", failures.join("\n"));
}
#[test]
fn retirement_roster_minimal_unicode_order_and_explicit_limit() {
    let store = Store::open_in_memory().unwrap();
    let day = "2026-10-17".parse().unwrap();
    for (i, name, kind) in [
        (1, "z", "investment"),
        (2, "ä", "investment"),
        (3, "A", "investment"),
        (4, "checking", "checking"),
    ] {
        store
            .conn
            .execute("INSERT INTO accounts(id,name,account_type) VALUES(?1,?2,?3)", params![i, name, kind])
            .unwrap();
    }
    assert_eq!(
        serde_json::to_value(store.retirement_accounts(day).unwrap()).unwrap(),
        json!([{"id":3,"name":"A"},{"id":1,"name":"z"},{"id":2,"name":"ä"}])
    );
    for i in 5..202 {
        store
            .conn
            .execute(
                "INSERT INTO accounts(name,account_type) VALUES(?1,'investment')",
                params![format!("IRA {i}")],
            )
            .unwrap();
    }
    assert_eq!(store.retirement_accounts(day).unwrap().len(), 200);
    store
        .conn
        .execute("INSERT INTO accounts(name,account_type) VALUES('one too many','investment')", [])
        .unwrap();
    assert!(matches!(store.retirement_accounts(day), Err(RetirementReadError::TooManyAccounts)));
}
#[test]
fn retirement_duplicate_names_are_prohibited_by_real_schema_not_silently_renamed_for_fixtures() {
    let store = Store::open_in_memory().unwrap();
    store
        .conn
        .execute("INSERT INTO accounts(name,account_type) VALUES('IRA','investment')", [])
        .unwrap();
    assert!(
        store
            .conn
            .execute("INSERT INTO accounts(name,account_type) VALUES('IRA','investment')", [])
            .is_err()
    );
}
#[test]
fn retirement_history_rounds_the_exact_fraction_once_not_a_rounded_decimal_quotient() {
    let mut f = fixtures().into_iter().find(|f| f["id"] == "history-three-months").unwrap();
    f["seed"]["accounts"][0]["transactions"] = json!([{"date":"2026-04-01","amount":"6.0299999999999999999999999997"}]);
    let s = seed(&f);
    let got = serde_json::to_value(s.retirement_context(5, "2026-10-17".parse().unwrap()).unwrap()).unwrap();
    assert_eq!(got["contribution"]["monthlyAmount"], "1");
}
#[test]
fn retirement_native_overflow_and_unrepresentable_holdings_refuse_without_panics_or_silent_zero() {
    let mut f = fixtures().into_iter().find(|f| f["id"] == "history-three-months").unwrap();
    f["seed"]["accounts"][0]["transactions"] =
        json!([{"date":"2026-09-01","amount":"79228162514264337593543950335"},{"date":"2026-09-02","amount":"1"}]);
    let s = seed(&f);
    let got = std::panic::catch_unwind(std::panic::AssertUnwindSafe(|| s.retirement_context(5, "2026-10-17".parse().unwrap())));
    assert!(got.is_ok(), "overflow must not panic");
    assert!(got.unwrap().is_err());
    f["seed"]["accounts"][0]["transactions"] = json!([]);
    f["seed"]["accounts"][0]["holdings"] = json!([{"shares":"0.0000000000000000000000000001","price":"0.1"}]);
    let s = seed(&f);
    assert!(
        s.retirement_context(5, "2026-10-17".parse().unwrap()).is_err(),
        "a nonzero holding outside native scale cannot silently become recorded zero"
    );
}

#[test]
fn retirement_saved_zero_and_holdings_do_not_read_or_fail_on_an_unused_history_total() {
    let mut f = fixtures().into_iter().find(|f| f["id"] == "full-saved-plan-holdings").unwrap();
    f["seed"]["accounts"][0]["transactions"] =
        json!([{"date":"2026-09-01","amount":"79228162514264337593543950335"},{"date":"2026-09-02","amount":"1"}]);
    f["seed"]["plans"][0]["monthly"] = json!("0");
    let s = seed(&f);
    let got = serde_json::to_value(s.retirement_context(5, "2026-10-17".parse().unwrap()).unwrap()).unwrap();
    assert_eq!(got["contribution"], json!({"kind":"saved","monthlyAmount":"0"}));
    assert_eq!(got["worth"]["basis"], "holdings");
}

#[test]
fn retirement_saved_month_beyond_the_supported_range_is_returned_exactly_as_saved_evidence() {
    // The saved month is evidence about the plan, not a confirmed date: the reader neither clamps it, nulls it nor refuses the read.
    for saved in ["2101-01", "2200-12"] {
        let mut f = fixtures().into_iter().find(|f| f["id"] == "full-saved-plan-holdings").unwrap();
        f["seed"]["plans"][0]["withdrawMonth"] = json!(saved);
        let s = seed(&f);
        let got = serde_json::to_value(s.retirement_context(5, "2026-10-17".parse().unwrap()).unwrap()).unwrap();
        assert_eq!(got["retirementMonth"], saved);
        assert_eq!(got["worth"]["basis"], "holdings", "the rest of the account still reads");
    }
}

#[test]
fn retirement_unrepresentable_signed_product_never_panics_on_minimum_integer() {
    let mut f = fixtures().into_iter().find(|f| f["id"] == "full-saved-plan-holdings").unwrap();
    f["seed"]["accounts"][0]["holdings"] = json!([{"shares":"-39614081257132168796771975168","price":"4294967296"}]);
    let s = seed(&f);
    let got = std::panic::catch_unwind(std::panic::AssertUnwindSafe(|| s.retirement_context(5, "2026-10-17".parse().unwrap())));
    assert!(got.is_ok(), "minimum intermediate integer must not panic");
    assert!(got.unwrap().is_err());
}

#[test]
fn retirement_snapshot_is_coherent_across_an_external_settings_write_and_then_retires() {
    let path = std::env::temp_dir().join(format!(
        "vaultspend-m5-snapshot-{}-{}.db",
        std::process::id(),
        std::time::SystemTime::now().duration_since(std::time::UNIX_EPOCH).unwrap().as_nanos()
    ));
    struct Cleanup(std::path::PathBuf);
    impl Drop for Cleanup {
        fn drop(&mut self) {
            let _ = std::fs::remove_file(&self.0);
        }
    }
    let _cleanup = Cleanup(path.clone());
    let s = Store::open(&path).unwrap();
    s.conn.execute_batch("PRAGMA journal_mode=WAL").unwrap();
    let id = s.get_or_create_account("Snapshot IRA", AccountType::Investment).unwrap();
    let writer = Store::open(&path).unwrap();
    writer.conn.busy_timeout(std::time::Duration::from_millis(100)).unwrap();
    let today = "2026-10-17".parse().unwrap();
    let before = s.read_revision().unwrap();
    s.read_snapshot(|read| {
        let first = serde_json::to_value(read.retirement_context(id, today).unwrap()).unwrap();
        writer.set_inflation_pct(Decimal::from(9)).unwrap();
        let again = serde_json::to_value(read.retirement_context(id, today).unwrap()).unwrap();
        assert_eq!(first, again, "one snapshot must not mix old and new settings");
        Ok(())
    })
    .unwrap();
    let after = s.read_revision().unwrap();
    assert_ne!(before, after, "external commit must retire the old source");
    let current = serde_json::to_value(s.retirement_context(id, today).unwrap()).unwrap();
    assert_eq!(current["inflation"]["pct"], "9");
}

#[test]
fn retirement_real_linked_transfer_is_counted_once_and_withdrawal_not_as_contribution() {
    let s = Store::open_in_memory().unwrap();
    let ira = s.get_or_create_account("Linked IRA", AccountType::Investment).unwrap();
    let checking = s.get_or_create_account("Checking", AccountType::Checking).unwrap();
    s.conn
        .execute(
            "INSERT INTO transactions(account_id,date,description,amount,fingerprint) VALUES(?1,'2026-09-01','out','-150','out')",
            params![checking],
        )
        .unwrap();
    let out = s.conn.last_insert_rowid();
    s.conn
        .execute(
            "INSERT INTO transactions(account_id,date,description,amount,fingerprint) VALUES(?1,'2026-09-01','in','150','in')",
            params![ira],
        )
        .unwrap();
    let incoming = s.conn.last_insert_rowid();
    s.conn
        .execute(
            "INSERT INTO transfer_links(out_transaction_id,in_transaction_id) VALUES(?1,?2)",
            params![out, incoming],
        )
        .unwrap();
    s.conn
        .execute(
            "INSERT INTO transactions(account_id,date,description,amount,fingerprint) VALUES(?1,'2026-09-02','withdrawal','-20','withdrawal')",
            params![ira],
        )
        .unwrap();
    let got = serde_json::to_value(s.retirement_context(ira, "2026-10-17".parse().unwrap()).unwrap()).unwrap();
    assert_eq!(got["worth"], json!({"amount":"130","basis":"transactions"}));
    assert_eq!(
        got["contribution"],
        json!({"kind":"history","monthlyAmount":"150","fromMonth":"2026-09","toMonth":"2026-09","monthCount":1})
    );
    assert_eq!(got["account"]["id"], ira);
    assert!(!got.to_string().contains("Checking"));
}

#[test]
fn retirement_history_does_not_aggregate_money_outside_its_six_complete_months() {
    for other_date in ["2020-01-01", "2026-10-01"] {
        let mut f = fixtures()
            .into_iter()
            .find(|f| f["id"] == "holdings-replace-transaction-balance")
            .unwrap();
        f["seed"]["accounts"][0]["transactions"] = json!([{"date":"2020-01-01","amount":"0.01"},{"date":"2026-09-01","amount":"1"},{"date":other_date,"amount":"79228162514264337593543950335"}]);
        let s = seed(&f);
        let got = serde_json::to_value(s.retirement_context(5, "2026-10-17".parse().unwrap()).unwrap()).unwrap();
        assert_eq!(
            got["contribution"],
            json!({"kind":"history","monthlyAmount":"0.17","fromMonth":"2026-04","toMonth":"2026-09","monthCount":6}),
            "{other_date}"
        );
    }
}

#[test]
fn retirement_native_holding_product_uses_the_full_decimal_range_not_an_intermediate_integer_cap() {
    let mut f = fixtures().into_iter().find(|f| f["id"] == "full-saved-plan-holdings").unwrap();
    f["seed"]["accounts"][0]["holdings"] = json!([{"shares":"3.9614081257132168796771975168","price":"0.9094947017729282379150390625"}]);
    let s = seed(&f);
    let got = serde_json::to_value(s.retirement_context(5, "2026-10-17".parse().unwrap()).unwrap()).unwrap();
    assert_eq!(got["worth"], json!({"amount":"3.6028797018963968","basis":"holdings"}));
}

#[test]
fn retirement_native_visually_identical_unicode_names_preserve_unique_ids_and_exact_labels() {
    // Owner approved this native counterpart on 18 October: exact duplicate names remain protocol/parser-only.
    // The unchanged SQLite NOCASE uniqueness constraint permits distinct Unicode representations.
    let s = Store::open_in_memory().unwrap();
    let composed = "Rothé IRA";
    let decomposed = "Rothe\u{301} IRA";
    let first = s.get_or_create_account(composed, AccountType::Investment).unwrap();
    let second = s.get_or_create_account(decomposed, AccountType::Investment).unwrap();
    assert_ne!(first, second);
    let day = "2026-10-17".parse().unwrap();
    let roster = serde_json::to_value(s.retirement_accounts(day).unwrap()).unwrap();
    assert_eq!(roster, json!([{"id":second,"name":decomposed},{"id":first,"name":composed}]));
    for (id, name) in [(first, composed), (second, decomposed)] {
        let got = serde_json::to_value(s.retirement_context(id, day).unwrap()).unwrap();
        assert_eq!(got["account"], json!({"id":id,"name":name,"type":"investment"}));
    }
}
