//! Creating the tables and upgrading older databases in place (`init_schema` and the `migrate_*` steps).

mod migrations;

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
            -- An import file's category name (trimmed, lower-cased) and the person's
            -- category it maps to, remembered for the next import.
            CREATE TABLE IF NOT EXISTS import_category_mappings (
                file_category TEXT PRIMARY KEY,
                category TEXT NOT NULL COLLATE NOCASE
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
            );
            CREATE TABLE IF NOT EXISTS statement_layouts (
                id INTEGER PRIMARY KEY AUTOINCREMENT,
                name TEXT NOT NULL,
                layout TEXT NOT NULL,
                created_at TEXT NOT NULL,
                updated_at TEXT NOT NULL
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
        self.migrate_add_account_hidden_if_missing()?;
        self.migrate_add_account_import_columns_if_missing()?;
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
        self.migrate_add_reconciliation_links_if_missing()?;
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
             CREATE INDEX IF NOT EXISTS idx_transactions_account_reconciliation ON transactions(account_id, reconciliation_id) WHERE deleted_at IS NULL;
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
        self.backfill_categories_from_usage()?;
        self.migrate_historical_accounting()
    }
}
