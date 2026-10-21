//! M6 distinct semantic/reference checks. Golds are prepared by the attributed,
//! test-only independent oracle; this test never computes its expected totals.
//! Each full request/ledger pair is checked once, not once per wording.
use super::*;
use crate::models::{AccountType, Transaction};
use crate::store::{AskAlignment, AskAverageKind, AskGroupBy, AskSpendFilter, AskSpendResult, AskSpendThreshold, ask_comparison};
use serde_json::{Value, json};

fn texts(v: &Value) -> Vec<String> {
    v.as_array()
        .expect("array")
        .iter()
        .map(|v| v.as_str().expect("string").to_owned())
        .collect()
}
fn numbers(v: &Value) -> Vec<i64> {
    v.as_array().expect("array").iter().map(|v| v.as_i64().expect("id")).collect()
}
fn money(v: Decimal) -> String {
    format!("{v:.2}")
}
fn build(world: &Value) -> Store {
    let store = Store::open_in_memory().unwrap();
    for m in world["members"].as_array().unwrap() {
        assert_eq!(
            store.create_family_member(m["name"].as_str().unwrap()).unwrap(),
            m["id"].as_i64().unwrap()
        );
    }
    for a in world["accounts"].as_array().unwrap() {
        assert_eq!(
            store.create_account(a["name"].as_str().unwrap(), AccountType::Checking).unwrap().unwrap(),
            a["id"].as_i64().unwrap()
        );
    }
    for c in world["categories"].as_array().unwrap() {
        store.create_category(c.as_str().unwrap(), None).unwrap();
    }
    for t in world["ledger"].as_array().unwrap() {
        let id = store
            .create_transaction(
                t["accountId"].as_i64().unwrap(),
                &Transaction {
                    date: day(t["date"].as_str().unwrap()),
                    description: t["description"].as_str().unwrap().to_owned(),
                    amount: Decimal::new(t["cents"].as_i64().unwrap(), 2),
                    category: t["category"].as_str().map(str::to_owned),
                },
                None,
            )
            .unwrap();
        assert_eq!(id, t["id"].as_i64().unwrap());
        store.set_transaction_member(id, t["memberId"].as_i64()).unwrap();
        if let Some(splits) = t["splits"].as_array() {
            let lines: Vec<_> = splits
                .iter()
                .map(|s| {
                    (
                        s["category"].as_str().unwrap().to_owned(),
                        Decimal::new(s["cents"].as_i64().unwrap(), 2),
                        None,
                    )
                })
                .collect();
            store.set_transaction_splits(id, &lines).unwrap();
        }
    }
    store
}
fn group(request: &Value) -> AskGroupBy {
    match request["groupBy"].as_str().unwrap_or("none") {
        "none" => AskGroupBy::None,
        "month" => AskGroupBy::Month,
        "member" => AskGroupBy::Member,
        _ => panic!("invalid group"),
    }
}
fn average(request: &Value) -> AskAverageKind {
    match request["average"].as_str().unwrap_or("none") {
        "none" => AskAverageKind::None,
        "per-month" => AskAverageKind::PerMonth,
        "per-purchase" => AskAverageKind::PerPurchase,
        _ => panic!("invalid average"),
    }
}
fn filter(request: &Value, period: &Value, today: &str) -> AskSpendFilter {
    AskSpendFilter {
        from: day(period["from"].as_str().unwrap()),
        to: day(period["to"].as_str().unwrap()),
        as_of: day(today),
        account_ids: numbers(&request["accountIds"]),
        categories: texts(&request["categories"]),
        vendors: texts(&request["vendors"]),
        exclude_vendors: texts(&request["excludeVendors"]),
        exclude_categories: texts(&request["excludeCategories"]),
        minimum_purchase: request["minimumPurchase"].as_object().map(|t| AskSpendThreshold {
            amount: dec(t["amount"].as_str().unwrap()),
            inclusive: t["inclusive"].as_bool().unwrap(),
        }),
        limit: request["limit"].as_u64().unwrap() as usize,
        member_ids: request["members"]["ids"]
            .as_array()
            .map(|_| numbers(&request["members"]["ids"]))
            .unwrap_or_default(),
        include_unassigned: request["members"]["unassigned"].as_bool().unwrap_or(false),
        group_by: group(request),
        average: average(request),
    }
}
fn period_value(g: &AskSpendResult, request: &Value, p: &Value, today: &str) -> Value {
    let ranking_categories = request["kind"] == "rank-categories";
    let ranking_purchases = request["kind"] == "rank-purchases";
    let mut value = json!({"from":p["from"],"to":p["to"],
        "dayCount":(day(p["to"].as_str().unwrap())-day(p["from"].as_str().unwrap())).num_days()+1,
        "endsToday":p["to"]==today,"historyCoverage":"unknown", "total":money(g.total),"purchaseCount":g.purchase_count,"categoryCount":g.category_count,
        "categories":if ranking_categories {g.categories.iter().map(|c|json!({"category":c.category,"amount":money(c.amount),"purchaseCount":c.purchase_count})).collect::<Vec<_>>()} else {vec![]},
        "purchases":if ranking_purchases {g.purchases.iter().map(|t|json!({"transactionId":t.transaction_id,"accountId":t.account_id,"date":t.date,"description":t.description,"amount":money(t.amount),"parentAmount":money(t.parent_amount)})).collect::<Vec<_>>()} else {vec![]},
        "vendors":g.vendors.iter().map(|v|json!({"description":v.description,"purchaseCount":v.purchase_count})).collect::<Vec<_>>(),
        "vendorNameCount":g.vendor_name_count,
        "vendorTotals":g.vendor_totals.iter().map(|v|json!({"term":v.term,"total":money(v.total),"purchaseCount":v.purchase_count})).collect::<Vec<_>>(),
        "leftOut":{"total":money(g.left_out.total),"purchaseCount":g.left_out.purchase_count,
            "vendors":g.left_out.vendors.iter().map(|v|json!({"description":v.description,"purchaseCount":v.purchase_count})).collect::<Vec<_>>(),
            "categories":g.left_out.categories.iter().map(|c|json!({"category":c.category,"amount":money(c.amount),"purchaseCount":c.purchase_count})).collect::<Vec<_>>()}
    });
    if request["contractVersion"] == 2 {
        let o = value.as_object_mut().unwrap();
        o.insert("recordedFrom".into(), json!(g.recorded_from.map(|d| d.to_string())));
        o.insert("recordedThrough".into(), json!(g.recorded_through.map(|d| d.to_string())));
        o.insert("sharedPurchaseCount".into(), json!(g.shared_purchase_count));
        o.insert(
            "categoryTotals".into(),
            json!(
                g.category_totals
                    .iter()
                    .map(|c| json!({"category":c.category,"total":money(c.total),"purchaseCount":c.purchase_count}))
                    .collect::<Vec<_>>()
            ),
        );
        o.insert(
            "memberTotals".into(),
            json!(
                g.member_totals
                    .iter()
                    .map(|m| json!({"memberId":m.member_id,"name":m.name,"total":money(m.total),"purchaseCount":m.purchase_count}))
                    .collect::<Vec<_>>()
            ),
        );
        o.insert("months".into(),json!(g.months.iter().map(|m|json!({"month":m.month,"from":m.from.to_string(),"to":m.to.to_string(),"dayCount":m.day_count,"coverage":m.coverage.as_str(),"recordCount":m.record_count,"total":money(m.total),"purchaseCount":m.purchase_count})).collect::<Vec<_>>()));
        o.insert("average".into(),g.average.as_ref().map(|a|json!({"basis":request["average"],"numerator":money(a.numerator),"denominator":a.denominator,"value":a.value.map(money),"unavailable":a.unavailable,"monthsUsed":a.months_used,"monthsLeftOut":a.months_left_out.iter().map(|(m,why)|json!({"month":m,"why":why.as_str()})).collect::<Vec<_>>()})).unwrap_or(Value::Null));
    }
    value
}

