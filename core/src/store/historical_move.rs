//! What moving older transactions does to an account's saved balances.
//!
//! For each account a move touches, the recorded checkpoints that count rows dated on or after the earliest
//! moved row are "affected". If every one of them recorded what it counted (`automatic_recorded`, trusted), the
//! corrected value of each is worked out from that record alone, in memory (`plan_account`): a source loses the
//! contribution it counted for the row (or nothing, when the row was proven absent), a destination gains the
//! row's contribution in the interval that covers its date, and a correction flows once to every descendant.
//! Anything else (a legacy or typed balance, an edited row, a changed account) needs the person to confirm the
//! balance after the move. Structural damage is an integrity error that confirmation cannot bypass.

use super::Store;
use super::checkpoints::{CheckpointKind, VersionSpec, add_amount, direction, parse_date, parse_decimal, sub_amount};
use chrono::NaiveDate;
use rusqlite::{OptionalExtension, params};
use rust_decimal::Decimal;
use std::collections::{BTreeMap, BTreeSet, HashMap, HashSet};

/// A row being moved, as the correction needs it.
#[derive(Debug, Clone)]
pub(super) struct MovingRow {
    pub id: i64,
    pub date: NaiveDate,
    pub quantity: Decimal,
    pub revision: i64,
}

#[derive(Debug, Clone, PartialEq)]
pub(super) enum Verdict {
    /// Nothing needs confirming; `changes` lists the checkpoints to correct (possibly none).
    Automatic,
    NeedsConfirmation,
    Integrity,
}

/// One checkpoint's corrected value and membership.
#[derive(Debug, Clone)]
pub(super) struct NodeChange {
    pub reset_id: i64,
    pub old_version_id: i64,
    pub old_balance: Decimal,
    pub new_balance: Decimal,
    pub cutoff: NaiveDate,
    pub effective: NaiveDate,
    pub removed: Vec<i64>,
    /// Transaction id and the contribution it adds (signed by the account's direction).
    pub added: Vec<(i64, Decimal)>,
    pub parent_reset_id: Option<i64>,
}

#[derive(Debug, Clone)]
pub(super) struct AccountPlan {
    pub account_id: i64,
    pub verdict: Verdict,
    /// In date order, parents before children.
    pub changes: Vec<NodeChange>,
    /// Plain-language reasons the balance has to be confirmed, or why the move is blocked as damaged.
    pub reasons: Vec<String>,
    /// Latest cutoff of an affected checkpoint, for the preview's "history affected" line.
    pub affected_cutoffs: Vec<NaiveDate>,
}

struct Node {
    reset_id: i64,
    cutoff: NaiveDate,
    balance: Decimal,
    version_id: i64,
    kind: CheckpointKind,
    integrity: String,
    version_balance: Decimal,
    account_type: Option<String>,
    opening_baseline: Option<Decimal>,
    parent_version_id: Option<i64>,
    parent_balance: Option<Decimal>,
    parent_cutoff: Option<NaiveDate>,
    capture_revision: i64,
    coverage_start: Option<NaiveDate>,
    coverage_end: Option<NaiveDate>,
}

fn pretty(d: NaiveDate) -> String {
    d.format("%b %-d, %Y").to_string()
}

type AppliedCorrection = (i64, i64, i64, Decimal, Decimal);
type CapturedVersionRow = (
    String,
    Option<String>,
    Option<String>,
    Option<i64>,
    Option<String>,
    Option<String>,
    Option<String>,
    Option<String>,
    Option<String>,
    i64,
);

