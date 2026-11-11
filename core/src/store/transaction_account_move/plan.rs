//! Building the move plan: loading rows, finding linked rows and computing blockers, warnings and balance effects.

use super::*;

impl Store {
    /// The sum of the amounts (principal part where one is set) of an account's live rows dated exactly `date`.
    pub(super) fn live_quantity_on(&self, account_id: i64, date: NaiveDate) -> Result<Decimal, MoveError> {
        let mut stmt = self
            .conn
            .prepare("SELECT COALESCE(principal_amount, amount) FROM transactions WHERE account_id = ?1 AND date = ?2 AND deleted_at IS NULL")?;
        let parts = stmt
            .query_map(params![account_id, date.to_string()], |r| r.get::<_, String>(0))?
            .collect::<rusqlite::Result<Vec<_>>>()?;
        let mut total = Decimal::ZERO;
        for p in parts {
            total = total
                .checked_add(crate::store::checkpoints::parse_decimal(&p)?)
                .ok_or_else(|| MoveError::InvalidBalance("An amount in this account is too large to add up.".to_string()))?;
        }
        Ok(total)
    }

    pub(super) fn account_info(&self, id: i64) -> Result<AccountInfo, MoveError> {
        let row = self.conn.query_row(
            "SELECT name, account_type, hidden, member_id, import_flip_signs, starting_balance FROM accounts WHERE id = ?1",
            params![id],
            |r| {
                Ok(AccountInfo {
                    name: r.get(0)?,
                    account_type: r.get(1)?,
                    hidden: r.get(2)?,
                    member_id: r.get(3)?,
                    import_flip_signs: r.get(4)?,
                    starting_balance: parse_decimal(&r.get::<_, String>(5)?)?,
                })
            },
        );
        match row {
            Ok(info) => Ok(info),
            Err(rusqlite::Error::QueryReturnedNoRows) => Err(MoveError::InvalidDestination("That account no longer exists.".to_string())),
            Err(e) => Err(e.into()),
        }
    }

    pub(super) fn load_rows(&self, ids: &[i64]) -> Result<Vec<LoadedRow>, MoveError> {
        let mut rows = Vec::with_capacity(ids.len());
        for chunk in ids.chunks(SQL_CHUNK) {
            let sql = format!(
                "SELECT id, account_id, date, description, amount, principal_amount, reconciliation_id, cleared, member_id, financial_revision
                 FROM transactions WHERE deleted_at IS NULL AND id IN ({})",
                placeholders(chunk.len())
            );
            let mut stmt = self.conn.prepare(&sql)?;
            let found = stmt.query_map(rusqlite::params_from_iter(chunk.iter()), |r| {
                let date_text: String = r.get(2)?;
                let amount_text: String = r.get(4)?;
                let principal: Option<String> = r.get(5)?;
                Ok(LoadedRow {
                    id: r.get(0)?,
                    account_id: r.get(1)?,
                    date: parse_date(&date_text)?,
                    date_text,
                    description: r.get(3)?,
                    amount: parse_decimal(&amount_text)?,
                    amount_text,
                    principal: principal.as_deref().map(parse_decimal).transpose()?,
                    reconciliation_id: r.get(6)?,
                    cleared: r.get(7)?,
                    member_id: r.get(8)?,
                    revision: r.get(9)?,
                })
            })?;
            for row in found {
                rows.push(row?);
            }
        }
        rows.sort_by_key(|r| r.id);
        Ok(rows)
    }

