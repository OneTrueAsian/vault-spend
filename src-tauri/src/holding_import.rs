//! Short-lived, profile-bound holding previews. No source data is saved to disk.
use budget_core::holding_import::{HoldingInput, ImportRow, Source, MAX_ROWS};
use std::{
    collections::HashMap,
    sync::Mutex,
    time::{Duration, Instant},
};

pub struct Session {
    pub generation: u64,
    pub created: Instant,
    pub source: Source,
    pub account_id: Option<i64>,
    pub rows: Vec<ImportRow>,
}

impl Session {
    pub fn selected_holdings(&self, selected_rows: &[usize]) -> Result<(i64, Vec<HoldingInput>), String> {
        let account_id = self.account_id.ok_or("Review the mapped rows before adding them.")?;
        let selected = selected_rows.iter().collect::<std::collections::HashSet<_>>();
        if selected.is_empty() || selected.len() != selected_rows.len() || selected.len() > MAX_ROWS {
            return Err("Select each valid row only once.".into());
        }
        let rows = self.rows.iter().map(|r| (r.row_number, r)).collect::<HashMap<_, _>>();
        let holdings = selected_rows
            .iter()
            .map(|number| {
                let row = rows.get(number).ok_or("A selected row is not in this preview.")?;
                if row.already_exists || row.error.is_some() {
                    return Err("A selected row is invalid or already exists. Review the rows again.".into());
                }
                row.holding.clone().ok_or_else(|| "A selected row is invalid.".into())
            })
            .collect::<Result<Vec<_>, String>>()?;
        Ok((account_id, holdings))
    }
}

#[derive(Default)]
pub struct Sessions(pub Mutex<HashMap<String, Session>>);

impl Sessions {
    pub fn prune(cache: &mut HashMap<String, Session>, generation: u64) {
        cache.retain(|_, s| s.generation == generation && s.created.elapsed() < Duration::from_secs(900));
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    fn reviewed_session() -> Session {
        let source = budget_core::holding_import::parse_source("S,Q,P,C\nA,0.125,100.10,5\nB,-1,10,5\nC,1,10,5\n", "csv").unwrap();
        let mut rows = budget_core::holding_import::map_rows(
            &source,
            &budget_core::holding_import::Mapping {
                symbol: 0,
                shares: 1,
                price: 2,
                cost_basis: 3,
                name: None,
                asset_class: None,
            },
        )
        .unwrap();
        rows[2].already_exists = true;
        Session {
            generation: 1,
            created: Instant::now(),
            source,
            account_id: Some(9),
            rows,
        }
    }
    #[test]
    fn selection_uses_cached_values_and_preserves_order() {
        let session = reviewed_session();
        let (account, rows) = session.selected_holdings(&[2]).unwrap();
        assert_eq!(account, 9);
        assert_eq!(rows[0].price, "100.10");
        assert_eq!(rows[0].shares, "0.125");
    }
    #[test]
    fn unreviewed_invalid_existing_unknown_and_repeated_row_ids_are_refused() {
        let mut session = reviewed_session();
        for selected in [&[][..], &[2, 2], &[3], &[4], &[99]] {
            assert!(session.selected_holdings(selected).is_err());
        }
        session.account_id = None;
        assert!(session.selected_holdings(&[2]).is_err());
    }
    #[test]
    fn stale_profiles_and_expired_previews_are_removed() {
        let source = budget_core::holding_import::parse_source("S,Q,P,C\nA,1,10,5\n", "csv").unwrap();
        let mut cache = HashMap::new();
        for (key, generation, created) in [
            ("active", 2, Instant::now()),
            ("old-profile", 1, Instant::now()),
            ("expired", 2, Instant::now() - Duration::from_secs(901)),
        ] {
            cache.insert(
                key.into(),
                Session {
                    generation,
                    created,
                    source: source.clone(),
                    account_id: None,
                    rows: vec![],
                },
            );
        }
        Sessions::prune(&mut cache, 2);
        assert_eq!(cache.len(), 1);
        assert!(cache.contains_key("active"));
    }
}