impl Store {
    fn load_nodes(&self, account_id: i64) -> rusqlite::Result<Result<Vec<Node>, String>> {
        let mut stmt = self.conn.prepare(
            "SELECT r.id, r.period, r.reset_date, r.balance, r.current_version_id,
                    v.id, v.kind, v.integrity, v.balance, v.account_type, v.opening_baseline, v.parent_version_id, v.parent_balance, v.parent_cutoff,
                    v.capture_revision, v.coverage_start, v.coverage_end,
                    (v.account_id = r.account_id AND v.reset_id = r.id AND v.cutoff_date = r.reset_date
                     AND v.effective_from = COALESCE(r.effective_from, r.reset_date) AND v.algorithm_version = 1)
             FROM balance_resets r LEFT JOIN balance_reset_versions v ON v.id = r.current_version_id
             WHERE r.account_id = ?1 ORDER BY r.reset_date, r.id",
        )?;
        let raw = stmt
            .query_map(params![account_id], |r| {
                Ok((
                    r.get::<_, i64>(0)?,
                    r.get::<_, String>(1)?,
                    r.get::<_, String>(2)?,
                    r.get::<_, String>(3)?,
                    r.get::<_, Option<i64>>(5)?,
                    r.get::<_, Option<String>>(6)?,
                    r.get::<_, Option<String>>(7)?,
                    r.get::<_, Option<String>>(8)?,
                    r.get::<_, Option<String>>(9)?,
                    r.get::<_, Option<String>>(10)?,
                    r.get::<_, Option<i64>>(11)?,
                    r.get::<_, Option<String>>(12)?,
                    r.get::<_, Option<String>>(13)?,
                    r.get::<_, Option<i64>>(14)?,
                    r.get::<_, Option<String>>(15)?,
                    r.get::<_, Option<String>>(16)?,
                    r.get::<_, Option<bool>>(17)?,
                ))
            })?
            .collect::<rusqlite::Result<Vec<_>>>()?;
        let mut nodes = Vec::new();
        for (
            reset_id,
            period,
            cutoff,
            balance,
            version_id,
            kind,
            integrity,
            vbalance,
            vtype,
            opening,
            parent_id,
            pbalance,
            pcutoff,
            capture,
            cs,
            ce,
            metadata_matches,
        ) in raw
        {
            if metadata_matches == Some(false) {
                return Ok(Err(format!(
                    "the saved balance of {period} no longer matches its recorded account or dates"
                )));
            }
            let (Some(version_id), Some(kind), Some(integrity), Some(vbalance)) = (version_id, kind, integrity, vbalance) else {
                return Ok(Err(format!("the saved balance of {period} has no recorded version")));
            };
            let Some(kind) = CheckpointKind::parse(&kind) else {
                return Ok(Err(format!("the saved balance of {period} has an unknown kind")));
            };
            let node = (|| -> rusqlite::Result<Node> {
                Ok(Node {
                    reset_id,
                    cutoff: parse_date(&cutoff)?,
                    balance: parse_decimal(&balance)?,
                    version_id,
                    kind,
                    integrity,
                    version_balance: parse_decimal(&vbalance)?,
                    account_type: vtype,
                    opening_baseline: opening.map(|v| parse_decimal(&v)).transpose()?,
                    parent_version_id: parent_id,
                    parent_balance: pbalance.map(|v| parse_decimal(&v)).transpose()?,
                    parent_cutoff: pcutoff.map(|v| parse_date(&v)).transpose()?,
                    capture_revision: capture.unwrap_or(0),
                    coverage_start: cs.map(|v| parse_date(&v)).transpose()?,
                    coverage_end: ce.map(|v| parse_date(&v)).transpose()?,
                })
            })();
            match node {
                Ok(n) => nodes.push(n),
                Err(_) => return Ok(Err(format!("the saved balance of {period} has an unreadable value"))),
            }
        }
        Ok(Ok(nodes))
    }