    /// Ids (among `ids`) that are one side of a linked transfer, or the source or generated row of a debt payment.
    pub(super) fn linked_ids(&self, ids: &[i64]) -> Result<(HashSet<i64>, HashSet<i64>), MoveError> {
        let (mut transfers, mut payments) = (HashSet::new(), HashSet::new());
        for chunk in ids.chunks(SQL_CHUNK) {
            let marks = placeholders(chunk.len());
            let mut args: Vec<i64> = chunk.to_vec();
            args.extend(chunk);
            let sql = format!(
                "SELECT out_transaction_id, in_transaction_id FROM transfer_links WHERE out_transaction_id IN ({marks}) OR in_transaction_id IN ({marks})"
            );
            let mut stmt = self.conn.prepare(&sql)?;
            for pair in stmt.query_map(rusqlite::params_from_iter(args.iter()), |r| {
                Ok((r.get::<_, i64>(0)?, r.get::<_, i64>(1)?))
            })? {
                let (a, b) = pair?;
                transfers.insert(a);
                transfers.insert(b);
            }
            let sql = format!(
                "SELECT source_transaction_id, generated_transaction_id FROM debt_payments WHERE source_transaction_id IN ({marks}) OR generated_transaction_id IN ({marks})"
            );
            let mut stmt = self.conn.prepare(&sql)?;
            for pair in stmt.query_map(rusqlite::params_from_iter(args.iter()), |r| {
                Ok((r.get::<_, i64>(0)?, r.get::<_, i64>(1)?))
            })? {
                let (a, b) = pair?;
                payments.insert(a);
                payments.insert(b);
            }
        }
        Ok((transfers, payments))
    }

