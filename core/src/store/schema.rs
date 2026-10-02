//! Creating the tables and upgrading older databases in place (`init_schema` and the `migrate_*` steps).

use super::Store;
use crate::models::AccountType;
use chrono::NaiveDate;
use rusqlite::params;
use rust_decimal::Decimal;
use std::str::FromStr;

/// The starter categories offered before the user has created or used any
/// of their own — seeded once into the `categories` table on a fresh
/// database (see `Store::seed_default_categories_if_missing`).
pub(super) const DEFAULT_CATEGORIES: [&str; 10] = [
    "Rent",
    "Groceries",
    "Dining Out",
    "Utilities",
    "Transportation",
    "Entertainment",
    "Shopping",
    "Income",
    "Transfer",
    "Business Expense",
];

impl Store {
    pub(super) fn init_schema(&self) -> rusqlite::Result<()> {
        self.conn.execute_batch(
            "CREATE TABLE IF NOT EXISTS accounts (
                id INTEGER PRIMARY KEY AUTOINCREMENT,
                name TEXT NOT NULL UNIQUE COLLATE NOCASE,
                account_type TEXT NOT NULL,
                starting_balance TEXT NOT NULL DEFAULT '0',
                institution TEXT,
                mask TEXT,
                interest_rate TEXT,
                excluded_from_debt_payoff INTEGER NOT NULL DEFAULT 0
            );
            CREATE TABLE IF NOT EXISTS transactions (
                id INTEGER PRIMARY KEY AUTOINCREMENT,
                account_id INTEGER NOT NULL REFERENCES accounts(id),
                date TEXT NOT NULL,
                description TEXT NOT NULL,
                amount TEXT NOT NULL,
                category TEXT,
                category_source TEXT,
                confidence REAL,
                fingerprint TEXT NOT NULL
            );
            CREATE INDEX IF NOT EXISTS idx_transactions_fingerprint ON transactions(fingerprint);
            CREATE TABLE IF NOT EXISTS rules (
                pattern TEXT NOT NULL UNIQUE COLLATE NOCASE,
                category TEXT NOT NULL
            );
            CREATE TABLE IF NOT EXISTS buckets (
                id INTEGER PRIMARY KEY AUTOINCREMENT,
                name TEXT NOT NULL UNIQUE COLLATE NOCASE,
                target_amount TEXT,
                target_date TEXT,
                account_id INTEGER
            );
            CREATE TABLE IF NOT EXISTS bucket_contributions (
                id INTEGER PRIMARY KEY AUTOINCREMENT,
                bucket_id INTEGER NOT NULL REFERENCES buckets(id),
                date TEXT NOT NULL,
                amount TEXT NOT NULL,
                note TEXT
            );
            CREATE TABLE IF NOT EXISTS budgets (
                category TEXT NOT NULL,
                period TEXT NOT NULL,
                monthly_amount TEXT NOT NULL,
                budget_group TEXT NOT NULL DEFAULT 'flexible',
                PRIMARY KEY (category, period)
            );
            CREATE TABLE IF NOT EXISTS recurring (
                id INTEGER PRIMARY KEY AUTOINCREMENT,
                merchant TEXT NOT NULL,
                category TEXT,
                amount TEXT NOT NULL,
                cadence TEXT NOT NULL,
                anchor_date TEXT NOT NULL,
                account_id INTEGER
            );
            CREATE TABLE IF NOT EXISTS recurring_dismissals (
                merchant TEXT NOT NULL,
                amount TEXT NOT NULL,
                cadence TEXT NOT NULL,
                PRIMARY KEY (merchant, amount, cadence)
            );
            CREATE TABLE IF NOT EXISTS recurring_price_dismissals (
                recurring_id INTEGER NOT NULL REFERENCES recurring(id) ON DELETE CASCADE,
                from_amount TEXT NOT NULL,
                to_amount TEXT NOT NULL,
                PRIMARY KEY (recurring_id, from_amount, to_amount)
            );
            CREATE TABLE IF NOT EXISTS holdings (
                id INTEGER PRIMARY KEY AUTOINCREMENT,
                account_id INTEGER NOT NULL REFERENCES accounts(id),
                symbol TEXT NOT NULL,
                name TEXT NOT NULL,
                shares TEXT NOT NULL,
                price TEXT NOT NULL,
                cost_basis TEXT NOT NULL,
                asset_class TEXT,
                prev_close TEXT,
                prev_close_date TEXT
            );
            CREATE TABLE IF NOT EXISTS assets (
                id INTEGER PRIMARY KEY AUTOINCREMENT,
                name TEXT NOT NULL,
                asset_type TEXT NOT NULL,
                value TEXT NOT NULL,
                valued_on TEXT NOT NULL,
                notes TEXT
            );
            CREATE TABLE IF NOT EXISTS categories (
                name TEXT PRIMARY KEY COLLATE NOCASE
            );
            CREATE TABLE IF NOT EXISTS balance_resets (
                id INTEGER PRIMARY KEY AUTOINCREMENT,
                account_id INTEGER NOT NULL REFERENCES accounts(id),
                period TEXT NOT NULL,
                reset_date TEXT NOT NULL,
                balance TEXT NOT NULL,
                UNIQUE(account_id, period)
            );
            CREATE TABLE IF NOT EXISTS bucket_auto_contributions (
                id INTEGER PRIMARY KEY AUTOINCREMENT,
                bucket_id INTEGER NOT NULL REFERENCES buckets(id),
                period TEXT NOT NULL,
                contribution_id INTEGER NOT NULL REFERENCES bucket_contributions(id),
                UNIQUE(bucket_id, period)
            );
            CREATE TABLE IF NOT EXISTS budget_periods (
                period TEXT PRIMARY KEY
            );
            CREATE TABLE IF NOT EXISTS debt_payments (
                id INTEGER PRIMARY KEY AUTOINCREMENT,
                source_transaction_id INTEGER NOT NULL UNIQUE REFERENCES transactions(id),
                debt_account_id INTEGER NOT NULL REFERENCES accounts(id),
                generated_transaction_id INTEGER NOT NULL REFERENCES transactions(id),
                amount TEXT NOT NULL,
                date TEXT NOT NULL
            );
            -- `source_transaction_id` already has an implicit index via its
            -- own UNIQUE constraint; `generated_transaction_id` doesn't and
            -- is filtered via `NOT IN (SELECT generated_transaction_id ...)`
            -- in nearly every reporting query.
            CREATE INDEX IF NOT EXISTS idx_debt_payments_generated_transaction_id ON debt_payments(generated_transaction_id);
            CREATE TABLE IF NOT EXISTS transaction_splits (
                id INTEGER PRIMARY KEY AUTOINCREMENT,
                transaction_id INTEGER NOT NULL REFERENCES transactions(id),
                category TEXT,
                amount TEXT NOT NULL,
                note TEXT
            );
            CREATE INDEX IF NOT EXISTS idx_transaction_splits_transaction_id ON transaction_splits(transaction_id);
            CREATE TABLE IF NOT EXISTS transaction_tags (
                transaction_id INTEGER NOT NULL REFERENCES transactions(id),
                tag TEXT NOT NULL COLLATE NOCASE,
                PRIMARY KEY (transaction_id, tag)
            );
            CREATE TABLE IF NOT EXISTS family_members (
                id INTEGER PRIMARY KEY AUTOINCREMENT,
                name TEXT NOT NULL UNIQUE COLLATE NOCASE
            );
            CREATE TABLE IF NOT EXISTS reconciliations (
                id INTEGER PRIMARY KEY AUTOINCREMENT,
                account_id INTEGER NOT NULL,
                statement_date TEXT NOT NULL,
                statement_balance TEXT NOT NULL,
                finished_at TEXT NOT NULL
            );
            CREATE TABLE IF NOT EXISTS portfolio_snapshots (
                date TEXT PRIMARY KEY,
                value TEXT NOT NULL
            );
            CREATE TABLE IF NOT EXISTS allocation_targets (
                asset_class TEXT PRIMARY KEY,
                percent TEXT NOT NULL
            );
            CREATE TABLE IF NOT EXISTS anomaly_dismissals (
                transaction_id INTEGER NOT NULL,
                kind TEXT NOT NULL,
                PRIMARY KEY (transaction_id, kind)
            );
            CREATE TABLE IF NOT EXISTS month_reviews (
                period TEXT PRIMARY KEY
            );
            CREATE TABLE IF NOT EXISTS transfer_links (
                id INTEGER PRIMARY KEY AUTOINCREMENT,
                out_transaction_id INTEGER NOT NULL UNIQUE REFERENCES transactions(id),
                in_transaction_id INTEGER NOT NULL UNIQUE REFERENCES transactions(id),
                auto INTEGER NOT NULL DEFAULT 0,
                reviewed INTEGER NOT NULL DEFAULT 1
            );
            CREATE TABLE IF NOT EXISTS transfer_link_rejections (
                out_transaction_id INTEGER NOT NULL,
                in_transaction_id INTEGER NOT NULL,
                PRIMARY KEY (out_transaction_id, in_transaction_id)
            );
            CREATE TABLE IF NOT EXISTS transfer_candidate_dismissals (
                out_transaction_id INTEGER NOT NULL,
                in_transaction_id INTEGER NOT NULL,
                PRIMARY KEY (out_transaction_id, in_transaction_id)
            );
            CREATE TABLE IF NOT EXISTS live_price_settings (
                id INTEGER PRIMARY KEY CHECK (id = 1),
                api_key TEXT,
                provider TEXT NOT NULL DEFAULT 'alpha_vantage',
                last_refreshed_at TEXT,
                requests_used_today INTEGER NOT NULL DEFAULT 0,
                requests_count_date TEXT
            );
            CREATE TABLE IF NOT EXISTS app_settings (
                id INTEGER PRIMARY KEY CHECK (id = 1),
                apply_to_debt_enabled INTEGER NOT NULL DEFAULT 1,
                split_purchases_enabled INTEGER NOT NULL DEFAULT 1,
                envelope_caps_enabled INTEGER NOT NULL DEFAULT 1,
                loan_sign_convention_migrated INTEGER NOT NULL DEFAULT 0,
                default_rules_seeded INTEGER NOT NULL DEFAULT 0,
                backup_copy_dir TEXT,
                tray_enabled INTEGER NOT NULL DEFAULT 0,
                autostart_enabled INTEGER NOT NULL DEFAULT 0,
                rollover_enabled INTEGER NOT NULL DEFAULT 1,
                auto_link_transfers INTEGER NOT NULL DEFAULT 0,
                safe_to_spend_enabled INTEGER NOT NULL DEFAULT 1,
                inflation_pct TEXT NOT NULL DEFAULT '3'
            );
            CREATE TABLE IF NOT EXISTS investment_plans (
                account_id INTEGER PRIMARY KEY REFERENCES accounts(id),
                monthly_contribution TEXT,
                annual_return_pct TEXT NOT NULL DEFAULT '7',
                withdraw_date TEXT,
                withdraw_years INTEGER
            );
            CREATE TABLE IF NOT EXISTS account_value_snapshots (
                account_id INTEGER NOT NULL REFERENCES accounts(id),
                date TEXT NOT NULL,
                value TEXT NOT NULL,
                PRIMARY KEY (account_id, date)
            );
            CREATE TABLE IF NOT EXISTS reminder_identities (
                recurring_id INTEGER PRIMARY KEY,
                opaque_id TEXT NOT NULL UNIQUE
            );
            INSERT OR IGNORE INTO reminder_identities SELECT id, lower(hex(randomblob(16))) FROM recurring;
            CREATE TRIGGER IF NOT EXISTS recurring_reminder_identity_insert AFTER INSERT ON recurring BEGIN
                INSERT INTO reminder_identities VALUES (NEW.id, lower(hex(randomblob(16))));
            END;
            CREATE TRIGGER IF NOT EXISTS recurring_reminder_identity_delete AFTER DELETE ON recurring BEGIN
                DELETE FROM reminder_identities WHERE recurring_id = OLD.id;
            END;
            CREATE TABLE IF NOT EXISTS reminders_sent (
                recurring_id INTEGER NOT NULL,
                due_date TEXT NOT NULL,
                sent_on TEXT NOT NULL,
                PRIMARY KEY (recurring_id, due_date)
            );
            CREATE TABLE IF NOT EXISTS comparison_setup (
                id INTEGER PRIMARY KEY CHECK (id = 1),
                format_version INTEGER NOT NULL,
                revision INTEGER NOT NULL,
                payload TEXT NOT NULL,
                updated_at TEXT NOT NULL
            );
            CREATE TABLE IF NOT EXISTS profile_ui_state (
                key TEXT PRIMARY KEY,
                value TEXT NOT NULL
            );",
        )?;
        self.migrate_add_account_id_if_missing()?;
        self.migrate_add_confidence_if_missing()?;
        self.migrate_add_starting_balance_if_missing()?;
        self.migrate_add_institution_and_mask_if_missing()?;
        self.migrate_add_interest_rate_if_missing()?;
        self.migrate_add_excluded_from_debt_payoff_if_missing()?;
        self.migrate_add_budget_group_if_missing()?;
        self.migrate_budgets_to_period_scoped_if_missing()?;
        self.backfill_budget_periods_if_missing()?;
        self.migrate_add_cap_enabled_to_budgets_if_missing()?;
        self.migrate_add_bucket_extras_if_missing()?;
        self.migrate_add_bucket_sinking_amount_if_missing()?;
        self.migrate_add_bucket_color_if_missing()?;
        self.migrate_add_bucket_tracks_account_if_missing()?;
        self.migrate_add_backup_copy_dir_if_missing()?;
        self.migrate_add_rollover_to_budgets_if_missing()?;
        self.migrate_add_cleared_to_transactions_if_missing()?;
        self.migrate_add_background_settings_if_missing()?;
        self.migrate_add_rollover_setting_if_missing()?;
        self.migrate_add_safe_to_spend_setting_if_missing()?;
        self.migrate_add_auto_link_support_if_missing()?;
        self.migrate_add_inflation_setting_if_missing()?;
        self.migrate_add_bucket_icon_key_if_missing()?;
        self.migrate_add_account_icon_key_if_missing()?;
        self.migrate_add_account_import_flip_signs_if_missing()?;
        self.migrate_add_category_icon_key_if_missing()?;
        self.migrate_add_member_id_to_accounts_if_missing()?;
        self.migrate_add_member_id_to_transactions_if_missing()?;
        self.migrate_add_member_id_to_recurring_if_missing()?;
        self.migrate_add_status_to_recurring_if_missing()?;
        self.migrate_add_member_id_to_buckets_if_missing()?;
        self.migrate_add_member_id_to_assets_if_missing()?;
        self.migrate_add_live_price_request_tracking_if_missing()?;
        self.migrate_add_live_price_provider_if_missing()?;
        self.migrate_add_deleted_at_if_missing()?;
        self.migrate_add_holdings_prev_close_if_missing()?;
        self.migrate_fix_stale_manual_balance_override_reset_dates()?;
        self.migrate_add_loan_sign_convention_migrated_if_missing()?;
        self.migrate_add_default_rules_seeded_if_missing()?;
        self.migrate_flip_loan_transaction_signs_if_needed()?;
        self.migrate_add_principal_amount_if_missing()?;
        self.migrate_add_notes_to_transactions_if_missing()?;
        // These reference columns only guaranteed to exist once every
        // migration above has run — a database from before those columns
        // existed has a table the initial `CREATE TABLE IF NOT EXISTS` up
        // top left untouched (it already existed, just without the
        // column), so an index on that column placed in that same batch
        // would fail with "no such column" exactly like the migrations
        // above had to work around for the columns themselves.
        // `deleted_at` (transactions): only exists after
        // `migrate_add_deleted_at_if_missing` runs, above. Partial indexes
        // matching the `deleted_at IS NULL` predicate nearly every
        // production query already filters on, covering the three ways
        // transactions get looked up: per account (balance-as-of), per
        // category (budget actuals), and by date alone (monthly totals,
        // large-expense range scans).
        // `period` (budgets): only exists after
        // `migrate_budgets_to_period_scoped_if_missing`, above — the
        // table's own PRIMARY KEY is (category, period), which can't serve
        // a period-only lookup (`list_budgets`) efficiently since category
        // leads it.
        self.conn.execute_batch(
            "CREATE INDEX IF NOT EXISTS idx_transactions_account_date ON transactions(account_id, date) WHERE deleted_at IS NULL;
             CREATE INDEX IF NOT EXISTS idx_transactions_category_date ON transactions(category, date) WHERE deleted_at IS NULL;
             CREATE INDEX IF NOT EXISTS idx_transactions_date ON transactions(date) WHERE deleted_at IS NULL;
             CREATE INDEX IF NOT EXISTS idx_budgets_period ON budgets(period);
             -- `debt_payments.source_transaction_id` already has an implicit
             -- index via its own UNIQUE constraint (see its CREATE TABLE
             -- above) — only `transaction_tags.transaction_id` was actually
             -- missing one, forcing `all_transactions`'s LEFT JOIN against it
             -- to build a temporary index on every call instead of using a
             -- persistent one.
             CREATE INDEX IF NOT EXISTS idx_transaction_tags_transaction_id ON transaction_tags(transaction_id);",
        )?;
        self.seed_default_categories_if_missing()?;
        self.backfill_categories_from_usage()
    }

    /// `live_price_settings` originally shipped with just `api_key`/
    /// `last_refreshed_at` — these two columns (the daily request counter
    /// used by `record_live_price_request`/`live_price_requests_used_today`)
    /// were added right after. Same missing-column pattern as every other
    /// migration here.
    fn migrate_add_live_price_request_tracking_if_missing(&self) -> rusqlite::Result<()> {
        let mut stmt = self.conn.prepare("PRAGMA table_info(live_price_settings)")?;
        let mut rows = stmt.query([])?;
        let mut has_requests_used_today = false;
        while let Some(row) = rows.next()? {
            let column_name: String = row.get(1)?;
            if column_name == "requests_used_today" {
                has_requests_used_today = true;
                break;
            }
        }
        drop(rows);
        drop(stmt);

        if has_requests_used_today {
            return Ok(());
        }

        self.conn.execute(
            "ALTER TABLE live_price_settings ADD COLUMN requests_used_today INTEGER NOT NULL DEFAULT 0",
            [],
        )?;
        self.conn
            .execute("ALTER TABLE live_price_settings ADD COLUMN requests_count_date TEXT", [])?;
        Ok(())
    }

    /// `live_price_settings` didn't originally track which provider a
    /// saved API key belongs to — everyone who'd already saved a key was
    /// necessarily using Alpha Vantage (Finnhub support didn't exist yet),
    /// so this backfills existing rows to `'alpha_vantage'` via the
    /// column's own default. Same missing-column pattern as every other
    /// migration here.
    fn migrate_add_live_price_provider_if_missing(&self) -> rusqlite::Result<()> {
        let mut stmt = self.conn.prepare("PRAGMA table_info(live_price_settings)")?;
        let mut rows = stmt.query([])?;
        let mut has_provider = false;
        while let Some(row) = rows.next()? {
            let column_name: String = row.get(1)?;
            if column_name == "provider" {
                has_provider = true;
                break;
            }
        }
        drop(rows);
        drop(stmt);

        if has_provider {
            return Ok(());
        }

        self.conn.execute(
            "ALTER TABLE live_price_settings ADD COLUMN provider TEXT NOT NULL DEFAULT 'alpha_vantage'",
            [],
        )?;
        Ok(())
    }

    /// Same pattern once more: `target_date`/`account_id` are both
    /// nullable and optional — a missing-column database just needs the
    /// columns added, `NULL` is already correct for existing buckets.
    fn migrate_add_bucket_extras_if_missing(&self) -> rusqlite::Result<()> {
        let mut stmt = self.conn.prepare("PRAGMA table_info(buckets)")?;
        let mut rows = stmt.query([])?;
        let mut has_target_date = false;
        while let Some(row) = rows.next()? {
            let column_name: String = row.get(1)?;
            if column_name == "target_date" {
                has_target_date = true;
                break;
            }
        }
        drop(rows);
        drop(stmt);

        if has_target_date {
            return Ok(());
        }

        self.conn.execute("ALTER TABLE buckets ADD COLUMN target_date TEXT", [])?;
        self.conn.execute("ALTER TABLE buckets ADD COLUMN account_id INTEGER", [])?;
        Ok(())
    }

    /// Same pattern once more: `sinking_amount` turns a bucket into a
    /// sinking fund — an amount auto-contributed once a month (see
    /// `Store::apply_sinking_fund_contributions`) for an irregular annual
    /// cost like insurance or holiday gifts, instead of only accepting
    /// manual contributions. `NULL` (the default for every pre-existing
    /// row) means the feature is off for that bucket, same convention as
    /// `target_amount`/`target_date`/`account_id`.
    fn migrate_add_bucket_sinking_amount_if_missing(&self) -> rusqlite::Result<()> {
        let mut stmt = self.conn.prepare("PRAGMA table_info(buckets)")?;
        let mut rows = stmt.query([])?;
        let mut has_column = false;
        while let Some(row) = rows.next()? {
            let column_name: String = row.get(1)?;
            if column_name == "sinking_amount" {
                has_column = true;
                break;
            }
        }
        drop(rows);
        drop(stmt);

        if has_column {
            return Ok(());
        }

        self.conn.execute("ALTER TABLE buckets ADD COLUMN sinking_amount TEXT", [])?;
        Ok(())
    }

    /// Same pattern once more: `tracks_account` makes a goal's progress follow
    /// its linked account's balance rather than logged contributions. `0`
    /// (the default for every pre-existing row) keeps the old behavior — the
    /// linked account stays purely informational until the user opts in.
    fn migrate_add_bucket_tracks_account_if_missing(&self) -> rusqlite::Result<()> {
        let mut stmt = self.conn.prepare("PRAGMA table_info(buckets)")?;
        let mut rows = stmt.query([])?;
        let mut has_column = false;
        while let Some(row) = rows.next()? {
            let column_name: String = row.get(1)?;
            if column_name == "tracks_account" {
                has_column = true;
                break;
            }
        }
        drop(rows);
        drop(stmt);

        if has_column {
            return Ok(());
        }

        self.conn
            .execute("ALTER TABLE buckets ADD COLUMN tracks_account INTEGER NOT NULL DEFAULT 0", [])?;
        Ok(())
    }

    /// Same pattern once more: an optional hex color (e.g. `"#8A5FB0"`) a
    /// bucket can be tagged with, purely for the UI to color-code its card
    /// and any report that lists buckets by — not validated at this layer
    /// (matching this schema's existing lenient-raw-string convention for
    /// things like `cadence`/`budget_group`), since the frontend only ever
    /// offers a fixed palette. `NULL` (the default for every pre-existing
    /// row) means "no color chosen," same convention as the other optional
    /// bucket columns above.
    fn migrate_add_bucket_color_if_missing(&self) -> rusqlite::Result<()> {
        let mut stmt = self.conn.prepare("PRAGMA table_info(buckets)")?;
        let mut rows = stmt.query([])?;
        let mut has_column = false;
        while let Some(row) = rows.next()? {
            let column_name: String = row.get(1)?;
            if column_name == "color" {
                has_column = true;
                break;
            }
        }
        drop(rows);
        drop(stmt);

        if has_column {
            return Ok(());
        }

        self.conn.execute("ALTER TABLE buckets ADD COLUMN color TEXT", [])?;
        Ok(())
    }

    /// Same pattern once more: an optional explicit icon choice (one of the
    /// keys `bucketIcons.tsx`'s picker offers, e.g. `"travel"`/`"home"`/
    /// `"gift"`/`"laptop"`) a bucket can be tagged with, so the UI doesn't
    /// have to guess from the name. Not validated at this layer, same
    /// lenient-raw-string convention as `color` above — the frontend only
    /// ever offers a fixed set. `NULL` (the default for every pre-existing
    /// row) means "no explicit icon chosen," so the frontend falls back to
    /// its existing keyword-matched icon for that bucket, unchanged.
    fn migrate_add_bucket_icon_key_if_missing(&self) -> rusqlite::Result<()> {
        let mut stmt = self.conn.prepare("PRAGMA table_info(buckets)")?;
        let mut rows = stmt.query([])?;
        let mut has_column = false;
        while let Some(row) = rows.next()? {
            let column_name: String = row.get(1)?;
            if column_name == "icon_key" {
                has_column = true;
                break;
            }
        }
        drop(rows);
        drop(stmt);

        if has_column {
            return Ok(());
        }

        self.conn.execute("ALTER TABLE buckets ADD COLUMN icon_key TEXT", [])?;
        Ok(())
    }

    /// Same pattern once more, for accounts: an explicit icon choice
    /// (`accountIcons.tsx`'s picker) overriding the type-guessed default.
    /// `NULL` for every pre-existing row keeps its current guessed icon.
    fn migrate_add_account_icon_key_if_missing(&self) -> rusqlite::Result<()> {
        let mut stmt = self.conn.prepare("PRAGMA table_info(accounts)")?;
        let mut rows = stmt.query([])?;
        let mut has_column = false;
        while let Some(row) = rows.next()? {
            let column_name: String = row.get(1)?;
            if column_name == "icon_key" {
                has_column = true;
                break;
            }
        }
        drop(rows);
        drop(stmt);

        if has_column {
            return Ok(());
        }

        self.conn.execute("ALTER TABLE accounts ADD COLUMN icon_key TEXT", [])?;
        Ok(())
    }

    /// Same pattern once more, for categories: an explicit icon choice
    /// (`categoryIcons.tsx`'s picker) overriding the keyword-guessed default.
    /// `NULL` for every pre-existing row keeps its current guessed icon.
    fn migrate_add_category_icon_key_if_missing(&self) -> rusqlite::Result<()> {
        let mut stmt = self.conn.prepare("PRAGMA table_info(categories)")?;
        let mut rows = stmt.query([])?;
        let mut has_column = false;
        while let Some(row) = rows.next()? {
            let column_name: String = row.get(1)?;
            if column_name == "icon_key" {
                has_column = true;
                break;
            }
        }
        drop(rows);
        drop(stmt);

        if has_column {
            return Ok(());
        }

        self.conn.execute("ALTER TABLE categories ADD COLUMN icon_key TEXT", [])?;
        Ok(())
    }

    /// Same pattern once more: a database from before grouped budgets
    /// existed has no `budget_group` column. Existing budget lines
    /// backfill to `'flexible'` — the same default a fresh line gets —
    /// rather than leaving them ungrouped.
    fn migrate_add_budget_group_if_missing(&self) -> rusqlite::Result<()> {
        let mut stmt = self.conn.prepare("PRAGMA table_info(budgets)")?;
        let mut rows = stmt.query([])?;
        let mut has_budget_group = false;
        while let Some(row) = rows.next()? {
            let column_name: String = row.get(1)?;
            if column_name == "budget_group" {
                has_budget_group = true;
                break;
            }
        }
        drop(rows);
        drop(stmt);

        if has_budget_group {
            return Ok(());
        }

        self.conn.execute("ALTER TABLE budgets ADD COLUMN budget_group TEXT", [])?;
        self.conn
            .execute("UPDATE budgets SET budget_group = 'flexible' WHERE budget_group IS NULL", [])?;
        Ok(())
    }

    /// Same pattern once more: `cap_enabled` lets a category opt into a
    /// stricter 90%-of-budget warning threshold (see
    /// `Store::budget_alerts_for_month`) instead of the default 80%.
    /// Defaults to `0` (off) for every pre-existing row and every future
    /// row `set_budget` inserts without mentioning this column. Must run
    /// *after* `migrate_budgets_to_period_scoped_if_missing` — that one
    /// rebuilds `budgets` from a hardcoded column list on a legacy
    /// database, which would silently drop this column if it ran first.
    fn migrate_add_cap_enabled_to_budgets_if_missing(&self) -> rusqlite::Result<()> {
        let mut stmt = self.conn.prepare("PRAGMA table_info(budgets)")?;
        let mut rows = stmt.query([])?;
        let mut has_column = false;
        while let Some(row) = rows.next()? {
            let column_name: String = row.get(1)?;
            if column_name == "cap_enabled" {
                has_column = true;
                break;
            }
        }
        drop(rows);
        drop(stmt);

        if has_column {
            return Ok(());
        }

        self.conn
            .execute("ALTER TABLE budgets ADD COLUMN cap_enabled INTEGER NOT NULL DEFAULT 0", [])?;
        Ok(())
    }

    /// `budgets` used to have one global row per category shared by every
    /// month (`category TEXT PRIMARY KEY`) — editing a budget amount
    /// changed it for every month, past and future, since there was only
    /// ever one row per category. Rebuilds the table with a composite
    /// `(category, period)` key so each calendar month gets its own
    /// independent row (SQLite can't change a primary key with `ALTER
    /// TABLE`, so this rebuilds it: rename, recreate, copy, drop). Every
    /// pre-existing row is tagged with a sentinel period ("0000-01",
    /// guaranteed to sort before any real month) so it becomes the
    /// template the first real month copies forward from (see
    /// `Store::list_budgets`), preserving today's numbers exactly until
    /// the user edits a specific month.
    fn migrate_budgets_to_period_scoped_if_missing(&self) -> rusqlite::Result<()> {
        let mut stmt = self.conn.prepare("PRAGMA table_info(budgets)")?;
        let mut rows = stmt.query([])?;
        let mut has_period = false;
        while let Some(row) = rows.next()? {
            let column_name: String = row.get(1)?;
            if column_name == "period" {
                has_period = true;
                break;
            }
        }
        drop(rows);
        drop(stmt);

        if has_period {
            return Ok(());
        }

        self.conn.execute_batch(
            "ALTER TABLE budgets RENAME TO budgets_old;
             CREATE TABLE budgets (
                 category TEXT NOT NULL,
                 period TEXT NOT NULL,
                 monthly_amount TEXT NOT NULL,
                 budget_group TEXT NOT NULL DEFAULT 'flexible',
                 PRIMARY KEY (category, period)
             );
             INSERT INTO budgets (category, period, monthly_amount, budget_group)
             SELECT category, '0000-01', monthly_amount, budget_group FROM budgets_old;
             DROP TABLE budgets_old;",
        )?;
        Ok(())
    }

    /// Ensures `budget_periods` (the "has this month been touched"
    /// tracker `list_budgets` relies on) has an entry for every period
    /// that already has real rows in `budgets` — self-healing rather
    /// than seeded only inside the migration above, since a database
    /// migrated by an earlier build (before `budget_periods` existed)
    /// would otherwise have `period`-scoped budget rows the tracker
    /// never learned about, making them look untouched and silently
    /// invisible to `list_budgets` for any period that hasn't been
    /// independently touched since. Safe and cheap to run on every
    /// launch — an `INSERT OR IGNORE` over this app's tiny budgets table.
    fn backfill_budget_periods_if_missing(&self) -> rusqlite::Result<()> {
        self.conn
            .execute("INSERT OR IGNORE INTO budget_periods (period) SELECT DISTINCT period FROM budgets", [])?;
        Ok(())
    }

    /// The standard suggestions ("Rent", "Groceries", ...) — seeded once,
    /// the first time the `categories` table is empty. Gated so a category
    /// someone has deliberately deleted (`delete_category`) never comes
    /// back on a later launch; this only ever fires for a database that has
    /// never had any category registered at all.
    fn seed_default_categories_if_missing(&self) -> rusqlite::Result<()> {
        let already_seeded: bool = self.conn.query_row("SELECT EXISTS(SELECT 1 FROM categories)", [], |row| row.get(0))?;
        if already_seeded {
            return Ok(());
        }
        for name in DEFAULT_CATEGORIES {
            self.conn.execute("INSERT OR IGNORE INTO categories (name) VALUES (?1)", params![name])?;
        }
        Ok(())
    }

    /// A category used to be purely implicit — whatever string happened to
    /// sit in `transactions.category` or `budgets.category` — which meant a
    /// suggested-but-unused category (like "Business Expense") had nowhere
    /// to live, and a brand-new category typed for one transaction wasn't
    /// selectable for any other until the `categories` registry table
    /// existed. Every path that assigns a category *through the app*
    /// (`set_category`, `create_category`, `rename_category`) registers the
    /// name as it goes — but a file import carries its own category column
    /// straight from the bank (a Capital One export's "Category" column,
    /// say) and writes it directly onto the transaction via
    /// `save_transactions`, bypassing all of those. That left an imported
    /// category fully visible on the transaction row (which just renders
    /// whatever string is there) while being invisible to anything that
    /// reads the registry — the "All categories" filter and Manage
    /// Categories both come up short a category real transactions use.
    ///
    /// Run unconditionally on every launch — same "safe and cheap `INSERT
    /// OR IGNORE`" treatment as `backfill_budget_periods_if_missing` — so a
    /// category that reached `transactions`/`budgets` through any bypass,
    /// present or future, self-heals on the next launch instead of staying
    /// permanently invisible. Never resurrects a deliberately deleted
    /// category: `delete_category` nulls out every transaction (and
    /// removes every budget line) that referenced it in the same
    /// operation, so there's nothing left here to re-seed from.
    fn backfill_categories_from_usage(&self) -> rusqlite::Result<()> {
        self.conn.execute_batch(
            "INSERT OR IGNORE INTO categories (name) SELECT DISTINCT category FROM transactions WHERE category IS NOT NULL AND deleted_at IS NULL;
             INSERT OR IGNORE INTO categories (name) SELECT DISTINCT category FROM budgets;",
        )
    }

    /// `CREATE TABLE IF NOT EXISTS` above only creates a fresh table — it
    /// never alters one that already exists. A database from before
    /// accounts existed has a `transactions` table with no `account_id`
    /// column at all, so every account-aware query fails outright. This
    /// adds the column and backfills existing rows into a fallback account
    /// rather than losing them.
    fn migrate_add_account_id_if_missing(&self) -> rusqlite::Result<()> {
        let mut stmt = self.conn.prepare("PRAGMA table_info(transactions)")?;
        let mut rows = stmt.query([])?;
        let mut has_account_id = false;
        while let Some(row) = rows.next()? {
            let column_name: String = row.get(1)?;
            if column_name == "account_id" {
                has_account_id = true;
                break;
            }
        }
        drop(rows);
        drop(stmt);

        if has_account_id {
            return Ok(());
        }

        self.conn.execute("ALTER TABLE transactions ADD COLUMN account_id INTEGER", [])?;
        let fallback_id = self.get_or_create_account("Imported before accounts existed", AccountType::Other)?;
        self.conn
            .execute("UPDATE transactions SET account_id = ?1 WHERE account_id IS NULL", params![fallback_id])?;
        Ok(())
    }

    /// Same pattern as `migrate_add_account_id_if_missing`: a database from
    /// before soft-delete existed has no `deleted_at` column. `NULL`
    /// (not-deleted) is already correct for every existing row, so — like
    /// `confidence` below — no backfill beyond adding the column. Powers
    /// the Transactions tab's bulk-delete "Undo": `delete_transaction`/
    /// `bulk_delete_transactions` set this instead of actually removing
    /// the row, `restore_transactions` clears it back to `NULL`, and every
    /// production read of `transactions` filters `deleted_at IS NULL` (see
    /// each method's own comment for why a given one does or doesn't).
    fn migrate_add_deleted_at_if_missing(&self) -> rusqlite::Result<()> {
        let mut stmt = self.conn.prepare("PRAGMA table_info(transactions)")?;
        let mut rows = stmt.query([])?;
        let mut has_deleted_at = false;
        while let Some(row) = rows.next()? {
            let column_name: String = row.get(1)?;
            if column_name == "deleted_at" {
                has_deleted_at = true;
                break;
            }
        }
        drop(rows);
        drop(stmt);

        if has_deleted_at {
            return Ok(());
        }

        self.conn.execute("ALTER TABLE transactions ADD COLUMN deleted_at TEXT", [])?;
        Ok(())
    }

    /// Same pattern again: a database from before the day-gain/loss stat
    /// existed has no `prev_close`/`prev_close_date` columns on `holdings`.
    /// `NULL` for both is already correct for every existing row — it just
    /// means "no day-change data yet," resolved the same way a holding
    /// created today and never repriced is (see `list_holdings`).
    fn migrate_add_holdings_prev_close_if_missing(&self) -> rusqlite::Result<()> {
        let mut stmt = self.conn.prepare("PRAGMA table_info(holdings)")?;
        let mut rows = stmt.query([])?;
        let mut has_prev_close = false;
        while let Some(row) = rows.next()? {
            let column_name: String = row.get(1)?;
            if column_name == "prev_close" {
                has_prev_close = true;
                break;
            }
        }
        drop(rows);
        drop(stmt);

        if has_prev_close {
            return Ok(());
        }

        self.conn.execute("ALTER TABLE holdings ADD COLUMN prev_close TEXT", [])?;
        self.conn.execute("ALTER TABLE holdings ADD COLUMN prev_close_date TEXT", [])?;
        Ok(())
    }

    /// One-time data fixup, not a schema change: `set_account_balance_override`
    /// originally stored its checkpoint's `reset_date` as `as_of` itself
    /// instead of the day before it (see that method's own doc comment for
    /// why that's wrong — a transaction dated `as_of` added afterward would
    /// be silently excluded from every balance computed from then on).
    /// Nothing else ever rewrites an existing `balance_resets` row, so a
    /// database that already had a correction applied before this fix
    /// shipped would otherwise be stuck with the wrong date forever —
    /// permanently under-counting that account until the user happened to
    /// correct it again, which they should never have to know to do.
    ///
    /// Detectable unambiguously and safely: the fixed code can never
    /// produce a row where `reset_date` equals the date encoded in a
    /// `"manual:<date>"` period, since it always backs that date up by one
    /// day. Any row where it still does was provably written by the old
    /// code and is safe to correct in place. Idempotent — once corrected,
    /// a row no longer matches this shape, so re-running this on every
    /// launch (like every other migration here) is a no-op after the
    /// first.
    pub(super) fn migrate_fix_stale_manual_balance_override_reset_dates(&self) -> rusqlite::Result<()> {
        let mut stmt = self
            .conn
            .prepare("SELECT id, period FROM balance_resets WHERE period LIKE 'manual:%' AND reset_date = substr(period, 8)")?;
        let stale: Vec<(i64, String)> = stmt
            .query_map([], |row| Ok((row.get(0)?, row.get(1)?)))?
            .collect::<rusqlite::Result<Vec<_>>>()?;
        drop(stmt);

        for (id, period) in stale {
            let encoded = &period["manual:".len()..];
            let Ok(encoded_date) = NaiveDate::parse_from_str(encoded, "%Y-%m-%d") else {
                continue;
            };
            let Some(corrected) = encoded_date.pred_opt() else { continue };
            self.conn.execute(
                "UPDATE balance_resets SET reset_date = ?1 WHERE id = ?2",
                params![corrected.to_string(), id],
            )?;
        }
        Ok(())
    }

    /// Same pattern as `migrate_add_starting_balance_if_missing`: a
    /// database from before the loan sign convention flip has no
    /// `loan_sign_convention_migrated` column on `app_settings`. `0`
    /// (not yet migrated) is the correct backfill for every existing
    /// database — `migrate_flip_loan_transaction_signs_if_needed`, right
    /// below, is what actually acts on it.
    fn migrate_add_loan_sign_convention_migrated_if_missing(&self) -> rusqlite::Result<()> {
        let mut stmt = self.conn.prepare("PRAGMA table_info(app_settings)")?;
        let mut rows = stmt.query([])?;
        let mut has_column = false;
        while let Some(row) = rows.next()? {
            let column_name: String = row.get(1)?;
            if column_name == "loan_sign_convention_migrated" {
                has_column = true;
                break;
            }
        }
        drop(rows);
        drop(stmt);

        if has_column {
            return Ok(());
        }

        self.conn.execute(
            "ALTER TABLE app_settings ADD COLUMN loan_sign_convention_migrated INTEGER NOT NULL DEFAULT 0",
            [],
        )?;
        Ok(())
    }

    /// Same missing-column pattern as the migration just above: a database
    /// from before the rules manager has no `default_rules_seeded` column on
    /// `app_settings`. `0` (not yet seeded) is the right backfill —
    /// `seed_default_rules_once` is what acts on it, and it leaves a
    /// database that already has rules alone.
    fn migrate_add_default_rules_seeded_if_missing(&self) -> rusqlite::Result<()> {
        let mut stmt = self.conn.prepare("PRAGMA table_info(app_settings)")?;
        let mut rows = stmt.query([])?;
        let mut has_column = false;
        while let Some(row) = rows.next()? {
            let column_name: String = row.get(1)?;
            if column_name == "default_rules_seeded" {
                has_column = true;
                break;
            }
        }
        drop(rows);
        drop(stmt);

        if has_column {
            return Ok(());
        }

        self.conn
            .execute("ALTER TABLE app_settings ADD COLUMN default_rules_seeded INTEGER NOT NULL DEFAULT 0", [])?;
        Ok(())
    }

    /// The global "Rollover unspent" switch. On (`1`) for every pre-existing
    /// database, so nobody's budgets change until they turn it off themselves.
    fn migrate_add_rollover_setting_if_missing(&self) -> rusqlite::Result<()> {
        let mut stmt = self.conn.prepare("PRAGMA table_info(app_settings)")?;
        let mut rows = stmt.query([])?;
        let mut has_column = false;
        while let Some(row) = rows.next()? {
            let column_name: String = row.get(1)?;
            has_column |= column_name == "rollover_enabled";
        }
        drop(rows);
        drop(stmt);

        if !has_column {
            self.conn
                .execute("ALTER TABLE app_settings ADD COLUMN rollover_enabled INTEGER NOT NULL DEFAULT 1", [])?;
        }
        Ok(())
    }

    /// Existing profiles retain the Dashboard feature until they disable it.
    fn migrate_add_safe_to_spend_setting_if_missing(&self) -> rusqlite::Result<()> {
        let mut stmt = self.conn.prepare("PRAGMA table_info(app_settings)")?;
        let columns = stmt.query_map([], |row| row.get::<_, String>(1))?.collect::<rusqlite::Result<Vec<_>>>()?;
        if !columns.iter().any(|column| column == "safe_to_spend_enabled") {
            self.conn
                .execute("ALTER TABLE app_settings ADD COLUMN safe_to_spend_enabled INTEGER NOT NULL DEFAULT 1", [])?;
        }
        Ok(())
    }

    /// Opt-in auto-linking of transfers. The switch is off (`0`) for every
    /// pre-existing database. `transfer_links.auto` marks a link the app made
    /// itself (`0` = a person linked it) and `reviewed` says whether a person
    /// has looked at it since; every pre-existing link counts as reviewed
    /// (`1`), so nothing shows up on the review list that nobody auto-made.
    fn migrate_add_auto_link_support_if_missing(&self) -> rusqlite::Result<()> {
        let columns_of = |table: &str| -> rusqlite::Result<Vec<String>> {
            let mut stmt = self.conn.prepare(&format!("PRAGMA table_info({table})"))?;
            let names = stmt.query_map([], |row| row.get::<_, String>(1))?.collect::<rusqlite::Result<Vec<_>>>()?;
            Ok(names)
        };
        let link_columns = columns_of("transfer_links")?;
        if !link_columns.iter().any(|c| c == "auto") {
            self.conn
                .execute("ALTER TABLE transfer_links ADD COLUMN auto INTEGER NOT NULL DEFAULT 0", [])?;
        }
        if !link_columns.iter().any(|c| c == "reviewed") {
            self.conn
                .execute("ALTER TABLE transfer_links ADD COLUMN reviewed INTEGER NOT NULL DEFAULT 1", [])?;
        }
        if !columns_of("app_settings")?.iter().any(|c| c == "auto_link_transfers") {
            self.conn
                .execute("ALTER TABLE app_settings ADD COLUMN auto_link_transfers INTEGER NOT NULL DEFAULT 0", [])?;
        }
        Ok(())
    }

    /// The inflation figure behind "today's dollars" on an investment
    /// account's projection. Existing databases get the 3% default.
    fn migrate_add_inflation_setting_if_missing(&self) -> rusqlite::Result<()> {
        let mut stmt = self.conn.prepare("PRAGMA table_info(app_settings)")?;
        let has_column = stmt
            .query_map([], |row| row.get::<_, String>(1))?
            .collect::<rusqlite::Result<Vec<_>>>()?
            .iter()
            .any(|c| c == "inflation_pct");
        drop(stmt);
        if !has_column {
            self.conn
                .execute("ALTER TABLE app_settings ADD COLUMN inflation_pct TEXT NOT NULL DEFAULT '3'", [])?;
        }
        Ok(())
    }

    /// Same pattern once more: the opt-in "run in the tray and remind me about
    /// bills" setting and its "start when I sign in" companion. Both off (`0`)
    /// for every pre-existing database.
    fn migrate_add_background_settings_if_missing(&self) -> rusqlite::Result<()> {
        let mut stmt = self.conn.prepare("PRAGMA table_info(app_settings)")?;
        let mut rows = stmt.query([])?;
        let mut has_tray = false;
        let mut has_autostart = false;
        while let Some(row) = rows.next()? {
            let column_name: String = row.get(1)?;
            has_tray |= column_name == "tray_enabled";
            has_autostart |= column_name == "autostart_enabled";
        }
        drop(rows);
        drop(stmt);

        if !has_tray {
            self.conn
                .execute("ALTER TABLE app_settings ADD COLUMN tray_enabled INTEGER NOT NULL DEFAULT 0", [])?;
        }
        if !has_autostart {
            self.conn
                .execute("ALTER TABLE app_settings ADD COLUMN autostart_enabled INTEGER NOT NULL DEFAULT 0", [])?;
        }
        Ok(())
    }

    /// Same pattern once more: `cleared` marks a transaction as having shown up
    /// on a bank statement — what reconciliation ticks off. `0` for every
    /// pre-existing row; nothing else in the app reads it.
    fn migrate_add_cleared_to_transactions_if_missing(&self) -> rusqlite::Result<()> {
        let mut stmt = self.conn.prepare("PRAGMA table_info(transactions)")?;
        let mut rows = stmt.query([])?;
        let mut has_column = false;
        while let Some(row) = rows.next()? {
            let column_name: String = row.get(1)?;
            if column_name == "cleared" {
                has_column = true;
                break;
            }
        }
        drop(rows);
        drop(stmt);

        if has_column {
            return Ok(());
        }

        self.conn
            .execute("ALTER TABLE transactions ADD COLUMN cleared INTEGER NOT NULL DEFAULT 0", [])?;
        Ok(())
    }

    /// Same pattern once more: `rollover_enabled` lets a budget line carry its
    /// unspent money into the next month. Off (`0`) for every pre-existing
    /// row, so no budget changes until the user opts a category in.
    fn migrate_add_rollover_to_budgets_if_missing(&self) -> rusqlite::Result<()> {
        let mut stmt = self.conn.prepare("PRAGMA table_info(budgets)")?;
        let mut rows = stmt.query([])?;
        let mut has_column = false;
        while let Some(row) = rows.next()? {
            let column_name: String = row.get(1)?;
            if column_name == "rollover_enabled" {
                has_column = true;
                break;
            }
        }
        drop(rows);
        drop(stmt);

        if has_column {
            return Ok(());
        }

        self.conn
            .execute("ALTER TABLE budgets ADD COLUMN rollover_enabled INTEGER NOT NULL DEFAULT 0", [])?;
        Ok(())
    }

    /// Same pattern once more: an optional second folder every backup is also
    /// copied to (see `src-tauri/src/backups.rs`). `NULL` — the default for
    /// every pre-existing database — means the feature is off.
    fn migrate_add_backup_copy_dir_if_missing(&self) -> rusqlite::Result<()> {
        let mut stmt = self.conn.prepare("PRAGMA table_info(app_settings)")?;
        let mut rows = stmt.query([])?;
        let mut has_column = false;
        while let Some(row) = rows.next()? {
            let column_name: String = row.get(1)?;
            if column_name == "backup_copy_dir" {
                has_column = true;
                break;
            }
        }
        drop(rows);
        drop(stmt);

        if has_column {
            return Ok(());
        }

        self.conn.execute("ALTER TABLE app_settings ADD COLUMN backup_copy_dir TEXT", [])?;
        Ok(())
    }

    /// One-time flip of the loan sign convention: every loan-account
    /// transaction already in the database was entered under the old rule
    /// (negative = payment, positive = new debt) before
    /// `account_balance_as_of` switched loans to the credit-matching rule
    /// (positive = payment, reducing what's owed — see `StoredAccount`'s
    /// doc comment). Negating every existing loan transaction's stored
    /// amount here keeps `current_balance` numerically identical to what
    /// it was before the flip; only newly entered transactions are
    /// expected to follow the new rule directly.
    ///
    /// Unlike every other migration in this file, this can't be made
    /// idempotent by detecting an "old shape" — a stored amount like
    /// `-45.00` is a valid transaction under both conventions, so there's
    /// no data shape to key off. It uses an explicit one-time flag instead
    /// (`app_settings.loan_sign_convention_migrated`), same idea as this
    /// file's `_enabled` feature toggles but recording "already done"
    /// rather than a user preference.
    pub(super) fn migrate_flip_loan_transaction_signs_if_needed(&self) -> rusqlite::Result<()> {
        let already_migrated: bool = self
            .conn
            .query_row("SELECT loan_sign_convention_migrated FROM app_settings WHERE id = 1", [], |row| {
                row.get(0)
            })
            .unwrap_or(false);
        if already_migrated {
            return Ok(());
        }

        let mut stmt = self.conn.prepare(
            "SELECT t.id, t.amount FROM transactions t
             JOIN accounts a ON a.id = t.account_id
             WHERE a.account_type = 'loan'",
        )?;
        let loan_transactions: Vec<(i64, String)> = stmt
            .query_map([], |row| Ok((row.get(0)?, row.get(1)?)))?
            .collect::<rusqlite::Result<Vec<_>>>()?;
        drop(stmt);

        for (id, amount_str) in loan_transactions {
            let amount = Decimal::from_str(&amount_str).expect("amount stored by this crate must be valid");
            self.conn
                .execute("UPDATE transactions SET amount = ?1 WHERE id = ?2", params![(-amount).to_string(), id])?;
        }

        self.conn.execute(
            "INSERT INTO app_settings (id, loan_sign_convention_migrated) VALUES (1, 1)
             ON CONFLICT(id) DO UPDATE SET loan_sign_convention_migrated = 1",
            [],
        )?;
        Ok(())
    }

    /// Same pattern as `migrate_add_account_id_if_missing`: a database from
    /// before the confidence indicator existed has no `confidence` column
    /// at all. `NULL` is already the correct value for every existing row
    /// (a rule match or a user correction never had a numeric confidence),
    /// so no backfill is needed beyond adding the column.
    fn migrate_add_confidence_if_missing(&self) -> rusqlite::Result<()> {
        let mut stmt = self.conn.prepare("PRAGMA table_info(transactions)")?;
        let mut rows = stmt.query([])?;
        let mut has_confidence = false;
        while let Some(row) = rows.next()? {
            let column_name: String = row.get(1)?;
            if column_name == "confidence" {
                has_confidence = true;
                break;
            }
        }
        drop(rows);
        drop(stmt);

        if has_confidence {
            return Ok(());
        }

        self.conn.execute("ALTER TABLE transactions ADD COLUMN confidence REAL", [])?;
        Ok(())
    }

    /// Same pattern again: a database from before account balances existed
    /// has no `starting_balance` column. Backfills existing accounts to
    /// `'0'` — the same default a fresh account gets — so their balance
    /// simply equals the sum of their transactions until the user sets a
    /// real one.
    fn migrate_add_starting_balance_if_missing(&self) -> rusqlite::Result<()> {
        let mut stmt = self.conn.prepare("PRAGMA table_info(accounts)")?;
        let mut rows = stmt.query([])?;
        let mut has_starting_balance = false;
        while let Some(row) = rows.next()? {
            let column_name: String = row.get(1)?;
            if column_name == "starting_balance" {
                has_starting_balance = true;
                break;
            }
        }
        drop(rows);
        drop(stmt);

        if has_starting_balance {
            return Ok(());
        }

        self.conn.execute("ALTER TABLE accounts ADD COLUMN starting_balance TEXT", [])?;
        self.conn
            .execute("UPDATE accounts SET starting_balance = '0' WHERE starting_balance IS NULL", [])?;
        Ok(())
    }

    /// Same pattern once more: `institution`/`mask` are both nullable and
    /// optional, so a missing-column database just needs the columns
    /// added — `NULL` is already the correct "not set" value, no backfill.
    fn migrate_add_institution_and_mask_if_missing(&self) -> rusqlite::Result<()> {
        let mut stmt = self.conn.prepare("PRAGMA table_info(accounts)")?;
        let mut rows = stmt.query([])?;
        let mut has_institution = false;
        while let Some(row) = rows.next()? {
            let column_name: String = row.get(1)?;
            if column_name == "institution" {
                has_institution = true;
                break;
            }
        }
        drop(rows);
        drop(stmt);

        if has_institution {
            return Ok(());
        }

        self.conn.execute("ALTER TABLE accounts ADD COLUMN institution TEXT", [])?;
        self.conn.execute("ALTER TABLE accounts ADD COLUMN mask TEXT", [])?;
        Ok(())
    }

    /// Same pattern once more: `interest_rate` (an annual percentage, used
    /// by the debt payoff planner) is nullable and optional — a missing-
    /// column database just needs the column added, `NULL` already meaning
    /// "not set" (treated as 0% by `debt_payoff_projection`).
    fn migrate_add_interest_rate_if_missing(&self) -> rusqlite::Result<()> {
        let mut stmt = self.conn.prepare("PRAGMA table_info(accounts)")?;
        let mut rows = stmt.query([])?;
        let mut has_interest_rate = false;
        while let Some(row) = rows.next()? {
            let column_name: String = row.get(1)?;
            if column_name == "interest_rate" {
                has_interest_rate = true;
                break;
            }
        }
        drop(rows);
        drop(stmt);

        if has_interest_rate {
            return Ok(());
        }

        self.conn.execute("ALTER TABLE accounts ADD COLUMN interest_rate TEXT", [])?;
        Ok(())
    }

    /// Same pattern once more: `principal_amount` lets a transaction
    /// recorded directly on a loan account (as opposed to via
    /// `apply_debt_payment`) specify that only part of it should count
    /// toward what's owed — a mortgage payment bundles principal, interest,
    /// and escrow, and only the principal portion should move the balance
    /// (see `account_balance_as_of`, which reads
    /// `COALESCE(principal_amount, amount)`). `NULL` for every pre-existing
    /// row means "no override," i.e. today's already-correct full-amount
    /// behavior, so nothing changes for anyone not using this.
    fn migrate_add_principal_amount_if_missing(&self) -> rusqlite::Result<()> {
        let mut stmt = self.conn.prepare("PRAGMA table_info(transactions)")?;
        let mut rows = stmt.query([])?;
        let mut has_principal_amount = false;
        while let Some(row) = rows.next()? {
            let column_name: String = row.get(1)?;
            if column_name == "principal_amount" {
                has_principal_amount = true;
                break;
            }
        }
        drop(rows);
        drop(stmt);

        if has_principal_amount {
            return Ok(());
        }

        self.conn.execute("ALTER TABLE transactions ADD COLUMN principal_amount TEXT", [])?;
        Ok(())
    }

    /// Same pattern again: a database from before optional transaction notes
    /// existed has no `notes` column. `NULL` (no note) is already correct
    /// for every existing row.
    fn migrate_add_notes_to_transactions_if_missing(&self) -> rusqlite::Result<()> {
        let mut stmt = self.conn.prepare("PRAGMA table_info(transactions)")?;
        let mut rows = stmt.query([])?;
        let mut has_notes = false;
        while let Some(row) = rows.next()? {
            let column_name: String = row.get(1)?;
            if column_name == "notes" {
                has_notes = true;
                break;
            }
        }
        drop(rows);
        drop(stmt);

        if has_notes {
            return Ok(());
        }

        self.conn.execute("ALTER TABLE transactions ADD COLUMN notes TEXT", [])?;
        Ok(())
    }

    /// Same pattern once more: `excluded_from_debt_payoff` lets a debt
    /// account (e.g. a credit card paid in full every month) opt out of
    /// `debt_payoff_projection` without deleting the account itself.
    /// Defaults to `0` (included) for every pre-existing row.
    fn migrate_add_excluded_from_debt_payoff_if_missing(&self) -> rusqlite::Result<()> {
        let mut stmt = self.conn.prepare("PRAGMA table_info(accounts)")?;
        let mut rows = stmt.query([])?;
        let mut has_column = false;
        while let Some(row) = rows.next()? {
            let column_name: String = row.get(1)?;
            if column_name == "excluded_from_debt_payoff" {
                has_column = true;
                break;
            }
        }
        drop(rows);
        drop(stmt);

        if has_column {
            return Ok(());
        }

        self.conn
            .execute("ALTER TABLE accounts ADD COLUMN excluded_from_debt_payoff INTEGER NOT NULL DEFAULT 0", [])?;
        Ok(())
    }

    /// Same pattern once more, repeated per table: `member_id` (which
    /// `family_members` row this row is attributed to) is nullable and
    /// optional — a missing-column database just needs the column added,
    /// `NULL` already meaning "unassigned."
    fn migrate_add_member_id_to_accounts_if_missing(&self) -> rusqlite::Result<()> {
        let mut stmt = self.conn.prepare("PRAGMA table_info(accounts)")?;
        let mut rows = stmt.query([])?;
        let mut has_column = false;
        while let Some(row) = rows.next()? {
            let column_name: String = row.get(1)?;
            if column_name == "member_id" {
                has_column = true;
                break;
            }
        }
        drop(rows);
        drop(stmt);

        if has_column {
            return Ok(());
        }

        self.conn.execute("ALTER TABLE accounts ADD COLUMN member_id INTEGER", [])?;
        Ok(())
    }

    /// Same pattern once more: `transactions.member_id` — see
    /// `migrate_add_member_id_to_accounts_if_missing`.
    fn migrate_add_member_id_to_transactions_if_missing(&self) -> rusqlite::Result<()> {
        let mut stmt = self.conn.prepare("PRAGMA table_info(transactions)")?;
        let mut rows = stmt.query([])?;
        let mut has_column = false;
        while let Some(row) = rows.next()? {
            let column_name: String = row.get(1)?;
            if column_name == "member_id" {
                has_column = true;
                break;
            }
        }
        drop(rows);
        drop(stmt);

        if has_column {
            return Ok(());
        }

        self.conn.execute("ALTER TABLE transactions ADD COLUMN member_id INTEGER", [])?;
        Ok(())
    }

    /// Same pattern once more: `recurring.member_id` — see
    /// `migrate_add_member_id_to_accounts_if_missing`.
    fn migrate_add_member_id_to_recurring_if_missing(&self) -> rusqlite::Result<()> {
        let mut stmt = self.conn.prepare("PRAGMA table_info(recurring)")?;
        let mut rows = stmt.query([])?;
        let mut has_column = false;
        while let Some(row) = rows.next()? {
            let column_name: String = row.get(1)?;
            if column_name == "member_id" {
                has_column = true;
                break;
            }
        }
        drop(rows);
        drop(stmt);

        if has_column {
            return Ok(());
        }

        self.conn.execute("ALTER TABLE recurring ADD COLUMN member_id INTEGER", [])?;
        Ok(())
    }

    /// Same pattern once more: `status` (`"keep"` | `"reviewing"` |
    /// `"canceled"`) is a purely user-facing audit label for the Recurring
    /// tab's spend-audit view — it never suppresses a `recurring` row from
    /// `next_occurrence`-driven surfaces (Cash Flow's forecast, Dashboard's
    /// "due soon" list, `recurring_totals`), since the app has no way to
    /// verify a bill has genuinely stopped in real life; `delete_recurring`
    /// is still the only way to actually stop tracking something. Defaults
    /// to `'keep'` for every pre-existing row and every future row
    /// `create_recurring` inserts without mentioning this column.
    fn migrate_add_status_to_recurring_if_missing(&self) -> rusqlite::Result<()> {
        let mut stmt = self.conn.prepare("PRAGMA table_info(recurring)")?;
        let mut rows = stmt.query([])?;
        let mut has_column = false;
        while let Some(row) = rows.next()? {
            let column_name: String = row.get(1)?;
            if column_name == "status" {
                has_column = true;
                break;
            }
        }
        drop(rows);
        drop(stmt);

        if has_column {
            return Ok(());
        }

        self.conn
            .execute("ALTER TABLE recurring ADD COLUMN status TEXT NOT NULL DEFAULT 'keep'", [])?;
        Ok(())
    }

    /// Same pattern once more: `buckets.member_id` — see
    /// `migrate_add_member_id_to_accounts_if_missing`.
    fn migrate_add_member_id_to_buckets_if_missing(&self) -> rusqlite::Result<()> {
        let mut stmt = self.conn.prepare("PRAGMA table_info(buckets)")?;
        let mut rows = stmt.query([])?;
        let mut has_column = false;
        while let Some(row) = rows.next()? {
            let column_name: String = row.get(1)?;
            if column_name == "member_id" {
                has_column = true;
                break;
            }
        }
        drop(rows);
        drop(stmt);

        if has_column {
            return Ok(());
        }

        self.conn.execute("ALTER TABLE buckets ADD COLUMN member_id INTEGER", [])?;
        Ok(())
    }

    /// Same pattern once more: `assets.member_id` — see
    /// `migrate_add_member_id_to_accounts_if_missing`.
    fn migrate_add_member_id_to_assets_if_missing(&self) -> rusqlite::Result<()> {
        let mut stmt = self.conn.prepare("PRAGMA table_info(assets)")?;
        let mut rows = stmt.query([])?;
        let mut has_column = false;
        while let Some(row) = rows.next()? {
            let column_name: String = row.get(1)?;
            if column_name == "member_id" {
                has_column = true;
                break;
            }
        }
        drop(rows);
        drop(stmt);

        if has_column {
            return Ok(());
        }

        self.conn.execute("ALTER TABLE assets ADD COLUMN member_id INTEGER", [])?;
        Ok(())
    }
}
