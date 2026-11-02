use super::historical_account_moves::{T, bal, d, day, legacy_reset};
use super::transaction_account_move::dump;
use super::*;
use crate::store::{BalanceInput, MoveOutcome, MoveRequest};
use rust_decimal::Decimal;

// A small independent reference model of balances, recorded versus typed saved balances, confirmed anchors and move
// correction, driven by fixed seeds. It shares no code with the planner or the balance reader: money is integer
// cents, days are integers, and every rule below is written from the plan, not from the implementation.

const TODAY: i32 = 58; // 2026-10-29, counting 2026-09-01 as day 0
const SAMPLE_DAYS: [i32; 9] = [5, 20, 33, 47, 56, 57, 58, 59, 75];
const OPENING: [i64; 3] = [100_000, 50_000, 20_000];

fn date_of(offset: i32) -> String {
    (day("2026-09-01") + chrono::Duration::days(offset as i64)).to_string()
}

fn cents(c: i64) -> String {
    Decimal::new(c, 2).to_string()
}

struct Rng(u64);
impl Rng {
    fn next(&mut self) -> u64 {
        self.0 ^= self.0 << 13;
        self.0 ^= self.0 >> 7;
        self.0 ^= self.0 << 17;
        self.0
    }
    fn below(&mut self, n: u64) -> u64 {
        self.next() % n
    }
}

#[derive(Clone)]
struct MRow {
    acct: usize,
    date: i32,
    amount: i64,
    live: bool,
    rev: u64,
    id: i64,
}

#[derive(Clone)]
struct MNode {
    acct: usize,
    cutoff: i32,
    effective: i32,
    balance: i64,
    /// True only for a balance that recorded what it counted and has not been invalidated.
    recorded: bool,
    members: std::collections::BTreeMap<usize, u64>, // row index -> revision it was counted at
    parent: Option<usize>,
    parent_cutoff: Option<i32>,
    capture_rev: u64,
    period: String,
}

struct Model {
    rows: Vec<MRow>,
    nodes: Vec<MNode>,
    rev: u64,
}

