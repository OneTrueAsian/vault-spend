//! Settings stored in the database: live prices, app features, background/tray, reminders and backup copies.

use super::{Store, StoredAppSettings};
use chrono::{NaiveDate, NaiveDateTime};
use rusqlite::params;
use rust_decimal::Decimal;

/// The opt-in "keep running in the tray" behaviour — see `src-tauri`'s
/// tray and reminder code.
#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub struct BackgroundSettings {
    /// Closing the window hides it to the tray, and bills due soon are
    /// reminded about even while the window is closed.
    pub tray_enabled: bool,
    /// Vault Spend starts (hidden, in the tray) when the user signs in.
    pub autostart_enabled: bool,
}

/// A bill that's due soon and hasn't been reminded about yet — see
/// `Store::reminders_to_send`.
#[derive(Debug, Clone, PartialEq)]
pub struct BillReminder {
    pub recurring_id: i64,
    pub merchant: String,
    /// Negative, like the bill itself.
    pub amount: Decimal,
    pub due_date: NaiveDate,
}

/// Minimal open-database projection. The row id is used only to match live reminders;
/// callers must persist only the opaque identity, due date, and sent date.
#[derive(Debug, Clone, PartialEq)]
pub struct ReminderProjection {
    pub recurring_id: i64,
    pub opaque_id: String,
    pub due_date: NaiveDate,
    pub last_notified: Option<NaiveDate>,
}

/// Opt-in live-price configuration (see `Store::get_live_price_settings`).
/// `api_key` being `None` means the feature is off — holding prices stay
/// fully manual, exactly like before this existed. `provider` is the raw
/// stored identifier (`"alpha_vantage"`/`"finnhub"`) — kept as a plain
/// `String` here rather than an enum so `core` stays free of any
/// src-tauri-side concern; `src-tauri::live_price_provider::LivePriceProvider`
/// is what actually interprets it.
#[derive(Debug, Clone, PartialEq)]
pub struct StoredLivePriceSettings {
    pub api_key: Option<String>,
    pub provider: String,
    pub last_refreshed_at: Option<NaiveDateTime>,
}

impl Store {
    /// The opt-in live-price feature's current state. No row exists in
    /// `live_price_settings` until the user actually saves an API key —
    /// this returns the "off" state rather than synthesizing one, so a
    /// profile that never touches this feature has nothing written to its
    /// database for it (same lazy-write principle as the rest of this
    /// app's optional features).
    pub fn get_live_price_settings(&self) -> rusqlite::Result<StoredLivePriceSettings> {
        let row = match self.conn.query_row(
            "SELECT api_key, provider, last_refreshed_at FROM live_price_settings WHERE id = 1",
            [],
            |row| {
                Ok((
                    row.get::<_, Option<String>>(0)?,
                    row.get::<_, String>(1)?,
                    row.get::<_, Option<String>>(2)?,
                ))
            },
        ) {
            Ok(v) => Some(v),
            Err(rusqlite::Error::QueryReturnedNoRows) => None,
            Err(e) => return Err(e),
        };
        let (api_key, provider, last_refreshed_at) = row.unwrap_or((None, "alpha_vantage".to_string(), None));
        let last_refreshed_at =
            last_refreshed_at.map(|s| NaiveDateTime::parse_from_str(&s, "%Y-%m-%d %H:%M:%S").expect("timestamp stored by this crate must be valid"));
        Ok(StoredLivePriceSettings {
            api_key,
            provider,
            last_refreshed_at,
        })
    }

    /// Sets (or, with `api_key: None`, clears/disables) the live-price
    /// feature's provider and API key together — a key is never stored
    /// disassociated from which provider it belongs to. Disabling still
    /// writes `provider` (only `api_key` clears) so Settings can
    /// pre-select the last-used provider if the user re-enables later.
    /// Clearing the key does not touch `last_refreshed_at` or any holding
    /// price already on record — it only stops future refreshes from
    /// happening.
    pub fn set_live_price_settings(&self, provider: &str, api_key: Option<&str>) -> rusqlite::Result<()> {
        self.conn.execute(
            "INSERT INTO live_price_settings (id, provider, api_key) VALUES (1, ?1, ?2)
             ON CONFLICT(id) DO UPDATE SET provider = ?1, api_key = ?2",
            params![provider, api_key],
        )?;
        Ok(())
    }