#[test]
fn ask_vault_m6_frozen_reference_worlds() {
    let contexts: Value = serde_json::from_str(include_str!("../../../../src/testSupport/askVaultM6/contexts.json")).unwrap();
    let requests: Value = serde_json::from_str(include_str!("../../../../src/testSupport/askVaultM6/expectedRequests.json")).unwrap();
    let references: Value = serde_json::from_str(include_str!("../../../../src/testSupport/askVaultM6/referenceResults.json")).unwrap();
    let mut checked = Vec::new();
    for (world_id, world) in contexts["worlds"].as_object().unwrap() {
        let store = build(world);
        let before = store.read_revision().unwrap();
        let today = world["today"].as_str().unwrap();
        for (reference_id, reference) in references.as_object().unwrap() {
            // Hand-worked scenario anchors (M3/M4/M5) have no ordinary-spending native request; they are not native evidence.
            if reference.get("evidenceKind").is_some() {
                continue;
            }
            let context = &contexts["contexts"][reference["contextId"].as_str().unwrap()];
            if context["worldId"] != world_id.as_str() {
                continue;
            }
            let q = &requests[reference["requestId"].as_str().unwrap()];
            let periods = q["periods"].as_array().unwrap();
            let results: Vec<_> = periods
                .iter()
                .map(|p| store.ask_spending(&filter(q, p, today)).expect("frozen supported native request"))
                .collect();
            let mut value = json!({"contractVersion":q["contractVersion"].as_u64().unwrap_or(1),"asOf":today,"kind":q["kind"],"spendingBasis":"gross-negative-allocations","thresholdBasis":"absolute-parent-amount",
                "periods":results.iter().zip(periods).map(|(g,p)|period_value(g,q,p,today)).collect::<Vec<_>>(),
                "difference":if q["kind"]=="compare"{json!(money(results[0].total-results[1].total))}else{Value::Null}});
            if q["contractVersion"] == 2 {
                let o = value.as_object_mut().unwrap();
                o.insert("earliestRecord".into(), json!(results[0].earliest_record.map(|d| d.to_string())));
                let comparison = if q["kind"] == "compare" {
                    let align = match q["alignment"].as_str().unwrap() {
                        "as-requested" => AskAlignment::AsRequested,
                        "same-days-previous-month" => AskAlignment::SameDaysPreviousMonth,
                        "same-days-previous-year" => AskAlignment::SameDaysPreviousYear,
                        _ => panic!("alignment"),
                    };
                    let a = &periods[0];
                    let b = &periods[1];
                    let c = ask_comparison(
                        align,
                        (day(a["from"].as_str().unwrap()), day(a["to"].as_str().unwrap())),
                        (day(b["from"].as_str().unwrap()), day(b["to"].as_str().unwrap())),
                        results[0].total,
                        results[1].total,
                    )
                    .unwrap();
                    json!({"alignment":q["alignment"],"comparable":c.comparable,"notComparableReason":c.not_comparable_reason,"elapsedDays":c.elapsed_days,"clamped":c.clamped.map(|(requested,used)|json!({"requestedDays":requested,"usedDays":used})),"absoluteChange":money(c.absolute_change),"percentChange":c.percent_change.map(|v|format!("{v:.1}")),"percentOutcome":c.percent_outcome})
                } else {
                    Value::Null
                };
                o.insert("comparison".into(), comparison);
            }
            assert_eq!(
                value, reference["value"],
                "native/reference disagreement: {reference_id}, world {world_id}, request {}",
                reference["requestId"]
            );
            checked.push(reference_id.clone());
        }
        assert_eq!(before, store.read_revision().unwrap(), "all reference reads are read-only");
    }
    let ordinary = references
        .as_object()
        .unwrap()
        .values()
        .filter(|r| r.get("evidenceKind").is_none())
        .count();
    assert_eq!(checked.len(), ordinary);
    assert!(!checked.is_empty());
    if let Ok(output) = std::env::var("VAULTSPEND_M6_NATIVE_PROOF") {
        std::fs::write(
            output,
            serde_json::to_vec_pretty(&json!({"test":"ask_vault_m6_frozen_reference_worlds","checked":checked,"failures":0})).unwrap(),
        )
        .unwrap();
    }
}


