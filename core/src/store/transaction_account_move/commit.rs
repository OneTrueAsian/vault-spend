//! Executing a reviewed move: the immediate write transaction, the history records and the review-state cleanup.

use super::*;

impl Store {
    pub(super) fn commit_move(
        &self,
        ids: &[i64],
        destination: i64,
        expected_token: Option<&str>,
        today: NaiveDate,
        operation: Option<(&str, &[BalanceInput])>,
        failpoint: Option<MoveFailpoint>,
    ) -> Result<MoveOutcome, MoveError> {
        let ids = normalize_move_ids(ids)?;
        let inputs: &[BalanceInput] = operation.map(|o| o.1).unwrap_or(&[]);
        if let Some((operation_id, _)) = operation
            && (operation_id.is_empty()
                || operation_id.len() > 80
                || !operation_id.chars().all(|c| c.is_ascii_alphanumeric() || c == '-' || c == '_'))
        {
            return Err(MoveError::InvalidBalance(
                "That request has no valid identity. Review the move again.".to_string(),
            ));
        }
        let write = WriteTx::begin(&self.conn)?;

        // A retry of a request that already committed gets the first answer back, whatever the data is now.
        let digest = request_digest(&ids, destination, expected_token, today, inputs);
        if let Some((operation_id, _)) = operation {
            let earlier: Option<(String, String)> = self
                .conn
                .query_row(
                    "SELECT request_digest, result_json FROM account_move_operations WHERE operation_id = ?1",
                    params![operation_id],
                    |r| Ok((r.get(0)?, r.get(1)?)),
                )
                .optional()?;
            if let Some((stored, result)) = earlier {
                if stored != digest {
                    return Ok(MoveOutcome::OperationConflict);
                }
                let value: serde_json::Value =
                    serde_json::from_str(&result).map_err(|_| MoveError::Integrity("a saved move result is unreadable".into()))?;
                let list = |key: &str| -> Vec<i64> {
                    value[key]
                        .as_array()
                        .map(|a| a.iter().filter_map(|v| v.as_i64()).collect())
                        .unwrap_or_default()
                };
                return Ok(MoveOutcome::Moved(MoveSummary {
                    moved_ids: list("movedIds"),
                    already_there_ids: list("alreadyThereIds"),
                    affected_account_ids: list("affectedAccountIds"),
                    mode: if value["mode"] == "confirmation" { "confirmation" } else { "automatic" },
                    operation_id: Some(operation_id.to_string()),
                    replayed: true,
                    corrected_checkpoints: value["correctedCheckpoints"].as_u64().unwrap_or(0) as usize,
                    confirmed_account_ids: list("confirmedAccountIds"),
                }));
            }
        }

        let plan = self.build_plan(&ids, destination, today, inputs)?;
        if let Some(expected) = expected_token
            && plan.preview.token != expected
        {
            return Ok(MoveOutcome::StalePreview);
        }
        if !plan.preview.blockers.is_empty() {
            return Ok(MoveOutcome::Blocked(plan.preview.blockers));
        }
        if plan.effective.is_empty() {
            return Ok(MoveOutcome::NothingToMove(MoveSummary {
                moved_ids: Vec::new(),
                already_there_ids: plan.already_there_ids,
                affected_account_ids: Vec::new(),
                mode: "automatic",
                operation_id: None,
                replayed: false,
                corrected_checkpoints: 0,
                confirmed_account_ids: Vec::new(),
            }));
        }
        if expected_token.is_none() && (plan.mode == "confirmation" || plan.corrected_count > 0) {
            return Err(MoveError::ReviewRequired(
                "These transactions are dated before a saved balance, so the move needs the review that corrects or confirms it. Use Move to account.".to_string(),
            ));
        }
        if !plan.preview.can_commit {
            return Err(MoveError::InvalidBalance(
                "Confirm a balance for every account in this move first.".to_string(),
            ));
        }

        let fail = |point: MoveFailpoint, what: &'static str| -> Result<(), MoveError> {
            if failpoint == Some(point) {
                Err(MoveError::Injected(what))
            } else {
                Ok(())
            }
        };
        let operation_id: String = operation
            .map(|o| o.0.to_string())
            .unwrap_or_else(|| auto_operation_id(&ids, destination, expected_token.unwrap_or("")));
        let revision_before: i64 = self
            .conn
            .query_row("SELECT value FROM financial_revision_counter WHERE id = 1", [], |r| r.get(0))?;

