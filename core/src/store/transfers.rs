//! Transfers: linking the two legs of a move between accounts, finding candidates, and automatic linking.

use super::Store;
use chrono::NaiveDate;
use rusqlite::params;
use rust_decimal::Decimal;
use std::str::FromStr;

/// Two unlinked transactions that look like the two legs of one transfer —
/// see `Store::transfer_candidates`.
#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub struct TransferCandidate {
    /// The outgoing leg (negative amount).
    pub out_id: i64,
    /// The incoming leg (positive amount).
    pub in_id: i64,
}

impl Store {
    /// Links two transactions as the two legs of one transfer between the
    /// user's own accounts, so neither counts as income or spending (see
    /// `LIVE_TRANSFER_LEG_IDS_SQL`). The ids can come in either order — the
    /// negative one is recorded as the outgoing leg.
    ///
    /// Returns `false` (and links nothing) when the pair can't be a
    /// transfer: either transaction is missing or deleted, they're in the
    /// same account, they don't go in opposite directions, or either is
    /// already half of another link. Amounts are *not* required to match —
    /// a transfer with a fee legitimately leaves the legs a few dollars
    /// apart; `transfer_candidates` only *suggests* exact matches.
    pub fn link_transfer(&self, a: i64, b: i64) -> rusqlite::Result<bool> {
        self.link_transfer_as(a, b, false)
    }