// ---- Owner decision Q5 (21 October 2026): native prerequisites for the scenario families. This is a SEPARATE test: the original proof of
// ask_vault_m6_frozen_reference_worlds (3,291 ordinary references) is not rewritten. It validates NATIVE CONTEXT only (what the store reads); it does not
// validate any JavaScript projection, review, consent or calculation. Expected values are prepared by the independent TypeScript oracle (spending reads) or worked by
// hand (retirement contexts); this test never computes them. It records the SHA-256 of every input file as consumed.
fn reference_value(store: &Store, q: &Value, today: &str) -> Value {
    let periods = q["periods"].as_array().unwrap();
    let results: Vec<_> = periods
        .iter()
        .map(|p| store.ask_spending(&filter(q, p, today)).expect("supported native request"))
        .collect();
    let mut value = json!({"contractVersion":q["contractVersion"].as_u64().unwrap_or(1),"asOf":today,"kind":q["kind"],"spendingBasis":"gross-negative-allocations","thresholdBasis":"absolute-parent-amount",
        "periods":results.iter().zip(periods).map(|(g,p)|period_value(g,q,p,today)).collect::<Vec<_>>(),
        "difference":if q["kind"]=="compare"{json!(money(results[0].total-results[1].total))}else{Value::Null}});
    if q["contractVersion"] == 2 {
        let o = value.as_object_mut().unwrap();
        o.insert("earliestRecord".into(), json!(results[0].earliest_record.map(|d| d.to_string())));
        let comparison = if q["kind"] == "compare" {
            let align = match q["alignment"].as_str().unwrap() {
                "as-requested" => AskAlignment::AsRequested,
                "same-days-previous-month" => AskAlignment::SameDaysPreviousMonth,
                "same-days-previous-year" => AskAlignment::SameDaysPreviousYear,
                _ => panic!("alignment"),
            };
            let a = &periods[0];
            let b = &periods[1];
            let c = ask_comparison(
                align,
                (day(a["from"].as_str().unwrap()), day(a["to"].as_str().unwrap())),
                (day(b["from"].as_str().unwrap()), day(b["to"].as_str().unwrap())),
                results[0].total,
                results[1].total,
            )
            .unwrap();
            json!({"alignment":q["alignment"],"comparable":c.comparable,"notComparableReason":c.not_comparable_reason,"elapsedDays":c.elapsed_days,"clamped":c.clamped.map(|(requested,used)|json!({"requestedDays":requested,"usedDays":used})),"absoluteChange":money(c.absolute_change),"percentChange":c.percent_change.map(|v|format!("{v:.1}")),"percentOutcome":c.percent_outcome})
        } else {
            Value::Null
        };
        o.insert("comparison".into(), comparison);
    }
    value
}
fn sha_hex(text: &str) -> String {
    use sha2::{Digest, Sha256};
    Sha256::digest(text.as_bytes()).iter().map(|b| format!("{b:02x}")).collect()
}
fn retirement_seed(f: &Value) -> Store {
    let store = Store::open_in_memory().unwrap();
    store.conn.execute("DELETE FROM app_settings", []).unwrap();
    for a in f["seed"]["accounts"].as_array().unwrap() {
        store
            .conn
            .execute(
                "INSERT INTO accounts(id,name,account_type,starting_balance) VALUES(?1,?2,?3,?4)",
                params![a["id"].as_i64().unwrap(), a["name"].as_str().unwrap(), a["type"].as_str().unwrap(), a["startingBalance"].as_str().unwrap()],
            )
            .unwrap();
        for t in a["transactions"].as_array().into_iter().flatten() {
            store
                .conn
                .execute(
                    "INSERT INTO transactions(account_id,date,description,amount,fingerprint,deleted_at) VALUES(?1,?2,'fixture',?3,'fixture',NULL)",
                    params![a["id"].as_i64().unwrap(), t["date"].as_str().unwrap(), t["amount"].as_str().unwrap()],
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
                params![p["accountId"].as_i64().unwrap(), p["monthly"].as_str(), p["returnPct"].as_str().unwrap(), date],
            )
            .unwrap();
    }
    if let Some(pct) = f["seed"]["inflationPct"].as_str() {
        store.conn.execute("INSERT INTO app_settings(id,inflation_pct) VALUES(1,?1)", params![pct]).unwrap();
    }
    store
}

#[test]
fn ask_vault_m6_scenario_prerequisites() {
    let inputs = [
        ("scenarioNativeFixtures.json", include_str!("../../../../src/testSupport/askVaultM6/scenarioNativeFixtures.json")),
        ("scenarioNativeRequests.json", include_str!("../../../../src/testSupport/askVaultM6/scenarioNativeRequests.json")),
        ("scenarioNativeReferences.json", include_str!("../../../../src/testSupport/askVaultM6/scenarioNativeReferences.json")),
        ("contexts.json", include_str!("../../../../src/testSupport/askVaultM6/contexts.json")),
        ("expectedRequests.json", include_str!("../../../../src/testSupport/askVaultM6/expectedRequests.json")),
        ("referenceResults.json", include_str!("../../../../src/testSupport/askVaultM6/referenceResults.json")),
    ];
    let get = |name: &str| -> Value { serde_json::from_str(inputs.iter().find(|(n, _)| *n == name).unwrap().1).unwrap() };
    let (fixtures, requests, references, contexts) = (get("scenarioNativeFixtures.json"), get("scenarioNativeRequests.json"), get("scenarioNativeReferences.json"), get("contexts.json"));
    let mut worlds: Vec<(String, Value)> = contexts["worlds"].as_object().unwrap().iter().map(|(k, v)| (k.clone(), v.clone())).collect();
    worlds.extend(fixtures["worlds"].as_object().unwrap().iter().map(|(k, v)| (k.clone(), v.clone())));
    let mut baseline = Vec::new();
    let mut boundary = Vec::new();
    for (world_id, world) in &worlds {
        let store = build(world);
        let before = store.read_revision().unwrap();
        let today = world["today"].as_str().unwrap();
        for (reference_id, reference) in references["references"].as_object().unwrap() {
            if reference["worldId"] != world_id.as_str() {
                continue;
            }
            let q = &requests[reference["requestId"].as_str().unwrap()];
            let value = reference_value(&store, q, today);
            assert_eq!(value, reference["value"], "native/oracle disagreement: {reference_id}, world {world_id}");
            if reference["kind"] == "baseline" {
                baseline.push(reference_id.clone());
            } else {
                boundary.push(reference_id.clone());
            }
        }
        assert_eq!(before, store.read_revision().unwrap(), "all reference reads are read-only");
    }
    let expected_baseline = contexts["worlds"].as_object().unwrap().values().map(|w| w["categories"].as_array().unwrap().len()).sum::<usize>();
    assert_eq!(baseline.len(), expected_baseline, "every category of every seed world has a native baseline-shaped read");
    assert_eq!(boundary.len(), 5);
    let mut retirement = Vec::new();
    for f in fixtures["retirement"].as_array().unwrap() {
        let store = retirement_seed(f);
        let before = store.read_revision().unwrap();
        let date = f["today"].as_str().unwrap().parse().unwrap();
        let got = store.retirement_context(f["accountId"].as_i64().unwrap(), date).expect("real investment account context");
        let e = &f["expected"]["reply"];
        let want = json!({"account":e["account"],"worth":e["worth"],"contribution":e["contribution"],"returnAssumption":e["returnAssumption"],"inflation":e["inflation"],"retirementMonth":e["retirementMonth"]});
        assert_eq!(serde_json::to_value(got).unwrap(), want, "{}", f["id"]);
        assert_eq!(before, store.read_revision().unwrap(), "a retirement context read writes nothing");
        retirement.push(f["id"].as_str().unwrap().to_owned());
    }
    assert_eq!(retirement.len(), fixtures["retirement"].as_array().unwrap().len());
    assert!(retirement.len() >= 15, "three example contexts plus twelve M5 corpus contexts (three seeds, four investment accounts)");
    if let Ok(output) = std::env::var("VAULTSPEND_M6_SCENARIO_PROOF") {
        let digests: serde_json::Map<String, Value> = inputs.iter().map(|(n, t)| (n.to_string(), json!(sha_hex(t)))).collect();
        std::fs::write(
            output,
            serde_json::to_vec_pretty(&json!({"test":"ask_vault_m6_scenario_prerequisites","failures":0,"proves":"native context validation: what the store reads (spending reads and retirement-account contexts)",
                "doesNotProve":"any JavaScript projection, review, consent or calculation","inputDigests":digests,"baseline":baseline,"thresholdBoundary":boundary,"retirementContexts":retirement})).unwrap(),
        )
        .unwrap();
    }
}