        {
            let mut update = self.conn.prepare(
                "UPDATE transactions SET account_id = ?1, fingerprint = ?2, cleared = 0
                 WHERE id = ?3 AND account_id = ?4 AND deleted_at IS NULL AND reconciliation_id IS NULL",
            )?;
            for (n, (row, fp)) in plan.effective.iter().enumerate() {
                let changed = update.execute(params![destination, fp, row.id, row.account_id])?;
                if changed != 1 {
                    return Err(MoveError::Db(rusqlite::Error::StatementChangedRows(changed)));
                }
                fail(MoveFailpoint::AfterUpdate(n + 1), "after a row was updated")?;
            }
        }

        // Saved balances: corrected from their record, or a confirmed anchor for each account.
        let mut corrections_json: Vec<serde_json::Value> = Vec::new();
        let mut corrected = 0usize;
        let mut confirmed_ids: Vec<i64> = Vec::new();
        if plan.mode == "automatic" {
            for account_plan in plan.account_plans.iter().filter(|p| !p.changes.is_empty()) {
                let info = self.account_info(account_plan.account_id)?;
                let done = self.apply_node_changes(
                    account_plan.account_id,
                    &info.account_type,
                    &account_plan.changes,
                    &operation_id,
                    &mut |_| {
                        corrected += 1;
                        fail(MoveFailpoint::AfterCorrection(corrected), "after a saved balance was corrected")
                    },
                )?;
                for (reset_id, old_version, new_version, old_balance, new_balance) in done {
                    corrections_json.push(serde_json::json!({
                        "accountId": account_plan.account_id, "resetId": reset_id, "oldVersionId": old_version, "newVersionId": new_version,
                        "oldBalance": old_balance.to_string(), "newBalance": new_balance.to_string(),
                    }));
                }
            }
        } else {
            let cutoff = today
                .pred_opt()
                .ok_or_else(|| MoveError::InvalidBalance("That date can't be used.".to_string()))?;
            for (n, anchor) in plan.anchors.iter().enumerate() {
                let info = self.account_info(anchor.account_id)?;
                let dir = historical_direction(&info.account_type);
                let live_today = self.live_quantity_on(anchor.account_id, today)?;
                let baseline = anchor
                    .confirmed_raw
                    .checked_sub(dir * live_today)
                    .ok_or_else(|| MoveError::InvalidBalance("That amount is too large to save.".to_string()))?;
                if baseline != anchor.baseline {
                    return Err(MoveError::Integrity(
                        "the confirmed balance no longer matches today's activity".to_string(),
                    ));
                }
                let period = format!("move:{operation_id}:{}", anchor.account_id);
                let reset_id = self.record_anchor(crate::store::checkpoints::AnchorSpec {
                    account_id: anchor.account_id,
                    period: &period,
                    cutoff,
                    effective: today,
                    balance: baseline,
                    kind: CheckpointKind::MoveConfirmation,
                    operation_id: Some(&operation_id),
                })?;
                confirmed_ids.push(anchor.account_id);
                corrections_json.push(serde_json::json!({
                    "accountId": anchor.account_id, "resetId": reset_id, "anchor": true, "baseline": baseline.to_string(), "confirmedRaw": anchor.confirmed_raw.to_string(),
                }));
                fail(MoveFailpoint::AfterAnchor(n + 1), "after a confirmed balance was saved")?;
            }
        }

        self.clear_account_dependent_review_state(&plan.effective, destination)?;
        fail(MoveFailpoint::AfterReviewCleanup, "after the review decisions were cleared")?;

