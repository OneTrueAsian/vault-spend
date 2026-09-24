//! A small, typed per-profile key/value table for settings that used to live in the frontend's
//! global `localStorage` (shared across every profile, plaintext) — plan v2 §4.12. Deliberately
//! bounded to a fixed set of known keys, not a general store, so it cannot become a second dumping
//! ground the same way `localStorage` did. A submodule of `store` (like `encryption`) rather than a
//! top-level module, because it needs `Store`'s private `conn` field.
use super::Store;
use rusqlite::OptionalExtension;

#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub enum UiStateKey {
    SavedFilters,
    SafeToSpendBuffer,
    NotifiedBills,
    CategoryOrder,
    ShowBillNamesInReminders,
}

impl UiStateKey {
    pub fn as_str(self) -> &'static str {
        match self {
            UiStateKey::SavedFilters => "saved_filters",
            UiStateKey::SafeToSpendBuffer => "safe_to_spend_buffer",
            UiStateKey::NotifiedBills => "notified_bills",
            UiStateKey::CategoryOrder => "category_order",
            UiStateKey::ShowBillNamesInReminders => "show_bill_names_in_reminders",
        }
    }

    pub fn parse(s: &str) -> Option<UiStateKey> {
        match s {
            "saved_filters" => Some(UiStateKey::SavedFilters),
            "safe_to_spend_buffer" => Some(UiStateKey::SafeToSpendBuffer),
            "notified_bills" => Some(UiStateKey::NotifiedBills),
            "category_order" => Some(UiStateKey::CategoryOrder),
            "show_bill_names_in_reminders" => Some(UiStateKey::ShowBillNamesInReminders),
            _ => None,
        }
    }
}

impl Store {
    pub fn get_ui_state(&self, key: UiStateKey) -> rusqlite::Result<Option<String>> {
        self.conn
            .query_row("SELECT value FROM profile_ui_state WHERE key = ?1", [key.as_str()], |row| row.get(0))
            .optional()
    }

    pub fn set_ui_state(&self, key: UiStateKey, value: &str) -> rusqlite::Result<()> {
        self.conn.execute(
            "INSERT INTO profile_ui_state (key, value) VALUES (?1, ?2) ON CONFLICT(key) DO UPDATE SET value = excluded.value",
            rusqlite::params![key.as_str(), value],
        )?;
        Ok(())
    }

    /// Whether an unlocked protected profile's background/launch reminders should name the bill
    /// and amount, rather than the generic "A bill is due soon." (decision 9) — off by default, and
    /// harmless/inert for an unprotected profile (its reminders always show the real wording,
    /// regardless of this setting — see `background::check_reminders`).
    pub fn show_bill_names_in_reminders(&self) -> rusqlite::Result<bool> {
        Ok(self.get_ui_state(UiStateKey::ShowBillNamesInReminders)?.as_deref() == Some("true"))
    }

    pub fn set_show_bill_names_in_reminders(&self, value: bool) -> rusqlite::Result<()> {
        self.set_ui_state(UiStateKey::ShowBillNamesInReminders, if value { "true" } else { "false" })
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    fn temp_store(name: &str) -> Store {
        let dir = std::env::temp_dir().join(format!("vaultspend-ui-state-test-{name}-{}", std::process::id()));
        let _ = std::fs::remove_dir_all(&dir);
        std::fs::create_dir_all(&dir).unwrap();
        Store::open(dir.join("test.db")).unwrap()
    }

    #[test]
    fn an_unset_key_reads_as_none() {
        let store = temp_store("unset");

        assert_eq!(store.get_ui_state(UiStateKey::SavedFilters).unwrap(), None);
    }

    #[test]
    fn setting_a_key_and_reading_it_back_round_trips() {
        let store = temp_store("roundtrip");

        store.set_ui_state(UiStateKey::CategoryOrder, "[\"Groceries\",\"Rent\"]").unwrap();

        assert_eq!(store.get_ui_state(UiStateKey::CategoryOrder).unwrap(), Some("[\"Groceries\",\"Rent\"]".to_string()));
    }

    #[test]
    fn setting_a_key_twice_replaces_it_rather_than_erroring_or_duplicating() {
        let store = temp_store("replace");
        store.set_ui_state(UiStateKey::NotifiedBills, "{}").unwrap();

        store.set_ui_state(UiStateKey::NotifiedBills, "{\"12\":true}").unwrap();

        assert_eq!(store.get_ui_state(UiStateKey::NotifiedBills).unwrap(), Some("{\"12\":true}".to_string()));
    }

    #[test]
    fn the_four_keys_are_independent() {
        let store = temp_store("independent");
        store.set_ui_state(UiStateKey::SavedFilters, "filters").unwrap();

        assert_eq!(store.get_ui_state(UiStateKey::SafeToSpendBuffer).unwrap(), None);
    }

    #[test]
    fn parse_accepts_exactly_the_five_known_keys() {
        assert_eq!(UiStateKey::parse("saved_filters"), Some(UiStateKey::SavedFilters));
        assert_eq!(UiStateKey::parse("safe_to_spend_buffer"), Some(UiStateKey::SafeToSpendBuffer));
        assert_eq!(UiStateKey::parse("notified_bills"), Some(UiStateKey::NotifiedBills));
        assert_eq!(UiStateKey::parse("category_order"), Some(UiStateKey::CategoryOrder));
        assert_eq!(UiStateKey::parse("show_bill_names_in_reminders"), Some(UiStateKey::ShowBillNamesInReminders));
        assert_eq!(UiStateKey::parse("anything_else"), None, "not an arbitrary-key store");
    }

    #[test]
    fn show_bill_names_in_reminders_defaults_to_off() {
        let store = temp_store("default-off");

        assert!(!store.show_bill_names_in_reminders().unwrap());
    }

    #[test]
    fn show_bill_names_in_reminders_round_trips() {
        let store = temp_store("round-trip");

        store.set_show_bill_names_in_reminders(true).unwrap();

        assert!(store.show_bill_names_in_reminders().unwrap());
    }
}
