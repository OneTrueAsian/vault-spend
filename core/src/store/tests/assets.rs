use super::*;

#[test]
fn delete_family_member_nulls_member_id_on_the_assets_it_owns() {
    let store = Store::open_in_memory().unwrap();
    let member = store.create_family_member("Alex").unwrap();
    let asset_id = store
        .create_asset("House", "Real Estate", "300000.00".parse().unwrap(), "2026-08-01".parse().unwrap(), None)
        .unwrap();
    store.set_asset_member(asset_id, Some(member)).unwrap();

    store.delete_family_member(member).unwrap();

    assert_eq!(store.list_assets().unwrap()[0].member_id, None);
}

#[test]
fn set_asset_member_assigns_and_clears_a_member() {
    let store = Store::open_in_memory().unwrap();
    let member = store.create_family_member("Alex").unwrap();
    let asset_id = store
        .create_asset("House", "Real Estate", "300000.00".parse().unwrap(), "2026-08-01".parse().unwrap(), None)
        .unwrap();

    store.set_asset_member(asset_id, Some(member)).unwrap();
    assert_eq!(store.list_assets().unwrap()[0].member_id, Some(member));

    store.set_asset_member(asset_id, None).unwrap();
    assert_eq!(store.list_assets().unwrap()[0].member_id, None);
}

#[test]
fn list_assets_includes_its_members_name() {
    let store = Store::open_in_memory().unwrap();
    let member = store.create_family_member("Alex").unwrap();
    let asset_id = store
        .create_asset("House", "Real Estate", "300000.00".parse().unwrap(), "2026-08-01".parse().unwrap(), None)
        .unwrap();
    store.set_asset_member(asset_id, Some(member)).unwrap();

    let assets = store.list_assets().unwrap();

    assert_eq!(assets[0].member_name, Some("Alex".to_string()));
}

#[test]
fn create_asset_then_list_assets_reads_it_back() {
    let store = Store::open_in_memory().unwrap();
    let id = store
        .create_asset(
            "Home",
            "real_estate",
            "350000.00".parse().unwrap(),
            "2026-08-01".parse().unwrap(),
            Some("Zillow estimate"),
        )
        .unwrap();

    let assets = store.list_assets().unwrap();

    assert_eq!(assets.len(), 1);
    assert_eq!(assets[0].id, id);
    assert_eq!(assets[0].name, "Home");
    assert_eq!(assets[0].asset_type, "real_estate");
    assert_eq!(assets[0].value, "350000.00".parse().unwrap());
    assert_eq!(assets[0].valued_on, "2026-08-01".parse().unwrap());
    assert_eq!(assets[0].notes.as_deref(), Some("Zillow estimate"));
}

#[test]
fn update_asset_value_changes_value_and_valued_on() {
    let store = Store::open_in_memory().unwrap();
    let id = store
        .create_asset("Car", "vehicle", "20000.00".parse().unwrap(), "2026-01-01".parse().unwrap(), None)
        .unwrap();

    store
        .update_asset_value(id, "17000.00".parse().unwrap(), "2026-08-01".parse().unwrap())
        .unwrap();

    let assets = store.list_assets().unwrap();
    assert_eq!(assets[0].value, "17000.00".parse().unwrap());
    assert_eq!(assets[0].valued_on, "2026-08-01".parse().unwrap());
}

#[test]
fn delete_asset_removes_it() {
    let store = Store::open_in_memory().unwrap();
    let id = store
        .create_asset("Boat", "other", "5000.00".parse().unwrap(), "2026-01-01".parse().unwrap(), None)
        .unwrap();

    store.delete_asset(id).unwrap();

    assert_eq!(store.list_assets().unwrap().len(), 0);
}

#[test]
fn delete_asset_on_an_unknown_id_is_a_harmless_no_op() {
    let store = Store::open_in_memory().unwrap();
    store.delete_asset(999).unwrap();
}

#[test]
fn total_assets_value_sums_every_asset() {
    let store = Store::open_in_memory().unwrap();
    store
        .create_asset("Home", "real_estate", "350000.00".parse().unwrap(), "2026-08-01".parse().unwrap(), None)
        .unwrap();
    store
        .create_asset("Car", "vehicle", "17000.00".parse().unwrap(), "2026-08-01".parse().unwrap(), None)
        .unwrap();

    assert_eq!(store.total_assets_value().unwrap(), "367000.00".parse().unwrap());
}

#[test]
fn total_assets_value_is_zero_with_no_assets() {
    let store = Store::open_in_memory().unwrap();
    assert_eq!(store.total_assets_value().unwrap(), Decimal::ZERO);
}