    /// The whole plan for a move, from the data as it is right now.
    pub(super) fn build_plan(&self, ids: &[i64], destination: i64, today: NaiveDate, inputs: &[BalanceInput]) -> Result<Plan, MoveError> {
        let dest = self.account_info(destination)?;
        if dest.hidden {
            return Err(MoveError::InvalidDestination(format!(
                "{} is hidden, so transactions can't be moved to it. Show the account first.",
                dest.name
            )));
        }
        let rows = self.load_rows(ids)?;
        if rows.len() != ids.len() {
            let found: HashSet<i64> = rows.iter().map(|r| r.id).collect();
            let missing: Vec<i64> = ids.iter().copied().filter(|id| !found.contains(id)).collect();
            return Err(MoveError::UnknownTransactions { ids: missing });
        }

        let mut accounts: HashMap<i64, AccountInfo> = HashMap::new();
        accounts.insert(destination, dest);
        for row in &rows {
            if let std::collections::hash_map::Entry::Vacant(slot) = accounts.entry(row.account_id) {
                slot.insert(self.account_info(row.account_id)?);
            }
        }
        let dest = &accounts[&destination];

        let already_there_ids: Vec<i64> = rows.iter().filter(|r| r.account_id == destination).map(|r| r.id).collect();
        let effective_rows: Vec<&LoadedRow> = rows.iter().filter(|r| r.account_id != destination).collect();
        let effective_ids: Vec<i64> = effective_rows.iter().map(|r| r.id).collect();

        // Blockers, in a fixed order.
        let mut blocked: BTreeMap<i64, Vec<&'static str>> = BTreeMap::new();
        let mut blockers: Vec<MoveBlocker> = Vec::new();
        let describe = |r: &LoadedRow| format!("{} \"{}\" ({})", pretty_date(&r.date_text), r.description.trim(), r.amount_text);
        let mut add = |code: &'static str, summary: String, items: Vec<BlockedItem>, blocked: &mut BTreeMap<i64, Vec<&'static str>>| {
            if items.is_empty() {
                return;
            }
            for item in &items {
                blocked.entry(item.transaction_id).or_default().push(code);
            }
            blockers.push(MoveBlocker {
                code,
                count: items.len(),
                summary,
                items,
            });
        };

        let settled: Vec<BlockedItem> = effective_rows
            .iter()
            .filter(|r| r.reconciliation_id.is_some())
            .map(|r| BlockedItem {
                transaction_id: r.id,
                detail: format!(
                    "{} was already counted when you reconciled {}.",
                    describe(r),
                    accounts[&r.account_id].name
                ),
            })
            .collect();
        let n = settled.len();
        add(
            "settled",
            format!(
                "{} already counted in a finished reconciliation, which can't be changed.",
                plural(n, "transaction is", "transactions are")
            ),
            settled,
            &mut blocked,
        );

        let (transfers, payments) = self.linked_ids(&effective_ids)?;
        let linked: Vec<BlockedItem> = effective_rows
            .iter()
            .filter(|r| transfers.contains(&r.id))
            .map(|r| BlockedItem {
                transaction_id: r.id,
                detail: format!("{} is one side of a linked transfer.", describe(r)),
            })
            .collect();
        let n = linked.len();
        add(
            "linked_transfer",
            format!(
                "{} part of a linked transfer. Unlink the transfer first, then try again.",
                plural(n, "transaction is", "transactions are")
            ),
            linked,
            &mut blocked,
        );
        let applied: Vec<BlockedItem> = effective_rows
            .iter()
            .filter(|r| payments.contains(&r.id))
            .map(|r| BlockedItem {
                transaction_id: r.id,
                detail: format!("{} is part of a payment applied to a debt.", describe(r)),
            })
            .collect();
        let n = applied.len();
        add(
            "applied_debt_payment",
            format!(
                "{} part of a payment applied to a debt. Undo that first, then try again.",
                plural(n, "transaction is", "transactions are")
            ),
            applied,
            &mut blocked,
        );

        // Saved balances on either account dated on or after a moved row: corrected from their record where they
        // recorded what they counted, otherwise the person confirms the balance after the move.
        let mut affected_accounts: BTreeSet<i64> = effective_rows.iter().map(|r| r.account_id).collect();
        if !effective_rows.is_empty() {
            affected_accounts.insert(destination);
        }
        let mut account_plans: Vec<historical_move::AccountPlan> = Vec::new();
        for account_id in &affected_accounts {
            let info = &accounts[account_id];
            let incoming = *account_id == destination;
            let moving: Vec<historical_move::MovingRow> = effective_rows
                .iter()
                .filter(|r| incoming || r.account_id == *account_id)
                .map(|r| historical_move::MovingRow {
                    id: r.id,
                    date: r.date,
                    quantity: r.principal.unwrap_or(r.amount),
                    revision: r.revision,
                })
                .collect();
            account_plans.push(self.plan_account(*account_id, &info.account_type, info.starting_balance, &moving, incoming)?);
        }
        let damaged: Vec<&historical_move::AccountPlan> = account_plans
            .iter()
            .filter(|p| p.verdict == historical_move::Verdict::Integrity)
            .collect();
        let needs_confirmation = account_plans.iter().any(|p| p.verdict == historical_move::Verdict::NeedsConfirmation);
        let mut damage_items: Vec<BlockedItem> = Vec::new();
        for p in &damaged {
            let latest = p.reasons.first().cloned().unwrap_or_default();
            for r in &effective_rows {
                if r.account_id == p.account_id || destination == p.account_id {
                    damage_items.push(BlockedItem {
                        transaction_id: r.id,
                        detail: format!(
                            "{} touches {}, whose saved balances look damaged: {latest}.",
                            describe(r),
                            accounts[&p.account_id].name
                        ),
                    });
                }
            }
        }
        damage_items.sort_by_key(|i| i.transaction_id);
        damage_items.dedup_by_key(|i| i.transaction_id);
        let n = damage_items.len();
        add(
            "checkpoint_integrity",
            format!(
                "{} saved balances that look damaged, so nothing can be moved safely. Confirming a balance can't fix this.",
                plural(n, "transaction touches", "transactions touch")
            ),
            damage_items,
            &mut blocked,
        );
        let mut future_items: Vec<BlockedItem> = Vec::new();
        let mut holdings_items: Vec<BlockedItem> = Vec::new();
        if needs_confirmation && damaged.is_empty() {
            let holdings_now = self.holdings_value_by_account()?;
            for account_id in &affected_accounts {
                let future: Option<String> = self.conn.query_row(
                    "SELECT MAX(MAX(reset_date, COALESCE(effective_from, reset_date))) FROM balance_resets
                     WHERE account_id = ?1 AND (reset_date > ?2 OR COALESCE(effective_from, reset_date) > ?2)",
                    params![account_id, today.to_string()],
                    |r| r.get(0),
                )?;
                for r in &effective_rows {
                    if !(r.account_id == *account_id || destination == *account_id) {
                        continue;
                    }
                    if let Some(date) = &future {
                        future_items.push(BlockedItem {
                            transaction_id: r.id,
                            detail: format!(
                                "{} touches {}, which has a saved balance for {} that a confirmed balance would not be able to replace.",
                                describe(r),
                                accounts[account_id].name,
                                pretty_date(date)
                            ),
                        });
                    }
                    if accounts[account_id].account_type == "investment" && holdings_now.contains_key(account_id) {
                        holdings_items.push(BlockedItem {
                            transaction_id: r.id,
                            detail: format!(
                                "{} touches {}, which shows the value of its holdings. A holdings value can't be used as its cash balance.",
                                describe(r),
                                accounts[account_id].name
                            ),
                        });
                    }
                }
            }
        }
        future_items.sort_by_key(|i| i.transaction_id);
        future_items.dedup_by_key(|i| i.transaction_id);
        let n = future_items.len();
        add(
            "future_checkpoint",
            format!(
                "{} an account with a saved balance dated in the future. Move them after that date, or remove the future balance first.",
                plural(n, "transaction touches", "transactions touch")
            ),
            future_items,
            &mut blocked,
        );
        holdings_items.sort_by_key(|i| i.transaction_id);
        holdings_items.dedup_by_key(|i| i.transaction_id);
        let n = holdings_items.len();
        add(
            "holdings_confirmation",
            format!(
                "{} an investment account that shows its holdings value, so a balance can't be confirmed for it.",
                plural(n, "transaction touches", "transactions touch")
            ),
            holdings_items,
            &mut blocked,
        );

        // A principal override means something only on a loan.
        let dest_is_loan = dest.account_type == "loan";
        let override_items: Vec<BlockedItem> = effective_rows
            .iter()
            .filter(|r| r.principal.is_some() && !(dest_is_loan && accounts[&r.account_id].account_type == "loan"))
            .map(|r| BlockedItem {
                transaction_id: r.id,
                detail: format!("{} has a principal amount set, which only applies between loan accounts.", describe(r)),
            })
            .collect();
        let n = override_items.len();
        add(
            "principal_override",
            format!(
                "{} a principal amount that only applies between loans. Remove it first, then try again.",
                plural(n, "transaction has", "transactions have")
            ),
            override_items,
            &mut blocked,
        );

        // Duplicates: the fingerprint each moved row would get.
        let projected: Vec<(&LoadedRow, String)> = effective_rows
            .iter()
            .map(|r| {
                let fp = fingerprint(
                    destination,
                    &Transaction {
                        date: r.date,
                        description: r.description.clone(),
                        amount: r.amount,
                        category: None,
                    },
                );
                (*r, fp)
            })
            .collect();
        let mut taken: HashSet<String> = HashSet::new();
        let fps: Vec<&String> = projected.iter().map(|(_, fp)| fp).collect::<BTreeSet<_>>().into_iter().collect();
        for chunk in fps.chunks(SQL_CHUNK) {
            let sql = format!(
                "SELECT fingerprint FROM transactions WHERE account_id = ? AND deleted_at IS NULL AND fingerprint IN ({})",
                placeholders(chunk.len())
            );
            let mut args: Vec<rusqlite::types::Value> = vec![rusqlite::types::Value::Integer(destination)];
            args.extend(chunk.iter().map(|s| rusqlite::types::Value::Text((*s).clone())));
            let mut stmt = self.conn.prepare(&sql)?;
            for fp in stmt.query_map(rusqlite::params_from_iter(args), |r| r.get::<_, String>(0))? {
                taken.insert(fp?);
            }
        }
        let collides: Vec<BlockedItem> = projected
            .iter()
            .filter(|(_, fp)| taken.contains(fp))
            .map(|(r, _)| BlockedItem {
                transaction_id: r.id,
                detail: format!("{} matches a transaction already in {}.", describe(r), dest.name),
            })
            .collect();
        let n = collides.len();
        add(
            "duplicate_in_destination",
            format!(
                "{} the same as {} already in {}. Moving would create a duplicate, so nothing was moved.",
                plural(n, "transaction is", "transactions are"),
                if n == 1 { "one" } else { "ones" },
                dest.name
            ),
            collides,
            &mut blocked,
        );
        let mut groups: BTreeMap<&str, Vec<&LoadedRow>> = BTreeMap::new();
        for (r, fp) in &projected {
            groups.entry(fp.as_str()).or_default().push(r);
        }
        let mut converge: Vec<BlockedItem> = Vec::new();
        let mut kept_duplicates = 0usize;
        for (group_fp, rows_in_group) in &groups {
            if rows_in_group.len() < 2 {
                continue;
            }
            let sources: BTreeSet<i64> = rows_in_group.iter().map(|r| r.account_id).collect();
            if sources.len() > 1 {
                for r in rows_in_group {
                    converge.push(BlockedItem {
                        transaction_id: r.id,
                        detail: format!(
                            "{} matches a transaction from another account in this selection; together they would look like a duplicate.",
                            describe(r)
                        ),
                    });
                }
            } else if !taken.contains(*group_fp) {
                kept_duplicates += rows_in_group.len();
            }
        }
        converge.sort_by_key(|i| i.transaction_id);
        let n = converge.len();
        add(
            "duplicate_across_accounts",
            format!(
                "{} from different accounts would become identical in {}. Move them one account at a time after checking they are not a repeated file.",
                plural(n, "transaction", "transactions"),
                dest.name
            ),
            converge,
            &mut blocked,
        );

        // Warnings.
        let mut warnings: Vec<MoveWarning> = Vec::new();
        let ticked = effective_rows.iter().filter(|r| r.cleared && !blocked.contains_key(&r.id)).count();
        if ticked > 0 {
            warnings.push(MoveWarning {
                code: "ticks_cleared",
                count: ticked,
                detail: format!(
                    "{} you ticked for reconciling will be unticked, so tick again when you reconcile {}.",
                    plural(ticked, "transaction", "transactions"),
                    dest.name
                ),
            });
        }
        if kept_duplicates > 0 {
            warnings.push(MoveWarning {
                code: "duplicates_kept",
                count: kept_duplicates,
                detail: format!(
                    "{kept_duplicates} selected transactions are already identical to each other. All of them move; none is merged or removed."
                ),
            });
        }
        let differing_kind = effective_rows
            .iter()
            .filter(|r| accounts[&r.account_id].account_type != dest.account_type)
            .count();
        if differing_kind > 0 {
            warnings.push(MoveWarning {
                code: "account_kind_differs",
                count: differing_kind,
                detail: format!(
                    "{} from a different kind of account than {}. Amounts keep their signs, so check the balances below.",
                    plural(differing_kind, "transaction is", "transactions are"),
                    dest.name
                ),
            });
        }
        let member_differs = effective_rows.iter().filter(|r| r.member_id != dest.member_id).count();
        if member_differs > 0 {
            warnings.push(MoveWarning {
                code: "members_kept",
                count: member_differs,
                detail: format!(
                    "Each transaction keeps its own family member (or stays unassigned), even where {} is set up for someone else.",
                    dest.name
                ),
            });
        }
        let future = effective_rows.iter().filter(|r| r.date > today).count();
        if future > 0 {
            warnings.push(MoveWarning {
                code: "future_dated",
                count: future,
                detail: format!(
                    "{} dated in the future. They change the balances from their own date, not today's.",
                    plural(future, "transaction is", "transactions are")
                ),
            });
        }
        let reads_differently = |r: &&LoadedRow| match (accounts[&r.account_id].import_flip_signs, dest.import_flip_signs) {
            (Some(a), Some(b)) => a != b,
            _ => false,
        };
        if effective_rows.iter().any(reads_differently) {
            warnings.push(MoveWarning {
                code: "import_settings_differ",
                count: 1,
                detail: "The accounts remember different ways of reading imported amounts. Moving doesn't change those settings; review them if you import into these accounts again.".to_string(),
            });
        }

        // Balances.
        let holdings = self.holdings_value_by_account()?;
        let mode: &'static str = if needs_confirmation { "confirmation" } else { "automatic" };
        let mut effects: Vec<AccountEffect> = Vec::new();
        let mut projected_raw: BTreeMap<i64, Decimal> = BTreeMap::new();
        let mut current_raw: BTreeMap<i64, Decimal> = BTreeMap::new();
        let mut confirmations: Vec<ConfirmationAccount> = Vec::new();
        let mut anchors: Vec<AnchorPlan> = Vec::new();
        let mut counts: BTreeMap<i64, usize> = BTreeMap::new();
        for r in &effective_rows {
            *counts.entry(r.account_id).or_insert(0) += 1;
        }
        let net_of = |info: &AccountInfo, raw: Decimal, holdings_value: Option<Decimal>| -> rusqlite::Result<Decimal> {
            match (info.account_type.as_str(), holdings_value) {
                (_, Some(value)) => Ok(value),
                ("credit", _) => sub_amount(raw, info.starting_balance),
                ("loan", _) => Ok(-raw),
                _ => Ok(raw),
            }
        };
        let (mut net_before, mut net_after) = (Decimal::ZERO, Decimal::ZERO);
        let mut all_inputs_final = true;
        for account_id in &affected_accounts {
            let info = &accounts[account_id];
            let dir = historical_direction(&info.account_type);
            let raw = self.account_balance_as_of(*account_id, &info.account_type, info.starting_balance, today)?;
            let holdings_override = info.account_type == "investment" && holdings.contains_key(account_id);
            let account_plan = account_plans.iter().find(|p| p.account_id == *account_id);

            // What the saved balances and rows would make the balance, if corrected from their record.
            let used = self.latest_checkpoint_row(*account_id, today)?;
            let base_delta = used
                .as_ref()
                .and_then(|u| account_plan.and_then(|p| p.changes.iter().find(|c| c.reset_id == u.reset_id)))
                .map(|c| sub_amount(c.new_balance, c.old_balance))
                .transpose()?
                .unwrap_or(Decimal::ZERO);
            let mut rows_delta = Decimal::ZERO;
            for r in &effective_rows {
                if r.date <= today && used.as_ref().is_none_or(|u| r.date > u.cutoff) {
                    let q = r.principal.unwrap_or(r.amount);
                    if r.account_id == *account_id {
                        rows_delta = sub_amount(rows_delta, dir * q)?;
                    }
                    if destination == *account_id {
                        rows_delta = add_amount(rows_delta, dir * q)?;
                    }
                }
            }
            let automatic_projected = add_amount(add_amount(raw, base_delta)?, rows_delta)?;

            let (mut projected, mut projected_is_final) = (automatic_projected, true);
            if mode == "confirmation" {
                let reasons = account_plan.map(|p| p.reasons.clone()).unwrap_or_default();
                let owed_terms = matches!(info.account_type.as_str(), "credit" | "loan");
                let shown_now = match info.account_type.as_str() {
                    "credit" => sub_amount(info.starting_balance, raw)?,
                    _ => raw,
                };
                let input = inputs.iter().find(|i| i.account_id == *account_id);
                let mut entry = ConfirmationAccount {
                    account_id: *account_id,
                    account_name: info.name.clone(),
                    account_type: info.account_type.clone(),
                    input_label: if owed_terms { "Amount owed" } else { "Balance" },
                    current_display: shown_now.to_string(),
                    credit_limit: (info.account_type == "credit").then(|| info.starting_balance.to_string()),
                    available_credit: (info.account_type == "credit").then(|| raw.to_string()),
                    reasons: if reasons.is_empty() {
                        vec!["Another account in this move needs its balance confirmed, so every account in it is confirmed together.".to_string()]
                    } else {
                        reasons
                    },
                    confirmed_display: None,
                    choice: None,
                    projected_baseline: None,
                    problem: None,
                };
                projected = raw;
                projected_is_final = false;
                if let Some(input) = input {
                    let parsed = if input.keep {
                        entry.choice = Some("keep");
                        Ok(shown_now)
                    } else {
                        entry.choice = Some("set");
                        parse_confirmed(&info.account_type, input.value.as_deref().unwrap_or(""))
                    };
                    match parsed {
                        Ok(shown) => {
                            let confirmed_raw = if info.account_type == "credit" {
                                sub_amount(info.starting_balance, shown)?
                            } else {
                                shown
                            };
                            let moved_today: Decimal = effective_rows
                                .iter()
                                .filter(|r| r.date == today)
                                .filter(|r| r.account_id == *account_id || destination == *account_id)
                                .try_fold(Decimal::ZERO, |sum, r| add_amount(sum, r.principal.unwrap_or(r.amount)))?;
                            let present_today = self.live_quantity_on(*account_id, today)?;
                            let activity_today = if destination == *account_id {
                                add_amount(present_today, moved_today)?
                            } else {
                                sub_amount(present_today, moved_today)?
                            };
                            match confirmed_raw.checked_sub(dir * activity_today) {
                                Some(baseline) if baseline.abs() < Decimal::new(1_000_000_000_000_000, 0) => {
                                    entry.confirmed_display = Some(shown.to_string());
                                    entry.projected_baseline = Some(baseline.to_string());
                                    anchors.push(AnchorPlan {
                                        account_id: *account_id,
                                        confirmed_raw,
                                        baseline,
                                    });
                                    projected = confirmed_raw;
                                    projected_is_final = true;
                                }
                                _ => entry.problem = Some("That amount is too large to save.".to_string()),
                            }
                        }
                        Err(problem) => entry.problem = Some(problem),
                    }
                }
                if entry.confirmed_display.is_none() {
                    all_inputs_final = false;
                }
                confirmations.push(entry);
            }

            current_raw.insert(*account_id, raw);
            projected_raw.insert(*account_id, projected);
            let held = holdings_override.then(|| holdings[account_id]);
            net_before = add_amount(net_before, net_of(info, raw, held)?)?;
            net_after = add_amount(net_after, net_of(info, projected, held)?)?;
            let (label, shown_current, shown_projected) = match info.account_type.as_str() {
                "credit" => (
                    "Owed",
                    sub_amount(info.starting_balance, raw)?,
                    sub_amount(info.starting_balance, projected)?,
                ),
                "loan" => ("Owed", raw, projected),
                "investment" if holdings_override => ("Holdings value", holdings[account_id], holdings[account_id]),
                _ => ("Balance", raw, projected),
            };
            let is_credit = info.account_type == "credit";
            effects.push(AccountEffect {
                account_id: *account_id,
                account_name: info.name.clone(),
                account_type: info.account_type.clone(),
                role: if *account_id == destination { "destination" } else { "source" },
                moved_count: if *account_id == destination {
                    effective_rows.len()
                } else {
                    counts.get(account_id).copied().unwrap_or(0)
                },
                label,
                current: shown_current.to_string(),
                projected: shown_projected.to_string(),
                available_current: is_credit.then(|| raw.to_string()),
                available_projected: is_credit.then(|| projected.to_string()),
                transaction_change: sub_amount(projected, raw)?.to_string(),
                holdings_override,
                projected_is_final,
            });
        }
        if effects.iter().any(|e| e.holdings_override) {
            let names: Vec<&str> = effects.iter().filter(|e| e.holdings_override).map(|e| e.account_name.as_str()).collect();
            warnings.push(MoveWarning {
                code: "holdings_value",
                count: names.len(),
                detail: if names.len() == 1 {
                    format!(
                        "{} shows its holdings value, which doesn't change when transactions move. Only its cash activity does.",
                        names[0]
                    )
                } else {
                    format!(
                        "{} show their holdings value, which doesn't change when transactions move. Only their cash activity does.",
                        names.join(" and ")
                    )
                },
            });
        }
        let corrected_count: usize = account_plans.iter().map(|p| p.changes.len()).sum();
        let mut checkpoint_notes: Vec<String> = Vec::new();
        let affected_cutoffs: Vec<NaiveDate> = account_plans.iter().flat_map(|p| p.affected_cutoffs.iter().copied()).collect();
        if mode == "automatic" && corrected_count > 0 {
            checkpoint_notes.push(format!(
                "{} saved {} will be corrected from what each one recorded, so today's balances and the history agree.",
                corrected_count,
                if corrected_count == 1 { "balance" } else { "balances" }
            ));
        }
        if mode == "confirmation" {
            checkpoint_notes.push("Your transactions will move. The balances you confirm will apply from today. Older saved balances cannot be reconstructed from the available records.".to_string());
            checkpoint_notes.push("Older saved balances keep their values, so reports that use transactions may show them under the new account, and history near an old saved balance can have gaps.".to_string());
        }
        if mode == "automatic" && net_before != net_after {
            checkpoint_notes.push(format!(
                "Together these accounts go from {net_before} to {net_after}. The saved balance of the account a transaction left never counted it, so no matching amount is added back."
            ));
        }

        // Summaries.
        let mut sources: BTreeMap<i64, usize> = BTreeMap::new();
        for r in &effective_rows {
            *sources.entry(r.account_id).or_insert(0) += 1;
        }
        let total = effective_rows.iter().try_fold(Decimal::ZERO, |sum, r| add_amount(sum, r.amount))?;
        let (first_date, last_date) = (
            effective_rows.iter().map(|r| r.date_text.clone()).min(),
            effective_rows.iter().map(|r| r.date_text.clone()).max(),
        );
        let preview_rows: Vec<MoveRow> = rows
            .iter()
            .map(|r| MoveRow {
                id: r.id,
                date: r.date_text.clone(),
                description: r.description.clone(),
                amount: r.amount_text.clone(),
                account_id: r.account_id,
                account_name: accounts[&r.account_id].name.clone(),
                status: if r.account_id == destination {
                    "already_there"
                } else if blocked.contains_key(&r.id) {
                    "blocked"
                } else {
                    "move"
                },
            })
            .collect();

        let mut preview = MovePreview {
            destination_account_id: destination,
            destination_name: dest.name.clone(),
            as_of: today.to_string(),
            selected_count: rows.len(),
            effective_count: effective_rows.len(),
            already_there_count: already_there_ids.len(),
            normalized_ids: ids.to_vec(),
            sources: sources
                .iter()
                .map(|(id, count)| SourceSummary {
                    account_id: *id,
                    account_name: accounts[id].name.clone(),
                    count: *count,
                })
                .collect(),
            first_date,
            last_date,
            total: total.to_string(),
            rows: preview_rows,
            effects,
            warnings,
            blockers,
            can_commit: false,
            status: "ready",
            mode,
            confirmations,
            checkpoint_effects: CheckpointEffects {
                corrected_count,
                first_date: affected_cutoffs.iter().min().map(|d| d.to_string()),
                last_date: affected_cutoffs.iter().max().map(|d| d.to_string()),
                notes: checkpoint_notes,
            },
            net_before: net_before.to_string(),
            net_after: net_after.to_string(),
            token: String::new(),
        };
        preview.can_commit = preview.blockers.is_empty() && preview.effective_count > 0 && (mode == "automatic" || all_inputs_final);
        preview.status = if !preview.blockers.is_empty() {
            "blocked"
        } else if mode == "confirmation" && preview.effective_count > 0 && !all_inputs_final {
            "needs_balance_confirmation"
        } else {
            "ready"
        };
        let state = self.plan_state_fingerprint(&affected_accounts, &effective_rows)?;
        preview.token = plan_token(&preview, &effective_rows, &state);

        let effective: Vec<(LoadedRow, String)> = {
            let fp_of: HashMap<i64, String> = projected.iter().map(|(r, fp)| (r.id, fp.clone())).collect();
            let wanted: HashSet<i64> = effective_ids.iter().copied().collect();
            let mut taken_rows: Vec<LoadedRow> = Vec::new();
            for r in rows {
                if wanted.contains(&r.id) {
                    taken_rows.push(r);
                }
            }
            taken_rows
                .into_iter()
                .map(|r| {
                    let fp = fp_of[&r.id].clone();
                    (r, fp)
                })
                .collect()
        };
        Ok(Plan {
            preview,
            effective,
            already_there_ids,
            projected_raw,
            current_raw,
            mode,
            account_plans,
            anchors,
            corrected_count,
            holdings_before: holdings,
        })
    }

    /// Saved-balance and account state the plan depends on but the preview does not print.
    pub(super) fn plan_state_fingerprint(&self, accounts: &BTreeSet<i64>, rows: &[&LoadedRow]) -> Result<String, MoveError> {
        let mut out = String::new();
        for account_id in accounts {
            let resets: String = self.conn.query_row(
                "SELECT COALESCE(group_concat(id || ':' || COALESCE(current_version_id, '') || ':' || balance || ':' || reset_date || ':' || COALESCE(effective_from, ''), '|'), '')
                 FROM (SELECT * FROM balance_resets WHERE account_id = ?1 ORDER BY id)",
                params![account_id],
                |r| r.get(0),
            )?;
            let (kind, start): (String, String) = self.conn.query_row(
                "SELECT account_type, starting_balance FROM accounts WHERE id = ?1",
                params![account_id],
                |r| Ok((r.get(0)?, r.get(1)?)),
            )?;
            out.push_str(&format!("#{account_id}:{kind}:{start}:{resets}"));
        }
        out.push_str(&format!("|{}", rows.len()));
        Ok(out)
    }
}