    /// Records when a live-price refresh last ran (regardless of whether
    /// every symbol in it succeeded) — shown in Settings so the user can
    /// see the feature is actually working.
    pub fn set_live_prices_last_refreshed(&self, at: NaiveDateTime) -> rusqlite::Result<()> {
        self.conn.execute(
            "INSERT INTO live_price_settings (id, last_refreshed_at) VALUES (1, ?1)
             ON CONFLICT(id) DO UPDATE SET last_refreshed_at = ?1",
            params![at.format("%Y-%m-%d %H:%M:%S").to_string()],
        )?;
        Ok(())
    }

    /// No row yet means nobody has ever touched a toggle — defaults to
    /// every feature on, matching how each of these three already behaved
    /// before this setting existed.
    pub fn get_app_settings(&self) -> rusqlite::Result<StoredAppSettings> {
        let row = match self.conn.query_row(
            "SELECT apply_to_debt_enabled, split_purchases_enabled, envelope_caps_enabled, rollover_enabled, auto_link_transfers, safe_to_spend_enabled FROM app_settings WHERE id = 1",
            [],
            |row| {
                Ok((
                    row.get::<_, bool>(0)?,
                    row.get::<_, bool>(1)?,
                    row.get::<_, bool>(2)?,
                    row.get::<_, bool>(3)?,
                    row.get::<_, bool>(4)?,
                    row.get::<_, bool>(5)?,
                ))
            },
        ) {
            Ok(v) => Some(v),
            Err(rusqlite::Error::QueryReturnedNoRows) => None,
            Err(e) => return Err(e),
        };
        // Everything defaults on except auto-linking, which is opt-in.
        let (apply_to_debt_enabled, split_purchases_enabled, envelope_caps_enabled, rollover_enabled, auto_link_transfers, safe_to_spend_enabled) =
            row.unwrap_or((true, true, true, true, false, true));
        Ok(StoredAppSettings {
            apply_to_debt_enabled,
            split_purchases_enabled,
            envelope_caps_enabled,
            rollover_enabled,
            auto_link_transfers,
            safe_to_spend_enabled,
        })
    }

    /// The opt-in "link matching transfers automatically" switch. Turning it
    /// off stops future auto-linking; links already made stay (unlink any of
    /// them from Transactions).
    pub fn set_auto_link_transfers(&self, enabled: bool) -> rusqlite::Result<()> {
        self.conn.execute(
            "INSERT INTO app_settings (id, auto_link_transfers) VALUES (1, ?1)
             ON CONFLICT(id) DO UPDATE SET auto_link_transfers = ?1",
            params![enabled],
        )?;
        Ok(())
    }

    /// See the doc comment on `StoredAppSettings` — off means no unspent
    /// budget is carried into a later month; every category's stored
    /// rollover choice and every budget row stays exactly as it was.
    pub fn set_rollover_enabled(&self, enabled: bool) -> rusqlite::Result<()> {
        self.conn.execute(
            "INSERT INTO app_settings (id, rollover_enabled) VALUES (1, ?1)
             ON CONFLICT(id) DO UPDATE SET rollover_enabled = ?1",
            params![enabled],
        )?;
        Ok(())
    }

    pub fn set_safe_to_spend_enabled(&self, enabled: bool) -> rusqlite::Result<()> {
        self.conn.execute(
            "INSERT INTO app_settings (id, safe_to_spend_enabled) VALUES (1, ?1)
             ON CONFLICT(id) DO UPDATE SET safe_to_spend_enabled = ?1",
            params![enabled],
        )?;
        Ok(())
    }

    pub fn set_apply_to_debt_enabled(&self, enabled: bool) -> rusqlite::Result<()> {
        self.conn.execute(
            "INSERT INTO app_settings (id, apply_to_debt_enabled) VALUES (1, ?1)
             ON CONFLICT(id) DO UPDATE SET apply_to_debt_enabled = ?1",
            params![enabled],
        )?;
        Ok(())
    }

    pub fn set_split_purchases_enabled(&self, enabled: bool) -> rusqlite::Result<()> {
        self.conn.execute(
            "INSERT INTO app_settings (id, split_purchases_enabled) VALUES (1, ?1)
             ON CONFLICT(id) DO UPDATE SET split_purchases_enabled = ?1",
            params![enabled],
        )?;
        Ok(())
    }