        // Read the result back with the same balance rules the app uses; a mismatch rolls everything back.
        for (account_id, projected) in &plan.projected_raw {
            let info = self.account_info(*account_id)?;
            let actual = self.account_balance_as_of(*account_id, &info.account_type, info.starting_balance, today)?;
            if actual != *projected {
                return Err(MoveError::Db(rusqlite::Error::ToSqlConversionFailure(
                    format!("account {account_id} balance would be {actual}, expected {projected}").into(),
                )));
            }
        }
        if self.holdings_value_by_account()? != plan.holdings_before {
            return Err(MoveError::Db(rusqlite::Error::ToSqlConversionFailure(
                "an account's holdings value changed".into(),
            )));
        }
        let moved_ids: Vec<i64> = plan.effective.iter().map(|(r, _)| r.id).collect();
        let still_there: i64 = {
            let mut count = 0i64;
            for chunk in moved_ids.chunks(SQL_CHUNK) {
                let sql = format!(
                    "SELECT COUNT(*) FROM transactions WHERE account_id = ? AND id IN ({})",
                    placeholders(chunk.len())
                );
                let mut args: Vec<i64> = vec![destination];
                args.extend(chunk);
                count += self.conn.query_row(&sql, rusqlite::params_from_iter(args), |r| r.get::<_, i64>(0))?;
            }
            count
        };
        if still_there != moved_ids.len() as i64 {
            return Err(MoveError::Db(rusqlite::Error::ToSqlConversionFailure(
                "moved rows are not all in the destination".into(),
            )));
        }
        // Only the moved rows may have changed financially.
        let changed_rows: i64 = self.conn.query_row(
            "SELECT COUNT(*) FROM transactions WHERE financial_revision > ?1",
            params![revision_before],
            |r| r.get(0),
        )?;
        if changed_rows != moved_ids.len() as i64 {
            return Err(MoveError::Db(rusqlite::Error::ToSqlConversionFailure(
                "a transaction that was not moved changed".into(),
            )));
        }
        fail(MoveFailpoint::AfterReadback, "after the result was checked")?;