    /// The corrections (or the reason confirmation or refusal is needed) for the rows moving out of, or into, one
    /// account. `moving` is only ever one direction: a source's rows or the destination's incoming rows.
    pub(super) fn plan_account(
        &self,
        account_id: i64,
        account_type: &str,
        starting_balance: Decimal,
        moving: &[MovingRow],
        incoming: bool,
    ) -> rusqlite::Result<AccountPlan> {
        let mut plan = AccountPlan {
            account_id,
            verdict: Verdict::Automatic,
            changes: Vec::new(),
            reasons: Vec::new(),
            affected_cutoffs: Vec::new(),
        };
        let integrity = |plan: &mut AccountPlan, why: String| {
            plan.verdict = Verdict::Integrity;
            plan.reasons.push(why);
        };
        let nodes = match self.load_nodes(account_id)? {
            Ok(nodes) => nodes,
            Err(why) => {
                integrity(&mut plan, why);
                return Ok(plan);
            }
        };
        let Some(t_min) = moving.iter().map(|r| r.date).min() else {
            return Ok(plan);
        };
        let affected: Vec<&Node> = nodes.iter().filter(|n| n.cutoff >= t_min).collect();
        if affected.is_empty() {
            return Ok(plan);
        }
        plan.affected_cutoffs = affected.iter().map(|n| n.cutoff).collect();
        let by_reset: HashMap<i64, &Node> = nodes.iter().map(|n| (n.reset_id, n)).collect();
        let affected_ids: HashSet<i64> = affected.iter().map(|n| n.reset_id).collect();
        let dir = direction(account_type);

        // Which checkpoints can be corrected from their own record?
        let mut needs: BTreeSet<String> = BTreeSet::new();
        for n in &affected {
            match (n.kind, n.integrity.as_str()) {
                (CheckpointKind::AutomaticRecorded, "trusted") => {}
                (CheckpointKind::MoveConfirmation, _) => {
                    needs.insert(format!(
                        "the balance you confirmed for {} was typed in, so what it counted is not recorded",
                        pretty(n.cutoff)
                    ));
                }
                (CheckpointKind::ManualAnchor, _) => {
                    needs.insert(format!(
                        "the balance you set yourself as of {} does not record what it counted",
                        pretty(n.cutoff)
                    ));
                }
                (CheckpointKind::LegacyUnknown, _) => {
                    needs.insert(format!(
                        "the monthly balance carried forward as of {} does not record which transactions it counted",
                        pretty(n.cutoff)
                    ));
                }
                (CheckpointKind::AutomaticRecorded, _) => {
                    needs.insert(format!(
                        "the saved balance as of {} was changed outside the app, so its record can no longer be relied on",
                        pretty(n.cutoff)
                    ));
                }
            }
        }
        // The recorded ones must also still describe this account.
        for n in affected
            .iter()
            .filter(|n| n.kind == CheckpointKind::AutomaticRecorded && n.integrity == "trusted")
        {
            if n.account_type.as_deref() != Some(account_type) {
                needs.insert(format!("the account type changed after the balance as of {} was saved", pretty(n.cutoff)));
            }
            if n.parent_version_id.is_none() && n.opening_baseline != Some(starting_balance) {
                needs.insert(format!(
                    "the opening balance changed after the balance as of {} was saved",
                    pretty(n.cutoff)
                ));
            }
        }

        // Structural checks on the recorded ones: a failure here is damage, not something a confirmation can cover.
        for n in &affected {
            if n.version_balance != n.balance {
                integrity(
                    &mut plan,
                    format!("the saved balance as of {} no longer matches its record", pretty(n.cutoff)),
                );
                continue;
            }
            // parent link
            let mut steps = 0usize;
            let mut cursor = n.parent_version_id;
            let mut seen: HashSet<i64> = HashSet::new();
            while let Some(version) = cursor {
                steps += 1;
                if steps > nodes.len() + 1 || !seen.insert(version) {
                    integrity(
                        &mut plan,
                        format!("the saved balances before {} refer back to themselves", pretty(n.cutoff)),
                    );
                    break;
                }
                let parent = self
                    .conn
                    .query_row(
                        "SELECT reset_id, account_id, parent_version_id FROM balance_reset_versions WHERE id = ?1",
                        params![version],
                        |r| Ok((r.get::<_, i64>(0)?, r.get::<_, i64>(1)?, r.get::<_, Option<i64>>(2)?)),
                    )
                    .optional()?;
                match parent {
                    None => {
                        integrity(
                            &mut plan,
                            format!("the saved balance before {} is missing from its record", pretty(n.cutoff)),
                        );
                        break;
                    }
                    Some((_, parent_account, _)) if parent_account != account_id => {
                        integrity(
                            &mut plan,
                            format!("the saved balance before {} belongs to another account", pretty(n.cutoff)),
                        );
                        break;
                    }
                    Some((_, _, next)) => cursor = next,
                }
            }
            if plan.verdict == Verdict::Integrity {
                continue;
            }
            if n.kind != CheckpointKind::AutomaticRecorded || n.integrity != "trusted" {
                continue;
            }
            if let Some(parent_version) = n.parent_version_id {
                let (parent_reset, parent_account): (i64, i64) = self.conn.query_row(
                    "SELECT reset_id, account_id FROM balance_reset_versions WHERE id = ?1",
                    params![parent_version],
                    |r| Ok((r.get(0)?, r.get(1)?)),
                )?;
                let _ = parent_account;
                match by_reset.get(&parent_reset) {
                    Some(p) => {
                        if p.version_id != parent_version {
                            integrity(
                                &mut plan,
                                format!(
                                    "the saved balance before {} was changed without updating the balance after it",
                                    pretty(n.cutoff)
                                ),
                            );
                        } else if Some(p.cutoff) != n.parent_cutoff || Some(p.balance) != n.parent_balance {
                            integrity(
                                &mut plan,
                                format!(
                                    "the saved balance as of {} no longer agrees with the one it was built on",
                                    pretty(n.cutoff)
                                ),
                            );
                        }
                    }
                    None => integrity(&mut plan, format!("the saved balance before {} was removed", pretty(n.cutoff))),
                }
            }
            // coverage and stored sum
            if n.coverage_end != Some(n.cutoff) || n.coverage_start != n.parent_cutoff {
                integrity(
                    &mut plan,
                    format!("the record of what the balance as of {} counted is incomplete", pretty(n.cutoff)),
                );
                continue;
            }
            let mut stmt = self.conn.prepare(
                "SELECT account_id, date, amount, principal_amount, contribution FROM balance_version_contributions WHERE version_id = ?1",
            )?;
            let parts = stmt
                .query_map(params![n.version_id], |r| {
                    Ok((
                        r.get::<_, i64>(0)?,
                        r.get::<_, String>(1)?,
                        r.get::<_, String>(2)?,
                        r.get::<_, Option<String>>(3)?,
                        r.get::<_, String>(4)?,
                    ))
                })?
                .collect::<rusqlite::Result<Vec<_>>>()?;
            let mut sum = Decimal::ZERO;
            let mut ok = true;
            for (member_account, member_date, amount, principal, contribution) in parts {
                let decoded = (|| -> rusqlite::Result<(NaiveDate, Decimal, Decimal)> {
                    let quantity = principal.as_deref().map(parse_decimal).transpose()?.unwrap_or(parse_decimal(&amount)?);
                    Ok((parse_date(&member_date)?, quantity, parse_decimal(&contribution)?))
                })();
                match decoded {
                    Ok((date, quantity, contribution))
                        if member_account == account_id
                            && date <= n.cutoff
                            && n.parent_cutoff.is_none_or(|p| date > p)
                            && contribution == dir * quantity =>
                    {
                        sum = add_amount(sum, contribution)?;
                    }
                    _ => ok = false,
                }
            }
            let base = n.parent_balance.or(n.opening_baseline);
            if !ok || base.map(|b| add_amount(b, sum)).transpose()?.is_none_or(|b| b != n.balance) {
                integrity(
                    &mut plan,
                    format!("the saved balance as of {} does not equal its recorded transactions", pretty(n.cutoff)),
                );
            }
        }
        if plan.verdict == Verdict::Integrity {
            return Ok(plan);
        }
        if !needs.is_empty() {
            plan.verdict = Verdict::NeedsConfirmation;
            plan.reasons = needs.into_iter().collect();
            return Ok(plan);
        }

        // Everything affected is recorded: work out each checkpoint's change, oldest first.
        let mut changes: BTreeMap<i64, NodeChange> = BTreeMap::new();
        let mut total_delta: HashMap<i64, Decimal> = HashMap::new();
        let mut ordered: Vec<&Node> = affected.clone();
        ordered.sort_by_key(|n| (n.cutoff, n.reset_id));
        for n in ordered {
            let parent_reset = match n.parent_version_id {
                Some(v) => Some(
                    self.conn
                        .query_row("SELECT reset_id FROM balance_reset_versions WHERE id = ?1", params![v], |r| {
                            r.get::<_, i64>(0)
                        })?,
                ),
                None => None,
            };
            let parent_affected = parent_reset.filter(|p| affected_ids.contains(p));
            let mut delta = parent_affected.and_then(|p| total_delta.get(&p).copied()).unwrap_or(Decimal::ZERO);
            let mut removed = Vec::new();
            let mut added = Vec::new();
            for row in moving {
                let inside = row.date <= n.cutoff && n.parent_cutoff.is_none_or(|p| row.date > p);
                if !inside {
                    continue;
                }
                if incoming {
                    let already: bool = self.conn.query_row(
                        "SELECT EXISTS(SELECT 1 FROM balance_version_contributions WHERE version_id = ?1 AND transaction_id = ?2)",
                        params![n.version_id, row.id],
                        |r| r.get(0),
                    )?;
                    if already {
                        integrity(
                            &mut plan,
                            format!(
                                "the balance as of {} already counts a transaction that is about to arrive",
                                pretty(n.cutoff)
                            ),
                        );
                        return Ok(plan);
                    }
                    let c = dir * row.quantity;
                    delta = add_amount(delta, c)?;
                    added.push((row.id, c));
                } else {
                    let found: Option<(i64, String)> = self
                        .conn
                        .query_row(
                            "SELECT revision, contribution FROM balance_version_contributions WHERE version_id = ?1 AND transaction_id = ?2",
                            params![n.version_id, row.id],
                            |r| Ok((r.get(0)?, r.get(1)?)),
                        )
                        .optional()?;
                    match found {
                        Some((revision, c)) if revision == row.revision => {
                            delta = sub_amount(delta, parse_decimal(&c)?)?;
                            removed.push(row.id);
                        }
                        Some(_) => {
                            plan.verdict = Verdict::NeedsConfirmation;
                            plan.reasons.push(format!(
                                "a transaction was edited after the balance as of {} was saved, so its effect on that balance is not recorded",
                                pretty(n.cutoff)
                            ));
                        }
                        None if row.revision <= n.capture_revision => {
                            integrity(
                                &mut plan,
                                format!("the balance as of {} is missing a transaction it must have counted", pretty(n.cutoff)),
                            );
                            return Ok(plan);
                        }
                        None => {} // added after the balance was saved: it never counted, so removing it changes nothing
                    }
                }
            }
            let reparent_only = removed.is_empty() && added.is_empty() && parent_affected.is_some_and(|p| changes.contains_key(&p));
            total_delta.insert(n.reset_id, delta);
            if delta != Decimal::ZERO || !removed.is_empty() || !added.is_empty() || reparent_only {
                changes.insert(
                    n.reset_id,
                    NodeChange {
                        reset_id: n.reset_id,
                        old_version_id: n.version_id,
                        old_balance: n.balance,
                        new_balance: add_amount(n.balance, delta)?,
                        cutoff: n.cutoff,
                        effective: n.cutoff,
                        removed,
                        added,
                        parent_reset_id: parent_reset,
                    },
                );
            }
        }
        if plan.verdict == Verdict::NeedsConfirmation {
            plan.reasons.sort();
            plan.reasons.dedup();
            return Ok(plan);
        }
        plan.changes = changes.into_values().collect();
        Ok(plan)
    }