impl Model {
    fn eligible(&self, acct: usize, on: i32) -> Option<usize> {
        self.nodes
            .iter()
            .enumerate()
            .filter(|(_, n)| n.acct == acct && n.effective <= on && n.cutoff <= on)
            .max_by_key(|(i, n)| (n.effective, n.cutoff, *i))
            .map(|(i, _)| i)
    }
    fn balance(&self, acct: usize, on: i32) -> i64 {
        let (base, after) = match self.eligible(acct, on) {
            Some(i) => (self.nodes[i].balance, Some(self.nodes[i].cutoff)),
            None => (OPENING[acct], None),
        };
        base + self
            .rows
            .iter()
            .filter(|r| r.acct == acct && r.live && after.is_none_or(|c| r.date > c) && r.date <= on)
            .map(|r| r.amount)
            .sum::<i64>()
    }
    fn capture(&mut self, acct: usize, cutoff: i32, period: String) {
        let parent = self.eligible(acct, cutoff);
        let (base, after) = match parent {
            Some(p) => (self.nodes[p].balance, Some(self.nodes[p].cutoff)),
            None => (OPENING[acct], None),
        };
        let members: std::collections::BTreeMap<usize, u64> = self
            .rows
            .iter()
            .enumerate()
            .filter(|(_, r)| r.acct == acct && r.live && r.date <= cutoff && after.is_none_or(|c| r.date > c))
            .map(|(i, r)| (i, r.rev))
            .collect();
        let balance = base + members.keys().map(|i| self.rows[*i].amount).sum::<i64>();
        self.nodes.push(MNode {
            acct,
            cutoff,
            effective: cutoff,
            balance,
            recorded: true,
            members,
            parent,
            parent_cutoff: after,
            capture_rev: self.rev,
            period,
        });
    }
    fn descendants(&self, node: usize) -> Vec<usize> {
        let mut out = Vec::new();
        let mut frontier = vec![node];
        while let Some(n) = frontier.pop() {
            for (i, c) in self.nodes.iter().enumerate() {
                if c.parent == Some(n) && !out.contains(&i) {
                    out.push(i);
                    frontier.push(i);
                }
            }
        }
        out
    }
    /// Whether moving `rows` out of (or into) `acct` can be corrected from record: false means confirm.
    fn recorded_for(&self, acct: usize, rows: &[usize], incoming: bool) -> bool {
        let Some(t_min) = rows.iter().map(|r| self.rows[*r].date).min() else {
            return true;
        };
        for (_, n) in self.nodes.iter().enumerate().filter(|(_, n)| n.acct == acct && n.cutoff >= t_min) {
            if !n.recorded {
                return false;
            }
        }
        if !incoming {
            for (i, n) in self
                .nodes
                .iter()
                .enumerate()
                .filter(|(_, n)| n.acct == acct && n.cutoff >= t_min && n.recorded)
            {
                for r in rows {
                    let row = &self.rows[*r];
                    let inside = row.date <= n.cutoff && n.parent_cutoff.is_none_or(|p| row.date > p);
                    if inside {
                        if let Some(rev) = n.members.get(r) {
                            if *rev != row.rev {
                                return false;
                            }
                        } else {
                            assert!(row.rev > n.capture_rev, "model: node {i} must have counted row {r}");
                        }
                    }
                }
            }
        }
        true
    }
    fn has_future_node(&self, acct: usize) -> bool {
        self.nodes.iter().any(|n| n.acct == acct && (n.cutoff > TODAY || n.effective > TODAY))
    }
    fn move_automatic(&mut self, src: usize, dst: usize, rows: &[usize]) {
        // Corrections computed before any row changes hands, then membership and revisions updated.
        let t_min = rows.iter().map(|r| self.rows[*r].date).min().unwrap();
        let mut deltas: Vec<(usize, i64)> = Vec::new();
        let mut order: Vec<usize> = (0..self.nodes.len())
            .filter(|i| self.nodes[*i].cutoff >= t_min && (self.nodes[*i].acct == src || self.nodes[*i].acct == dst))
            .collect();
        order.sort_by_key(|i| (self.nodes[*i].cutoff, *i));
        let mut total: std::collections::HashMap<usize, i64> = std::collections::HashMap::new();
        for i in &order {
            let n = &self.nodes[*i];
            let mut delta = n.parent.and_then(|p| total.get(&p).copied()).unwrap_or(0);
            for r in rows {
                let row = &self.rows[*r];
                let inside = row.date <= n.cutoff && n.parent_cutoff.is_none_or(|p| row.date > p);
                if !inside {
                    continue;
                }
                if n.acct == dst {
                    delta += row.amount;
                } else if let Some(rev) = n.members.get(r) {
                    assert_eq!(*rev, row.rev);
                    delta -= row.amount;
                }
            }
            total.insert(*i, delta);
            deltas.push((*i, delta));
        }
        for r in rows {
            self.rev += 1;
            self.rows[*r].rev = self.rev;
            self.rows[*r].acct = dst;
        }
        for (i, delta) in deltas {
            let n = &mut self.nodes[i];
            n.balance += delta;
            if n.acct == src {
                for r in rows {
                    n.members.remove(r);
                }
            }
        }
        for i in order {
            if self.nodes[i].acct == dst {
                for r in rows {
                    let row = self.rows[*r].clone();
                    let (cutoff, pc) = (self.nodes[i].cutoff, self.nodes[i].parent_cutoff);
                    if row.date <= cutoff && pc.is_none_or(|p| row.date > p) {
                        self.nodes[i].members.insert(*r, row.rev);
                    }
                }
            }
        }
    }
    fn move_confirmed(&mut self, src: usize, dst: usize, rows: &[usize], confirmed: &[(usize, i64)], op: &str, ids: &[i64]) {
        for r in rows {
            self.rev += 1;
            self.rows[*r].rev = self.rev;
            self.rows[*r].acct = dst;
        }
        let _ = src;
        for (acct, value) in confirmed {
            let today_rows: i64 = self
                .rows
                .iter()
                .filter(|r| r.acct == *acct && r.live && r.date == TODAY)
                .map(|r| r.amount)
                .sum();
            self.nodes.push(MNode {
                acct: *acct,
                cutoff: TODAY - 1,
                effective: TODAY,
                balance: value - today_rows,
                recorded: false,
                members: Default::default(),
                parent: None,
                parent_cutoff: None,
                capture_rev: self.rev,
                period: format!("move:{op}:{}", ids[*acct]),
            });
        }
    }
}