    /// See the doc comment on `StoredAppSettings` — this suspends the cap
    /// tier's effect in `budget_alerts_for_month` without touching any
    /// category's stored `cap_enabled` flag.
    pub fn set_envelope_caps_enabled(&self, enabled: bool) -> rusqlite::Result<()> {
        self.conn.execute(
            "INSERT INTO app_settings (id, envelope_caps_enabled) VALUES (1, ?1)
             ON CONFLICT(id) DO UPDATE SET envelope_caps_enabled = ?1",
            params![enabled],
        )?;
        Ok(())
    }

    pub fn get_background_settings(&self) -> rusqlite::Result<BackgroundSettings> {
        match self
            .conn
            .query_row("SELECT tray_enabled, autostart_enabled FROM app_settings WHERE id = 1", [], |row| {
                Ok((row.get::<_, bool>(0)?, row.get::<_, bool>(1)?))
            }) {
            Ok((tray_enabled, autostart_enabled)) => Ok(BackgroundSettings {
                tray_enabled,
                autostart_enabled,
            }),
            Err(rusqlite::Error::QueryReturnedNoRows) => Ok(BackgroundSettings {
                tray_enabled: false,
                autostart_enabled: false,
            }),
            Err(e) => Err(e),
        }
    }

    pub fn set_tray_enabled(&self, enabled: bool) -> rusqlite::Result<()> {
        self.conn.execute(
            "INSERT INTO app_settings (id, tray_enabled) VALUES (1, ?1)
             ON CONFLICT(id) DO UPDATE SET tray_enabled = ?1",
            params![enabled],
        )?;
        Ok(())
    }

    pub fn set_autostart_enabled(&self, enabled: bool) -> rusqlite::Result<()> {
        self.conn.execute(
            "INSERT INTO app_settings (id, autostart_enabled) VALUES (1, ?1)
             ON CONFLICT(id) DO UPDATE SET autostart_enabled = ?1",
            params![enabled],
        )?;
        Ok(())
    }

    /// Bills that fall due within `window_days` of `today` (a zero window is
    /// just today) and haven't been reminded about for that due date: only
    /// active bills (money out, not canceled), and never one due today whose
    /// charge has already posted. Soonest first. Each is sent once per due
    /// date — `mark_reminder_sent` records it, and the bill's next cycle is a
    /// new due date and a new reminder.
    pub fn reminders_to_send(&self, today: NaiveDate, window_days: i64) -> rusqlite::Result<Vec<BillReminder>> {
        let horizon = today + chrono::Duration::days(window_days);
        let already_posted_today: std::collections::HashSet<i64> = self
            .recurring_matches(today)?
            .into_iter()
            .filter(|m| m.state == "paid" && m.last_due == Some(today))
            .map(|m| m.recurring_id)
            .collect();
        let mut sent: std::collections::HashSet<(i64, String)> = std::collections::HashSet::new();
        {
            let mut stmt = self.conn.prepare("SELECT recurring_id, due_date FROM reminders_sent")?;
            let rows = stmt.query_map([], |row| Ok((row.get::<_, i64>(0)?, row.get::<_, String>(1)?)))?;
            for row in rows {
                sent.insert(row?);
            }
        }

        Ok(self
            .list_recurring(today)?
            .into_iter()
            .filter(|r| r.status != "canceled" && r.amount < Decimal::ZERO)
            .filter(|r| r.next_date >= today && r.next_date <= horizon)
            .filter(|r| !(r.next_date == today && already_posted_today.contains(&r.id)))
            .filter(|r| !sent.contains(&(r.id, r.next_date.to_string())))
            .map(|r| BillReminder {
                recurring_id: r.id,
                merchant: r.merchant,
                amount: r.amount,
                due_date: r.next_date,
            })
            .collect())
    }

    /// One next occurrence for every active expense, including those outside the three-day
    /// notification window. This read-only cache projection remains useful while locked as
    /// future dates enter that window. It never projects a paid bill due today.
    pub fn reminder_projection(&self, today: NaiveDate) -> rusqlite::Result<Vec<ReminderProjection>> {
        let paid: std::collections::HashSet<i64> = self
            .recurring_matches(today)?
            .into_iter()
            .filter(|m| m.state == "paid" && m.last_due == Some(today))
            .map(|m| m.recurring_id)
            .collect();
        self.list_recurring(today)?
            .into_iter()
            .filter(|r| r.status != "canceled" && r.amount < Decimal::ZERO)
            .filter(|r| !(r.next_date == today && paid.contains(&r.id)))
            .map(|r| {
                let (opaque_id, sent): (String, Option<String>) = self.conn.query_row(
                    "SELECT i.opaque_id, s.sent_on FROM reminder_identities i
                     LEFT JOIN reminders_sent s ON s.recurring_id = i.recurring_id AND s.due_date = ?2
                     WHERE i.recurring_id = ?1",
                    params![r.id, r.next_date.to_string()],
                    |row| Ok((row.get(0)?, row.get(1)?)),
                )?;
                Ok(ReminderProjection {
                    recurring_id: r.id,
                    opaque_id,
                    due_date: r.next_date,
                    last_notified: sent.and_then(|s| s.parse().ok()),
                })
            })
            .collect()
    }