    /// Appends the corrected versions. Returns `(reset_id, old_version, new_version, old_balance, new_balance)`.
    pub(super) fn apply_node_changes(
        &self,
        account_id: i64,
        account_type: &str,
        changes: &[NodeChange],
        operation_id: &str,
        after_each: &mut dyn FnMut(usize) -> Result<(), super::transaction_account_move::MoveError>,
    ) -> Result<Vec<AppliedCorrection>, super::transaction_account_move::MoveError> {
        let dir = direction(account_type);
        let mut new_versions: HashMap<i64, (i64, Decimal, NaiveDate)> = HashMap::new(); // reset -> (new version, new balance, cutoff)
        let mut done = Vec::new();
        for (n, change) in changes.iter().enumerate() {
            let old: CapturedVersionRow = self.conn.query_row(
                "SELECT account_type, opening_baseline, parent_balance, parent_version_id, parent_cutoff, coverage_start, coverage_end, kind, integrity, capture_revision
                 FROM balance_reset_versions WHERE id = ?1",
                params![change.old_version_id],
                |r| Ok((r.get(0)?, r.get(1)?, r.get(2)?, r.get(3)?, r.get(4)?, r.get(5)?, r.get(6)?, r.get(7)?, r.get(8)?, r.get(9)?)),
            )?;
            // The corrected version still describes the interval as it was when it was recorded: a row added later
            // has a newer revision than this, and is either a member by revision or was never counted.
            let capture_revision = old.9;
            let (parent_version_id, parent_balance, parent_cutoff) = match change.parent_reset_id.and_then(|p| new_versions.get(&p)) {
                Some((version, balance, cutoff)) => (Some(*version), Some(*balance), Some(*cutoff)),
                None => (
                    old.3,
                    old.2.as_deref().map(parse_decimal).transpose()?,
                    old.4.as_deref().map(parse_date).transpose()?,
                ),
            };
            let opening = old.1.as_deref().map(parse_decimal).transpose()?;
            let spec = VersionSpec {
                reset_id: change.reset_id,
                account_id,
                kind: CheckpointKind::AutomaticRecorded,
                cutoff: change.cutoff,
                effective: change.effective,
                balance: change.new_balance,
                account_type: account_type.to_string(),
                opening_baseline: opening,
                parent_version_id,
                parent_balance,
                parent_cutoff,
                operation_id: Some(operation_id.to_string()),
                integrity: "trusted",
                capture_revision,
                coverage_start: old.5.as_deref().map(parse_date).transpose()?,
                coverage_end: old.6.as_deref().map(parse_date).transpose()?,
            };
            let version_id = self.trusted_checkpoint_writes(|| {
                let id = self.insert_version(&spec)?;
                self.conn.execute(
                    "UPDATE balance_resets SET balance = ?1, current_version_id = ?2 WHERE id = ?3",
                    params![change.new_balance.to_string(), id, change.reset_id],
                )?;
                Ok(id)
            })?;
            // The new version's membership: what the old one counted, less what left, plus what arrived.
            self.conn.execute(
                "INSERT INTO balance_version_contributions (version_id, transaction_id, revision, account_id, date, amount, principal_amount, contribution)
                 SELECT ?1, transaction_id, revision, account_id, date, amount, principal_amount, contribution
                 FROM balance_version_contributions WHERE version_id = ?2",
                params![version_id, change.old_version_id],
            )?;
            for id in &change.removed {
                self.conn.execute(
                    "DELETE FROM balance_version_contributions WHERE version_id = ?1 AND transaction_id = ?2",
                    params![version_id, id],
                )?;
            }
            for (id, contribution) in &change.added {
                let (revision, date, amount, principal): (i64, String, String, Option<String>) = self.conn.query_row(
                    "SELECT financial_revision, date, amount, principal_amount FROM transactions WHERE id = ?1",
                    params![id],
                    |r| Ok((r.get(0)?, r.get(1)?, r.get(2)?, r.get(3)?)),
                )?;
                self.conn.execute(
                    "INSERT INTO balance_version_contributions (version_id, transaction_id, revision, account_id, date, amount, principal_amount, contribution)
                     VALUES (?1, ?2, ?3, ?4, ?5, ?6, ?7, ?8)",
                    params![version_id, id, revision, account_id, date, amount, principal, contribution.to_string()],
                )?;
            }
            // Check the new version against its own record straight away.
            let sum: Decimal = {
                let mut stmt = self
                    .conn
                    .prepare("SELECT contribution FROM balance_version_contributions WHERE version_id = ?1")?;
                let parts = stmt
                    .query_map(params![version_id], |r| r.get::<_, String>(0))?
                    .collect::<rusqlite::Result<Vec<_>>>()?;
                let mut s = Decimal::ZERO;
                for p in parts {
                    s = add_amount(s, parse_decimal(&p)?)?;
                }
                s
            };
            let base = parent_balance
                .or(opening)
                .ok_or_else(|| super::transaction_account_move::MoveError::Integrity("a corrected balance has no starting point".into()))?;
            if add_amount(base, sum)? != change.new_balance {
                return Err(super::transaction_account_move::MoveError::Integrity(format!(
                    "the corrected balance as of {} does not equal its recorded transactions",
                    pretty(change.cutoff)
                )));
            }
            let _ = dir;
            new_versions.insert(change.reset_id, (version_id, change.new_balance, change.cutoff));
            done.push((change.reset_id, change.old_version_id, version_id, change.old_balance, change.new_balance));
            after_each(n + 1)?;
        }
        Ok(done)
    }
}