fn run_seed(seed: u64) {
    let mut rng = Rng(seed.wrapping_mul(0x9E37_79B9_7F4A_7C15) | 1);
    let dir = std::env::temp_dir().join(format!("vaultspend-model-{seed}-{}", std::process::id()));
    let _ = std::fs::remove_dir_all(&dir);
    std::fs::create_dir_all(&dir).unwrap();
    let path = dir.join("p.db");
    let mut store = Store::open(&path).unwrap();
    let ids: Vec<i64> = ["A", "B", "C"]
        .iter()
        .enumerate()
        .map(|(i, n)| {
            let id = store.get_or_create_account(n, AccountType::Checking).unwrap();
            store.set_account_starting_balance(id, Decimal::new(OPENING[i], 2)).unwrap();
            id
        })
        .collect();
    let mut model = Model {
        rows: Vec::new(),
        nodes: Vec::new(),
        rev: 0,
    };
    let mut trace: Vec<String> = Vec::new();
    let mut manual_used: std::collections::HashSet<(usize, i32)> = Default::default();
    let mut counter = 0u32;
    let fail = |trace: &[String], what: String| -> ! { panic!("seed {seed}: {what}\ntrace:\n{}", trace.join("\n")) };

    for step in 0..50 {
        counter += 1;
        let acct = rng.below(3) as usize;
        match rng.below(100) {
            0..=29 => {
                let date = 20 + rng.below(70) as i32; // some rows are in the future
                let amount = -(rng.below(5_000) as i64) - 1 + (rng.below(3) as i64) * 3_000;
                let id = super::historical_account_moves::add(&store, ids[acct], &date_of(date), &format!("Row {counter}"), &cents(amount));
                model.rev += 1;
                model.rows.push(MRow {
                    acct,
                    date,
                    amount,
                    live: true,
                    rev: model.rev,
                    id,
                });
                trace.push(format!("{step}: import acct {acct} day {date} {amount}"));
            }
            30..=44 => {
                let cutoff = 20 + rng.below(38) as i32; // never past today
                let period = format!("s{seed}-{counter}");
                store
                    .record_automatic_checkpoint(ids[acct], "checking", Decimal::new(OPENING[acct], 2), &period, day(&date_of(cutoff)))
                    .unwrap();
                model.capture(acct, cutoff, period);
                trace.push(format!("{step}: capture acct {acct} cutoff {cutoff}"));
            }
            45..=49 => {
                let as_of = 10 + rng.below(49) as i32;
                if !manual_used.insert((acct, as_of)) {
                    continue;
                }
                let value = 40_000 + rng.below(60_000) as i64;
                store
                    .set_account_balance_override(ids[acct], Decimal::new(value, 2), day(&date_of(as_of)))
                    .unwrap();
                let posted: i64 = model
                    .rows
                    .iter()
                    .filter(|r| r.acct == acct && r.live && r.date == as_of)
                    .map(|r| r.amount)
                    .sum();
                let cutoff = as_of - 1;
                let outranking = model
                    .nodes
                    .iter()
                    .filter(|n| n.acct == acct && n.cutoff <= cutoff)
                    .map(|n| n.effective)
                    .max();
                let effective = outranking.filter(|e| *e > cutoff).unwrap_or(cutoff);
                model.nodes.push(MNode {
                    acct,
                    cutoff,
                    effective,
                    balance: value - posted,
                    recorded: false,
                    members: Default::default(),
                    parent: None,
                    parent_cutoff: None,
                    capture_rev: model.rev,
                    period: format!("manual:{}", date_of(as_of)),
                });
                trace.push(format!("{step}: manual acct {acct} as_of {as_of} = {value}"));
            }
            50..=57 => {
                let live: Vec<usize> = (0..model.rows.len()).filter(|i| model.rows[*i].live).collect();
                if live.is_empty() {
                    continue;
                }
                let r = live[rng.below(live.len() as u64) as usize];
                let amount = -(rng.below(5_000) as i64) - 1;
                store
                    .conn
                    .execute(
                        "UPDATE transactions SET amount = ?1 WHERE id = ?2",
                        params![cents(amount), model.rows[r].id],
                    )
                    .unwrap();
                model.rev += 1;
                model.rows[r].amount = amount;
                model.rows[r].rev = model.rev;
                trace.push(format!("{step}: edit amount row {r} -> {amount}"));
            }
            58..=61 => {
                let r = rng.below(model.rows.len().max(1) as u64) as usize;
                if r >= model.rows.len() {
                    continue;
                }
                let live = model.rows[r].live;
                store
                    .conn
                    .execute(
                        "UPDATE transactions SET deleted_at = ?1 WHERE id = ?2",
                        params![if live { Some("2026-10-01 00:00:00") } else { None }, model.rows[r].id],
                    )
                    .unwrap();
                model.rev += 1;
                model.rows[r].live = !live;
                model.rows[r].rev = model.rev;
                trace.push(format!("{step}: {} row {r}", if live { "delete" } else { "restore" }));
            }
            62..=64 => {
                let Some(node) = (0..model.nodes.len()).filter(|i| model.nodes[*i].acct == acct).nth(rng.below(3) as usize) else {
                    continue;
                };
                let reset_id: i64 = store
                    .conn
                    .query_row(
                        "SELECT id FROM balance_resets WHERE account_id = ?1 AND period = ?2",
                        params![ids[acct], model.nodes[node].period],
                        |r| r.get(0),
                    )
                    .unwrap();
                store
                    .conn
                    .execute(
                        "UPDATE balance_resets SET balance = ?1 WHERE id = ?2",
                        params![cents(model.nodes[node].balance + 1), reset_id],
                    )
                    .unwrap();
                model.nodes[node].balance += 1;
                model.nodes[node].recorded = false;
                model.nodes[node].members.clear();
                for c in model.descendants(node) {
                    model.nodes[c].recorded = false;
                }
                trace.push(format!("{step}: direct edit of saved balance {node}"));
            }
            65..=66 => {
                drop(store);
                store = Store::open(&path).unwrap();
                trace.push(format!("{step}: close and reopen"));
            }
            _ => {
                let src = acct;
                let dst = (acct + 1 + rng.below(2) as usize) % 3;
                let live: Vec<usize> = (0..model.rows.len())
                    .filter(|i| model.rows[*i].live && model.rows[*i].acct == src)
                    .collect();
                if live.is_empty() {
                    continue;
                }
                let n = 1 + rng.below(3.min(live.len() as u64)) as usize;
                let mut picked: Vec<usize> = Vec::new();
                while picked.len() < n {
                    let c = live[rng.below(live.len() as u64) as usize];
                    if !picked.contains(&c) {
                        picked.push(c);
                    }
                }
                let row_ids: Vec<i64> = {
                    let mut v: Vec<i64> = picked.iter().map(|i| model.rows[*i].id).collect();
                    v.sort();
                    v
                };
                let p = store.preview_account_move_with(&row_ids, ids[dst], day(T), &[]).unwrap();
                let confirm = !(model.recorded_for(src, &picked, false) && model.recorded_for(dst, &picked, true));
                if confirm && (model.has_future_node(src) || model.has_future_node(dst)) {
                    if p.status != "blocked" {
                        fail(&trace, format!("step {step}: expected a future-balance block, got {} ", p.status));
                    }
                    trace.push(format!("{step}: move {picked:?} {src}->{dst}: blocked by a future balance"));
                    continue;
                }
                let before_plain: Vec<i64> = vec![]; // placeholder to keep the trace explicit
                let _ = before_plain;
                if confirm {
                    if p.status != "needs_balance_confirmation" {
                        fail(
                            &trace,
                            format!("step {step}: model wants confirmation, native says {} {:?}", p.status, p.blockers),
                        );
                    }
                    let mut after = model.rows.clone();
                    for r in &picked {
                        after[*r].acct = dst;
                    }
                    let plain = |acct: usize| -> i64 {
                        // today's balance if the moved rows were simply counted where they now live
                        let mut tmp = Model {
                            rows: after.clone(),
                            nodes: model.nodes.clone(),
                            rev: 0,
                        };
                        let _ = &mut tmp;
                        tmp.balance(acct, TODAY)
                    };
                    let confirmed: Vec<(usize, i64)> = [src, dst].iter().map(|a| (*a, plain(*a) + (rng.below(3) as i64) * 100)).collect();
                    let inputs: Vec<BalanceInput> = confirmed
                        .iter()
                        .map(|(a, v)| BalanceInput {
                            account_id: ids[*a],
                            keep: false,
                            value: Some(cents(*v)),
                        })
                        .collect();
                    let p2 = store.preview_account_move_with(&row_ids, ids[dst], day(T), &inputs).unwrap();
                    if !p2.can_commit {
                        fail(&trace, format!("step {step}: confirmed review cannot commit: {:?}", p2.confirmations));
                    }
                    let op = format!("s{seed}-op{step}");
                    let req = MoveRequest {
                        ids: &row_ids,
                        destination: ids[dst],
                        expected_token: &p2.token,
                        today: day(T),
                        operation_id: &op,
                        balances: &inputs,
                    };
                    match store.commit_account_move(&req).unwrap() {
                        MoveOutcome::Moved(_) => {}
                        other => fail(&trace, format!("step {step}: {other:?}")),
                    }
                    model.move_confirmed(src, dst, &picked, &confirmed, &op, &ids);
                    trace.push(format!("{step}: confirmed move {picked:?} {src}->{dst} {confirmed:?}"));
                    if rng.below(3) == 0 {
                        let snapshot = dump(&store);
                        match store.commit_account_move(&req).unwrap() {
                            MoveOutcome::Moved(s) if s.replayed => {}
                            other => fail(&trace, format!("step {step}: replay gave {other:?}")),
                        }
                        if dump(&store) != snapshot {
                            fail(&trace, format!("step {step}: a replay changed the database"));
                        }
                    }
                } else {
                    if p.status != "ready" || p.mode != "automatic" {
                        fail(
                            &trace,
                            format!(
                                "step {step}: model says automatic, native says {} / {} {:?}",
                                p.status, p.mode, p.blockers
                            ),
                        );
                    }
                    let mut after = Model {
                        rows: model.rows.clone(),
                        nodes: model.nodes.clone(),
                        rev: model.rev,
                    };
                    after.move_automatic(src, dst, &picked);
                    for (acct_idx, effect_account) in [(src, ids[src]), (dst, ids[dst])] {
                        let shown = p.effects.iter().find(|e| e.account_id == effect_account).unwrap();
                        if d(&shown.projected) != Decimal::new(after.balance(acct_idx, TODAY), 2) {
                            fail(
                                &trace,
                                format!(
                                    "step {step}: preview projects {} for account {acct_idx}, model {}",
                                    shown.projected,
                                    after.balance(acct_idx, TODAY)
                                ),
                            );
                        }
                    }
                    let op = format!("s{seed}-op{step}");
                    let req = MoveRequest {
                        ids: &row_ids,
                        destination: ids[dst],
                        expected_token: &p.token,
                        today: day(T),
                        operation_id: &op,
                        balances: &[],
                    };
                    match store.commit_account_move(&req).unwrap() {
                        MoveOutcome::Moved(_) => {}
                        other => fail(&trace, format!("step {step}: {other:?}")),
                    }
                    model = after;
                    trace.push(format!("{step}: automatic move {picked:?} {src}->{dst}"));
                }
            }
        }

        // After every action: balances on sample days, saved balances and membership, no mutation of unrelated rows.
        for (a, account_id) in ids.iter().enumerate() {
            for on in SAMPLE_DAYS {
                let want = Decimal::new(model.balance(a, on), 2);
                let got = bal(&store, *account_id, &date_of(on));
                if got != want {
                    fail(&trace, format!("step {step}: account {a} on day {on}: native {got}, model {want}"));
                }
            }
        }
        for (i, n) in model.nodes.iter().enumerate() {
            let row: Option<(String, i64)> = store
                .conn
                .query_row(
                    "SELECT balance, current_version_id FROM balance_resets WHERE account_id = ?1 AND period = ?2",
                    params![ids[n.acct], n.period],
                    |r| Ok((r.get(0)?, r.get(1)?)),
                )
                .ok();
            let Some((stored, version)) = row else {
                fail(&trace, format!("step {step}: saved balance {i} missing"))
            };
            if d(&stored) != Decimal::new(n.balance, 2) {
                fail(
                    &trace,
                    format!("step {step}: saved balance {i} ({}) is {stored}, model {}", n.period, n.balance),
                );
            }
            let integrity: String = store
                .conn
                .query_row("SELECT integrity FROM balance_reset_versions WHERE id = ?1", params![version], |r| {
                    r.get(0)
                })
                .unwrap();
            if n.recorded != (integrity == "trusted") {
                fail(
                    &trace,
                    format!(
                        "step {step}: saved balance {i} trusted={} but model recorded={}",
                        integrity == "trusted",
                        n.recorded
                    ),
                );
            }
            if n.recorded {
                let mut stmt = store
                    .conn
                    .prepare("SELECT transaction_id FROM balance_version_contributions WHERE version_id = ?1 ORDER BY 1")
                    .unwrap();
                let got: Vec<i64> = stmt.query_map(params![version], |r| r.get(0)).unwrap().map(|v| v.unwrap()).collect();
                let mut want: Vec<i64> = n.members.keys().map(|r| model.rows[*r].id).collect();
                want.sort();
                if got != want {
                    fail(&trace, format!("step {step}: saved balance {i} counts {got:?}, model {want:?}"));
                }
            }
        }
    }
    let _ = legacy_reset;
    let ok: String = store.conn.query_row("PRAGMA integrity_check", [], |r| r.get(0)).unwrap();
    assert_eq!(ok, "ok", "seed {seed}");
    drop(store);
    let _ = std::fs::remove_dir_all(dir);
}

#[test]
fn the_reference_model_agrees_with_the_store_for_100_fixed_seeds() {
    for seed in 1..=100u64 {
        run_seed(seed);
    }
}