    /// Records that the reminder for this bill and due date went out, so it
    /// isn't sent again. Recording twice is harmless.
    pub fn mark_reminder_sent(&self, recurring_id: i64, due_date: NaiveDate, today: NaiveDate) -> rusqlite::Result<()> {
        self.conn.execute(
            "INSERT OR IGNORE INTO reminders_sent (recurring_id, due_date, sent_on) VALUES (?1, ?2, ?3)",
            params![recurring_id, due_date.to_string(), today.to_string()],
        )?;
        Ok(())
    }

    /// The second folder backups are also copied to, if the user chose one.
    /// A separate getter/setter rather than a field on `StoredAppSettings`,
    /// so that struct's many existing constructors and call sites stay put.
    pub fn get_backup_copy_dir(&self) -> rusqlite::Result<Option<String>> {
        match self.conn.query_row("SELECT backup_copy_dir FROM app_settings WHERE id = 1", [], |row| {
            row.get::<_, Option<String>>(0)
        }) {
            Ok(dir) => Ok(dir.filter(|d| !d.trim().is_empty())),
            Err(rusqlite::Error::QueryReturnedNoRows) => Ok(None),
            Err(e) => Err(e),
        }
    }

    /// Sets (or, with `None` or a blank string, clears) the second backup
    /// folder. Only stores the choice — `backups::mirror_backup` is what
    /// checks the folder is actually usable.
    pub fn set_backup_copy_dir(&self, dir: Option<&str>) -> rusqlite::Result<()> {
        let dir = dir.map(str::trim).filter(|d| !d.is_empty());
        self.conn.execute(
            "INSERT INTO app_settings (id, backup_copy_dir) VALUES (1, ?1)
             ON CONFLICT(id) DO UPDATE SET backup_copy_dir = ?1",
            params![dir],
        )?;
        Ok(())
    }

    /// How many live-price requests have been sent today (`today`'s local
    /// calendar day). A pure read — rolls back over to 0 whenever the
    /// stored count is from an earlier day, but doesn't write anything;
    /// `record_live_price_request` is the only thing that actually persists
    /// the rollover. No row at all also just means 0, same as every other
    /// lazily-created live-price setting.
    pub fn live_price_requests_used_today(&self, today: NaiveDate) -> rusqlite::Result<i64> {
        let row = match self.conn.query_row(
            "SELECT requests_used_today, requests_count_date FROM live_price_settings WHERE id = 1",
            [],
            |row| Ok((row.get::<_, i64>(0)?, row.get::<_, Option<String>>(1)?)),
        ) {
            Ok(v) => Some(v),
            Err(rusqlite::Error::QueryReturnedNoRows) => None,
            Err(e) => return Err(e),
        };
        let Some((count, count_date)) = row else {
            return Ok(0);
        };
        let is_today = count_date.as_deref() == Some(today.format("%Y-%m-%d").to_string().as_str());
        Ok(if is_today { count } else { 0 })
    }

    /// Records one live-price request actually sent to Alpha Vantage today
    /// — rolling the counter over to 1 (not incrementing) if the stored
    /// count is from an earlier day — and returns the new total. Called
    /// once per request regardless of whether it succeeded, returned no
    /// data, or hit Alpha Vantage's own rate limit; it still spent one of
    /// today's free-tier requests either way.
    pub fn record_live_price_request(&self, today: NaiveDate) -> rusqlite::Result<i64> {
        let next = self.live_price_requests_used_today(today)? + 1;
        self.conn.execute(
            "INSERT INTO live_price_settings (id, requests_used_today, requests_count_date) VALUES (1, ?1, ?2)
             ON CONFLICT(id) DO UPDATE SET requests_used_today = ?1, requests_count_date = ?2",
            params![next, today.format("%Y-%m-%d").to_string()],
        )?;
        Ok(next)
    }
}