        // The audit record and the retry answer are written with everything else, or not at all.
        let mut affected: BTreeSet<i64> = plan.effective.iter().map(|(r, _)| r.account_id).collect();
        affected.insert(destination);
        let after_rows: Vec<serde_json::Value> = moved_ids
            .iter()
            .map(|id| {
                self.conn
                    .query_row(
                        "SELECT account_id, financial_revision, fingerprint, cleared FROM transactions WHERE id = ?1",
                        params![id],
                        |r| Ok(serde_json::json!({ "id": id, "accountId": r.get::<_, i64>(0)?, "revision": r.get::<_, i64>(1)?, "fingerprint": r.get::<_, String>(2)?, "cleared": r.get::<_, bool>(3)? })),
                    )
                    .map_err(MoveError::from)
            })
            .collect::<Result<_, _>>()?;
        let before_rows: Vec<serde_json::Value> = plan
            .effective
            .iter()
            .map(|(r, _)| serde_json::json!({ "id": r.id, "accountId": r.account_id, "date": r.date_text, "amount": r.amount_text, "revision": r.revision, "cleared": r.cleared }))
            .collect();
        let account_effects: Vec<serde_json::Value> = plan
            .preview
            .effects
            .iter()
            .map(|e| serde_json::json!({
                "accountId": e.account_id, "name": e.account_name, "role": e.role, "label": e.label,
                "displayedBefore": e.current, "displayedAfter": e.projected,
                "rawBefore": plan.current_raw.get(&e.account_id).map(|v| v.to_string()), "rawAfter": plan.projected_raw.get(&e.account_id).map(|v| v.to_string()),
            }))
            .collect();
        let inputs_json: Vec<serde_json::Value> = plan
            .preview
            .confirmations
            .iter()
            .map(|c| serde_json::json!({ "accountId": c.account_id, "choice": c.choice, "confirmed": c.confirmed_display, "baseline": c.projected_baseline }))
            .collect();
        let result = serde_json::json!({
            "movedIds": moved_ids, "alreadyThereIds": plan.already_there_ids, "affectedAccountIds": affected.iter().collect::<Vec<_>>(),
            "mode": plan.mode, "correctedCheckpoints": corrected, "confirmedAccountIds": confirmed_ids,
        });
        self.conn.execute(
            "INSERT INTO account_move_operations (operation_id, request_digest, contract_version, algorithm_version, mode, effective_date, destination_account_id,
                 moved_count, inputs_json, before_json, after_json, corrections_json, result_json)
             VALUES (?1, ?2, 2, ?3, ?4, ?5, ?6, ?7, ?8, ?9, ?10, ?11, ?12)",
            params![
                operation_id,
                digest,
                crate::store::checkpoints::ALGORITHM_VERSION,
                plan.mode,
                today.to_string(),
                destination,
                moved_ids.len() as i64,
                serde_json::Value::Array(inputs_json).to_string(),
                serde_json::json!({ "rows": before_rows, "accounts": account_effects }).to_string(),
                serde_json::json!({ "rows": after_rows }).to_string(),
                serde_json::Value::Array(corrections_json).to_string(),
                result.to_string(),
            ],
        )?;
        fail(MoveFailpoint::AfterAudit, "after the move was recorded")?;
        #[cfg(test)]
        if failpoint == Some(MoveFailpoint::CrashBeforeCommit) {
            std::process::abort();
        }
        write.commit()?;
        #[cfg(test)]
        if failpoint == Some(MoveFailpoint::CrashAfterCommit) {
            std::process::abort();
        }

        let mut by_source: BTreeMap<i64, usize> = BTreeMap::new();
        for (row, _) in &plan.effective {
            *by_source.entry(row.account_id).or_insert(0) += 1;
        }
        let source_names: Vec<String> = by_source
            .iter()
            .map(|(id, n)| format!("{} ({n})", self.account_name_for_log(*id)))
            .collect();
        self.log_activity(&format!(
            "moved {} transaction{} to {} from {}; {} already there",
            moved_ids.len(),
            if moved_ids.len() == 1 { "" } else { "s" },
            self.account_name_for_log(destination),
            source_names.join(", "),
            plan.already_there_ids.len()
        ));
        Ok(MoveOutcome::Moved(MoveSummary {
            moved_ids,
            already_there_ids: plan.already_there_ids,
            affected_account_ids: affected.into_iter().collect(),
            mode: plan.mode,
            operation_id: Some(operation_id),
            replayed: false,
            corrected_checkpoints: corrected,
            confirmed_account_ids: confirmed_ids,
        }))
    }

    /// One earlier move, read back from its audit record (see `list_account_moves`).
    pub fn get_account_move(&self, operation_id: &str) -> Result<Option<AccountMoveRecord>, MoveError> {
        Ok(self
            .read_account_moves("WHERE operation_id = ?1", params![operation_id])?
            .into_iter()
            .next())
    }

    /// The moves recorded in this profile, newest first.
    pub fn list_account_moves(&self, limit: usize) -> Result<Vec<AccountMoveRecord>, MoveError> {
        Ok(self.read_account_moves("ORDER BY rowid DESC LIMIT ?1", params![limit as i64])?)
    }

    pub(super) fn read_account_moves(&self, tail: &str, args: impl rusqlite::Params) -> rusqlite::Result<Vec<AccountMoveRecord>> {
        let sql = format!(
            "SELECT operation_id, mode, effective_date, destination_account_id, moved_count, before_json, corrections_json, result_json, inputs_json
             FROM account_move_operations {tail}"
        );
        let mut stmt = self.conn.prepare(&sql)?;
        let rows = stmt
            .query_map(args, |r| {
                Ok((
                    r.get::<_, String>(0)?,
                    r.get::<_, String>(1)?,
                    r.get::<_, String>(2)?,
                    r.get::<_, i64>(3)?,
                    r.get::<_, i64>(4)?,
                    r.get::<_, String>(5)?,
                    r.get::<_, String>(6)?,
                    r.get::<_, String>(7)?,
                    r.get::<_, String>(8)?,
                ))
            })?
            .collect::<rusqlite::Result<Vec<_>>>()?;
        let parse = |s: &str| serde_json::from_str::<serde_json::Value>(s).unwrap_or(serde_json::Value::Null);
        Ok(rows
            .into_iter()
            .map(
                |(operation_id, mode, effective_date, destination, moved_count, before, corrections, result, inputs)| {
                    let before = parse(&before);
                    let result = parse(&result);
                    let ids = |key: &str| -> Vec<i64> {
                        result[key]
                            .as_array()
                            .map(|a| a.iter().filter_map(|v| v.as_i64()).collect())
                            .unwrap_or_default()
                    };
                    AccountMoveRecord {
                        destination_name: self.account_name_for_log(destination),
                        destination_account_id: destination,
                        mode: if mode == "confirmation" { "confirmation" } else { "automatic" },
                        effective_date,
                        moved_count: moved_count as usize,
                        moved_ids: ids("movedIds"),
                        affected_account_ids: ids("affectedAccountIds"),
                        confirmed_account_ids: ids("confirmedAccountIds"),
                        corrected_checkpoints: result["correctedCheckpoints"].as_u64().unwrap_or(0) as usize,
                        accounts: before["accounts"].clone(),
                        inputs: parse(&inputs),
                        corrections: parse(&corrections).as_array().map(|a| a.len()).unwrap_or(0),
                        operation_id,
                    }
                },
            )
            .collect())
    }

    /// Account ownership changed the context of these rows, so decisions made about them in the old context
    /// are forgotten: transfer suggestions the person dismissed or rejected, and "not a duplicate" answers for
    /// the moved rows and for look-alikes in the accounts involved. Decisions about anything else stay.
    pub(super) fn clear_account_dependent_review_state(&self, moved: &[(LoadedRow, String)], destination: i64) -> Result<(), MoveError> {
        let ids: Vec<i64> = moved.iter().map(|(r, _)| r.id).collect();
        for chunk in ids.chunks(SQL_CHUNK) {
            let marks = placeholders(chunk.len());
            let mut doubled: Vec<i64> = chunk.to_vec();
            doubled.extend(chunk);
            for table in ["transfer_candidate_dismissals", "transfer_link_rejections"] {
                self.conn.execute(
                    &format!("DELETE FROM {table} WHERE out_transaction_id IN ({marks}) OR in_transaction_id IN ({marks})"),
                    rusqlite::params_from_iter(doubled.iter()),
                )?;
            }
            self.conn.execute(
                &format!("DELETE FROM anomaly_dismissals WHERE kind = 'duplicate' AND transaction_id IN ({marks})"),
                rusqlite::params_from_iter(chunk.iter()),
            )?;
        }
        // Look-alikes (same amount and same description once numbers are dropped, within three days) in the
        // destination and in each source account, whose "possible duplicate" answer was given with the old
        // neighbours in view.
        let mut accounts: BTreeSet<i64> = moved.iter().map(|(r, _)| r.account_id).collect();
        accounts.insert(destination);
        let mut keys: BTreeSet<(String, String)> = BTreeSet::new();
        for (r, _) in moved {
            keys.insert((r.amount_text.clone(), normalize_description(&r.description)));
        }
        let mut peers: BTreeSet<i64> = BTreeSet::new();
        for account_id in accounts {
            let mut stmt = self.conn.prepare("SELECT id, date, description, amount FROM transactions WHERE account_id = ?1 AND deleted_at IS NULL AND id IN (SELECT transaction_id FROM anomaly_dismissals WHERE kind = 'duplicate')")?;
            let dismissed = stmt
                .query_map(params![account_id], |r| {
                    Ok((
                        r.get::<_, i64>(0)?,
                        r.get::<_, String>(1)?,
                        r.get::<_, String>(2)?,
                        r.get::<_, String>(3)?,
                    ))
                })?
                .collect::<rusqlite::Result<Vec<_>>>()?;
            for (id, date, description, amount) in dismissed {
                if !keys.contains(&(amount.clone(), normalize_description(&description))) {
                    continue;
                }
                let date = NaiveDate::parse_from_str(&date, "%Y-%m-%d").expect("dates stored by this crate are valid");
                let near = moved.iter().any(|(m, _)| {
                    (m.date - date).num_days().abs() <= 3
                        && m.amount_text == amount
                        && normalize_description(&m.description) == normalize_description(&description)
                });
                if near {
                    peers.insert(id);
                }
            }
        }
        for id in peers {
            self.conn.execute(
                "DELETE FROM anomaly_dismissals WHERE kind = 'duplicate' AND transaction_id = ?1",
                params![id],
            )?;
        }
        Ok(())
    }
}