    /// `link_transfer`'s one implementation. `auto` marks a link the app made
    /// on its own: it goes on the review list (`reviewed = 0`) until a person
    /// says it looks right. A person's own link is `auto = 0`, already
    /// reviewed.
    fn link_transfer_as(&self, a: i64, b: i64, auto: bool) -> rusqlite::Result<bool> {
        let leg = |id: i64| -> rusqlite::Result<Option<(i64, Decimal)>> {
            match self.conn.query_row(
                "SELECT account_id, amount FROM transactions WHERE id = ?1 AND deleted_at IS NULL",
                params![id],
                |row| Ok((row.get::<_, i64>(0)?, row.get::<_, String>(1)?)),
            ) {
                Ok((account_id, amount)) => Ok(Some((
                    account_id,
                    Decimal::from_str(&amount).expect("amount stored by this crate must be valid"),
                ))),
                Err(rusqlite::Error::QueryReturnedNoRows) => Ok(None),
                Err(e) => Err(e),
            }
        };
        let (Some((account_a, amount_a)), Some((account_b, amount_b))) = (leg(a)?, leg(b)?) else {
            return Ok(false);
        };
        if a == b || account_a == account_b {
            return Ok(false);
        }
        let (out_id, in_id) = match (
            amount_a < Decimal::ZERO,
            amount_b < Decimal::ZERO,
            amount_a > Decimal::ZERO,
            amount_b > Decimal::ZERO,
        ) {
            (true, _, _, true) => (a, b),
            (_, true, true, _) => (b, a),
            _ => return Ok(false),
        };
        let already_linked: bool = self.conn.query_row(
            "SELECT EXISTS(SELECT 1 FROM transfer_links
                           WHERE out_transaction_id IN (?1, ?2) OR in_transaction_id IN (?1, ?2))",
            params![out_id, in_id],
            |row| row.get(0),
        )?;
        if already_linked {
            return Ok(false);
        }
        self.conn.execute(
            "INSERT INTO transfer_links (out_transaction_id, in_transaction_id, auto, reviewed) VALUES (?1, ?2, ?3, ?4)",
            params![out_id, in_id, auto, !auto],
        )?;
        Ok(true)
    }

    /// Removes the link a transaction is part of, from either leg. A no-op
    /// when it isn't linked. The transactions themselves are untouched —
    /// they simply count as ordinary income/spending again.
    ///
    /// The pair is also remembered as "not a transfer" so `auto_link_transfers`
    /// never links it again (otherwise Unlink would undo itself on the next
    /// import). It is still *suggested* like any other pair, so a person can
    /// link it by hand.
    pub fn unlink_transfer(&self, transaction_id: i64) -> rusqlite::Result<()> {
        self.conn.execute(
            "INSERT OR IGNORE INTO transfer_link_rejections (out_transaction_id, in_transaction_id)
             SELECT out_transaction_id, in_transaction_id FROM transfer_links
             WHERE out_transaction_id = ?1 OR in_transaction_id = ?1",
            params![transaction_id],
        )?;
        self.conn.execute(
            "DELETE FROM transfer_links WHERE out_transaction_id = ?1 OR in_transaction_id = ?1",
            params![transaction_id],
        )?;
        Ok(())
    }

    /// Unlinked pairs that look like the two legs of one transfer: opposite
    /// signs, exactly equal amounts, different accounts, dated within 3 days
    /// of each other. Each transaction appears in at most one suggestion —
    /// candidate pairs are taken closest-date-first (then by id), so when a
    /// $500 out could match two $500 ins, the nearer one wins. Never
    /// includes `apply_debt_payment`'s generated bookkeeping rows or deleted
    /// transactions. A pair someone has explicitly dismissed (see
    /// `dismiss_transfer_candidates`) is excluded before the one-match-per-
    /// transaction reduction runs, so dismissing the shown pair for a leg
    /// with more than one possible match surfaces its next-closest
    /// alternative rather than hiding that leg entirely.
    pub fn transfer_candidates(&self) -> rusqlite::Result<Vec<TransferCandidate>> {
        let dismissed = self.dismissed_transfer_pairs()?;
        let pairs = self.transfer_candidate_pairs()?;
        let mut used = std::collections::HashSet::new();
        let mut result = Vec::new();
        for (_, out_id, in_id) in pairs {
            if dismissed.contains(&(out_id, in_id)) {
                continue;
            }
            if used.contains(&out_id) || used.contains(&in_id) {
                continue;
            }
            used.insert(out_id);
            used.insert(in_id);
            result.push(TransferCandidate { out_id, in_id });
        }
        result.sort_by_key(|c| c.out_id);
        Ok(result)
    }

    /// Every currently undismissed way two unlinked transactions could be
    /// the legs of one transfer — the full raw set `transfer_candidates`
    /// draws from, *before* its one-match-per-transaction reduction. Used by
    /// "Dismiss all": the reduced `transfer_candidates` list can hide a
    /// second, equally valid pairing behind whichever match won the
    /// closest-date tiebreak, and dismissing only what's shown would leave
    /// that alternate to resurface as a new suggestion the moment its
    /// sibling is dismissed. Dismissing this whole set instead exhausts
    /// every possible pairing at once.
    pub fn list_all_transfer_candidate_pairs(&self) -> rusqlite::Result<Vec<TransferCandidate>> {
        let dismissed = self.dismissed_transfer_pairs()?;
        let mut result: Vec<TransferCandidate> = self
            .transfer_candidate_pairs()?
            .into_iter()
            .map(|(_, out_id, in_id)| TransferCandidate { out_id, in_id })
            .filter(|c| !dismissed.contains(&(c.out_id, c.in_id)))
            .collect();
        result.sort_by_key(|c| (c.out_id, c.in_id));
        Ok(result)
    }

    /// Every pair a person has told Vault Spend to stop suggesting as a
    /// transfer (see `dismiss_transfer_candidates`).
    fn dismissed_transfer_pairs(&self) -> rusqlite::Result<std::collections::HashSet<(i64, i64)>> {
        let mut stmt = self
            .conn
            .prepare("SELECT out_transaction_id, in_transaction_id FROM transfer_candidate_dismissals")?;
        let rows = stmt.query_map([], |row| Ok((row.get::<_, i64>(0)?, row.get::<_, i64>(1)?)))?;
        rows.collect()
    }

    /// Records that a person explicitly wants these exact pairs to stop
    /// being suggested as transfers — never touches either transaction's
    /// category, amount, tags or income/spending totals, and never deletes
    /// anything; that's what Link does. Distinct from
    /// `transfer_link_rejections` (which remembers an *Unlink* so
    /// auto-linking won't redo it).
    ///
    /// Each pair is normalized to (out, in) by sign, so either leg's id may
    /// be passed in either position. A pair naming a transaction id that
    /// doesn't exist at all fails the *entire* batch — nothing is persisted
    /// — since that can only mean a caller bug, never a normal state race.
    /// A pair that's merely no longer eligible (already linked, or either
    /// leg deleted since it was shown) is skipped rather than erroring the
    /// batch: the review dialog only sends pairs it just displayed, and a
    /// concurrent change to one of them mid-review is exactly the kind of
    /// benign race this defends against. An already-dismissed pair is
    /// skipped too. Returns only the pairs newly inserted this call, so
    /// Undo can restore exactly those and no others.
    pub fn dismiss_transfer_candidates(&self, pairs: &[(i64, i64)]) -> rusqlite::Result<Vec<TransferCandidate>> {
        let sql_tx = self.conn.unchecked_transaction()?;
        let mut newly = Vec::new();
        for &(a, b) in pairs {
            let amount_of = |id: i64| -> rusqlite::Result<Decimal> {
                sql_tx
                    .query_row("SELECT amount FROM transactions WHERE id = ?1", params![id], |row| {
                        row.get::<_, String>(0)
                    })
                    .map(|s| s.parse::<Decimal>().unwrap_or(Decimal::ZERO))
            };
            let amount_a = amount_of(a)?;
            let amount_b = amount_of(b)?;
            let (out_id, in_id) = if amount_a < Decimal::ZERO && amount_b > Decimal::ZERO {
                (a, b)
            } else if amount_b < Decimal::ZERO && amount_a > Decimal::ZERO {
                (b, a)
            } else {
                // Same sign (or a zero amount) — not a shape dismissal makes sense for; skip rather
                // than guess an orientation, but this is defense in depth, not the expected path.
                continue;
            };
            let already_linked: bool = sql_tx.query_row(
                "SELECT EXISTS(SELECT 1 FROM transfer_links WHERE out_transaction_id IN (?1, ?2) OR in_transaction_id IN (?1, ?2))",
                params![out_id, in_id],
                |row| row.get(0),
            )?;
            if already_linked {
                continue;
            }
            let inserted = sql_tx.execute(
                "INSERT OR IGNORE INTO transfer_candidate_dismissals (out_transaction_id, in_transaction_id) VALUES (?1, ?2)",
                params![out_id, in_id],
            )?;
            if inserted > 0 {
                newly.push(TransferCandidate { out_id, in_id });
            }
        }
        sql_tx.commit()?;
        Ok(newly)
    }

    /// Undoes exactly the named dismissals — an already-dismissed pair not
    /// in this list is left alone. Powers Undo after `dismiss_transfer_candidates`.
    pub fn restore_transfer_candidates(&self, pairs: &[(i64, i64)]) -> rusqlite::Result<()> {
        let sql_tx = self.conn.unchecked_transaction()?;
        for &(out_id, in_id) in pairs {
            sql_tx.execute(
                "DELETE FROM transfer_candidate_dismissals WHERE out_transaction_id = ?1 AND in_transaction_id = ?2",
                params![out_id, in_id],
            )?;
        }
        sql_tx.commit()?;
        Ok(())
    }

    /// Every way two unlinked transactions could be the legs of one transfer
    /// (the rules in `transfer_candidates`), as `(days apart, out id, in id)`,
    /// closest first — *before* any transaction is limited to a single match.
    /// `transfer_candidates` takes the closest first; `auto_link_transfers`
    /// only acts where a leg has exactly one.
    fn transfer_candidate_pairs(&self) -> rusqlite::Result<Vec<(i64, i64, i64)>> {
        struct Leg {
            id: i64,
            account_id: i64,
            date: NaiveDate,
            amount: Decimal,
        }
        let mut stmt = self.conn.prepare(
            "SELECT id, account_id, date, amount FROM transactions
             WHERE deleted_at IS NULL
                   AND id NOT IN (SELECT generated_transaction_id FROM debt_payments)
                   AND id NOT IN (SELECT out_transaction_id FROM transfer_links)
                   AND id NOT IN (SELECT in_transaction_id FROM transfer_links)
             ORDER BY id",
        )?;
        let rows = stmt.query_map([], |row| {
            Ok((
                row.get::<_, i64>(0)?,
                row.get::<_, i64>(1)?,
                row.get::<_, String>(2)?,
                row.get::<_, String>(3)?,
            ))
        })?;
        let mut outs = Vec::new();
        let mut ins = Vec::new();
        for row in rows {
            let (id, account_id, date, amount) = row?;
            let leg = Leg {
                id,
                account_id,
                date: NaiveDate::parse_from_str(&date, "%Y-%m-%d").expect("date stored by this crate must be valid"),
                amount: Decimal::from_str(&amount).expect("amount stored by this crate must be valid"),
            };
            if leg.amount < Decimal::ZERO {
                outs.push(leg);
            } else if leg.amount > Decimal::ZERO {
                ins.push(leg);
            }
        }

        // Bucket the incoming legs by amount so each outgoing leg only looks at
        // same-amount candidates — comparing every out against every in is
        // quadratic, which is seconds of work on a few thousand transactions.
        // Keyed by the normalized decimal string so "500.0" and "500.00" meet.
        let mut ins_by_amount: std::collections::HashMap<String, Vec<&Leg>> = std::collections::HashMap::new();
        for inn in &ins {
            ins_by_amount.entry(inn.amount.normalize().to_string()).or_default().push(inn);
        }

        let mut pairs: Vec<(i64, i64, i64)> = Vec::new(); // (days apart, out id, in id)
        for out in &outs {
            let Some(same_amount) = ins_by_amount.get(&out.amount.abs().normalize().to_string()) else {
                continue;
            };
            for inn in same_amount {
                if out.account_id == inn.account_id {
                    continue;
                }
                let days = (out.date - inn.date).num_days().abs();
                if days <= 3 {
                    pairs.push((days, out.id, inn.id));
                }
            }
        }
        pairs.sort();
        Ok(pairs)
    }

    /// Links every *clear-cut* transfer pair without asking, and returns the
    /// pairs it linked. Clear-cut means it meets the suggestion rules (opposite
    /// signs, equal amounts, different accounts, within 3 days) AND neither leg
    /// has any other possible match — so a $500 out with two $500 deposits in
    /// range is left for a person to decide. A pair someone already unlinked
    /// (`unlink_transfer`) is ignored, and doesn't count against its neighbours
    /// either. The links are marked automatic and unreviewed, which puts them
    /// on `auto_linked_transfers_to_review`.
    pub fn auto_link_transfers(&self) -> rusqlite::Result<Vec<TransferCandidate>> {
        let rejected: std::collections::HashSet<(i64, i64)> = {
            let mut stmt = self
                .conn
                .prepare("SELECT out_transaction_id, in_transaction_id FROM transfer_link_rejections")?;
            let rows = stmt.query_map([], |row| Ok((row.get::<_, i64>(0)?, row.get::<_, i64>(1)?)))?;
            rows.collect::<rusqlite::Result<_>>()?
        };
        let dismissed = self.dismissed_transfer_pairs()?;
        let pairs: Vec<(i64, i64)> = self
            .transfer_candidate_pairs()?
            .into_iter()
            .map(|(_, out_id, in_id)| (out_id, in_id))
            .filter(|pair| !rejected.contains(pair) && !dismissed.contains(pair))
            .collect();
        let mut matches_per_out: std::collections::HashMap<i64, usize> = std::collections::HashMap::new();
        let mut matches_per_in: std::collections::HashMap<i64, usize> = std::collections::HashMap::new();
        for (out_id, in_id) in &pairs {
            *matches_per_out.entry(*out_id).or_default() += 1;
            *matches_per_in.entry(*in_id).or_default() += 1;
        }

        let mut linked = Vec::new();
        for (out_id, in_id) in pairs {
            if matches_per_out[&out_id] == 1 && matches_per_in[&in_id] == 1 && self.link_transfer_as(out_id, in_id, true)? {
                linked.push(TransferCandidate { out_id, in_id });
            }
        }
        linked.sort_by_key(|c| c.out_id);
        Ok(linked)
    }

    /// `auto_link_transfers`, but only when the Settings switch is on —
    /// what every place that adds transactions calls.
    pub fn auto_link_transfers_if_enabled(&self) -> rusqlite::Result<Vec<TransferCandidate>> {
        if self.get_app_settings()?.auto_link_transfers {
            self.auto_link_transfers()
        } else {
            Ok(Vec::new())
        }
    }

    /// Automatic links a person hasn't yet marked "looks right" — the review
    /// report. Only pairs whose two transactions both still exist (a deleted
    /// leg's link doesn't count, and returns if the delete is undone).
    pub fn auto_linked_transfers_to_review(&self) -> rusqlite::Result<Vec<TransferCandidate>> {
        let mut stmt = self.conn.prepare(
            "SELECT l.out_transaction_id, l.in_transaction_id FROM transfer_links l
             JOIN transactions o ON o.id = l.out_transaction_id AND o.deleted_at IS NULL
             JOIN transactions i ON i.id = l.in_transaction_id AND i.deleted_at IS NULL
             WHERE l.auto = 1 AND l.reviewed = 0
             ORDER BY l.out_transaction_id",
        )?;
        let rows = stmt.query_map([], |row| {
            Ok(TransferCandidate {
                out_id: row.get(0)?,
                in_id: row.get(1)?,
            })
        })?;
        rows.collect()
    }

    /// Marks automatic links "looks right" (by their outgoing leg's id) so
    /// they leave the review list. The links themselves stay. Returns how many
    /// were marked.
    pub fn mark_transfer_links_reviewed(&self, out_ids: &[i64]) -> rusqlite::Result<usize> {
        let mut marked = 0;
        for out_id in out_ids {
            marked += self.conn.execute(
                "UPDATE transfer_links SET reviewed = 1 WHERE out_transaction_id = ?1 AND auto = 1 AND reviewed = 0",
                params![out_id],
            )?;
        }
        Ok(marked)
    }
}
