use super::*;
use rusqlite::OptionalExtension;
use serde::Serialize;

#[derive(Debug, Serialize)]
pub struct RetirementAccount {
    pub id: i64,
    pub name: String,
}
#[derive(Debug)]
pub enum RetirementReadError {
    AccountUnavailable,
    TooManyAccounts,
    InvalidData,
    Store(StoreError),
}
impl From<StoreError> for RetirementReadError {
    fn from(e: StoreError) -> Self {
        Self::Store(e)
    }
}
#[derive(Debug, Serialize)]
pub struct RetirementWorth {
    pub amount: Option<String>,
    pub basis: &'static str,
}
#[derive(Debug, Serialize)]
#[serde(tag = "kind", rename_all = "kebab-case")]
pub enum RetirementContribution {
    Missing,
    Saved {
        #[serde(rename = "monthlyAmount")]
        monthly_amount: String,
    },
    History {
        #[serde(rename = "monthlyAmount")]
        monthly_amount: String,
        #[serde(rename = "fromMonth")]
        from_month: String,
        #[serde(rename = "toMonth")]
        to_month: String,
        #[serde(rename = "monthCount")]
        month_count: i32,
    },
}
#[derive(Debug, Serialize)]
#[serde(tag = "kind", rename_all = "kebab-case")]
pub enum RetirementReturn {
    StoredPlan {
        #[serde(rename = "annualPct")]
        annual_pct: String,
    },
    ApplicationDefault {
        #[serde(rename = "annualPct")]
        annual_pct: String,
    },
}
#[derive(Debug, Serialize)]
#[serde(tag = "kind", rename_all = "kebab-case")]
pub enum RetirementInflation {
    Stored { pct: String },
    ApplicationDefault { pct: String },
}
#[derive(Debug, Serialize)]
pub struct RetirementInvestmentAccount {
    pub id: i64,
    pub name: String,
    pub r#type: &'static str,
}
#[derive(Debug, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct RetirementContextData {
    pub account: RetirementInvestmentAccount,
    pub worth: RetirementWorth,
    pub contribution: RetirementContribution,
    pub return_assumption: RetirementReturn,
    pub inflation: RetirementInflation,
    pub retirement_month: Option<String>,
}
fn decimal(s: &str) -> Result<Decimal, RetirementReadError> {
    Decimal::from_str_exact(s).map_err(|_| RetirementReadError::InvalidData)
}
const MAX_COEFFICIENT: i128 = 79_228_162_514_264_337_593_543_950_335;
fn from_coefficient(mut coefficient: i128, mut scale: u32) -> Result<Decimal, RetirementReadError> {
    while scale > 0 && coefficient % 10 == 0 {
        coefficient /= 10;
        scale -= 1;
    }
    if scale > 28 || coefficient.unsigned_abs() > MAX_COEFFICIENT as u128 {
        return Err(RetirementReadError::InvalidData);
    }
    Ok(Decimal::from_i128_with_scale(coefficient, scale))
}
fn bounded_add(a: Decimal, b: Decimal) -> Result<Decimal, RetirementReadError> {
    let scale = a.scale().max(b.scale());
    let left = a
        .mantissa()
        .checked_mul(10i128.pow(scale - a.scale()))
        .ok_or(RetirementReadError::InvalidData)?;
    let right = b
        .mantissa()
        .checked_mul(10i128.pow(scale - b.scale()))
        .ok_or(RetirementReadError::InvalidData)?;
    from_coefficient(left.checked_add(right).ok_or(RetirementReadError::InvalidData)?, scale)
}
fn mean_cents(sum: Decimal, count: i32) -> Result<Decimal, RetirementReadError> {
    // Divide the exact integer ratio directly into cents. Decimal division followed by round_dp can round twice.
    let numerator = sum.mantissa() * 100;
    let denominator = 10i128.pow(sum.scale()) * i128::from(count);
    let cents = numerator / denominator + i128::from((numerator % denominator) * 2 >= denominator);
    from_coefficient(cents, 2)
}
fn bounded_product(a: Decimal, b: Decimal) -> Result<Decimal, RetirementReadError> {
    let (mut left, mut right, mut scale) = (a.mantissa(), b.mantissa(), a.scale() + b.scale());
    // Cancel decimal factors before multiplying. A valid 96-bit result can have a 192-bit unnormalised product.
    while scale > 0 {
        if left % 10 == 0 {
            left /= 10;
        } else if right % 10 == 0 {
            right /= 10;
        } else if left % 2 == 0 && right % 5 == 0 {
            left /= 2;
            right /= 5;
        } else if left % 5 == 0 && right % 2 == 0 {
            left /= 5;
            right /= 2;
        } else {
            break;
        }
        scale -= 1;
    }
    from_coefficient(left.checked_mul(right).ok_or(RetirementReadError::InvalidData)?, scale)
}
fn index(date: NaiveDate) -> i32 {
    date.year() * 12 + date.month0() as i32
}
fn month(i: i32) -> String {
    format!("{:04}-{:02}", i.div_euclid(12), i.rem_euclid(12) + 1)
}
impl Store {
    pub fn retirement_accounts(&self, _as_of: NaiveDate) -> Result<Vec<RetirementAccount>, RetirementReadError> {
        let mut stmt = self
            .conn
            .prepare("SELECT id,name FROM accounts WHERE account_type='investment' ORDER BY name COLLATE BINARY,id LIMIT 201")?;
        let accounts = stmt
            .query_map([], |r| {
                Ok(RetirementAccount {
                    id: r.get(0)?,
                    name: r.get(1)?,
                })
            })?
            .collect::<Result<Vec<_>, _>>()?;
        if accounts.len() > 200 {
            return Err(RetirementReadError::TooManyAccounts);
        }
        if accounts
            .iter()
            .any(|a| a.id <= 0 || a.id > 9_007_199_254_740_991 || a.name.trim().is_empty() || a.name.chars().count() > 512)
        {
            return Err(RetirementReadError::InvalidData);
        }
        Ok(accounts)
    }
    /// Called inside the command's single read_snapshot. Restricted to one account; never list_accounts.
    pub fn retirement_context(&self, account_id: i64, as_of: NaiveDate) -> Result<RetirementContextData, RetirementReadError> {
        let row = self
            .conn
            .query_row(
                "SELECT name,starting_balance FROM accounts WHERE id=?1 AND account_type='investment'",
                params![account_id],
                |r| Ok((r.get::<_, String>(0)?, r.get::<_, String>(1)?)),
            )
            .optional()?;
        let (name, start) = row.ok_or(RetirementReadError::AccountUnavailable)?;
        if account_id <= 0 || account_id > 9_007_199_254_740_991 || name.trim().is_empty() || name.chars().count() > 512 {
            return Err(RetirementReadError::InvalidData);
        }
        let start = decimal(&start)?;
        // Same holdings valuation as Accounts: sum(shares * price), with a selected-account query and checked Decimal arithmetic.
        let mut stmt = self.conn.prepare("SELECT shares,price FROM holdings WHERE account_id=?1")?;
        let holdings = stmt
            .query_map(params![account_id], |r| Ok((r.get::<_, String>(0)?, r.get::<_, String>(1)?)))?
            .collect::<Result<Vec<_>, _>>()?;
        let worth = if !holdings.is_empty() {
            let mut value = Decimal::ZERO;
            for (shares, price) in holdings {
                let shares = decimal(&shares)?.normalize();
                let price = decimal(&price)?.normalize();
                value = bounded_add(value, bounded_product(shares, price)?)?;
            }
            RetirementWorth {
                amount: Some(value.normalize().to_string()),
                basis: "holdings",
            }
        } else {
            let recorded:bool=self.conn.query_row("SELECT EXISTS(SELECT 1 FROM transactions WHERE account_id=?1 AND date<=?2 AND deleted_at IS NULL) OR EXISTS(SELECT 1 FROM balance_resets WHERE account_id=?1 AND reset_date<=?2)",params![account_id,as_of.to_string()],|r|r.get(0))?;
            if !recorded && start.is_zero() {
                RetirementWorth { amount: None, basis: "none" }
            } else {
                let checkpoint = self.latest_checkpoint(account_id, as_of)?;
                let mut sum = Decimal::ZERO;
                let mut amounts=self.conn.prepare("SELECT COALESCE(principal_amount,amount) FROM transactions WHERE account_id=?1 AND date<=?2 AND deleted_at IS NULL AND (?3 IS NULL OR date>?3)")?;
                for amount in amounts.query_map(params![account_id, as_of.to_string(), checkpoint.map(|c| c.0.to_string())], |r| {
                    r.get::<_, String>(0)
                })? {
                    sum = bounded_add(sum, decimal(&amount?)?)?;
                }
                bounded_add(checkpoint.map(|c| c.1).unwrap_or(start), sum)?;
                RetirementWorth {
                    amount: Some(
                        self.account_balance_as_of(account_id, "investment", start, as_of)?
                            .normalize()
                            .to_string(),
                    ),
                    basis: "transactions",
                }
            }
        };
        let plan_exists: bool = self.conn.query_row(
            "SELECT EXISTS(SELECT 1 FROM investment_plans WHERE account_id=?1)",
            params![account_id],
            |r| r.get(0),
        )?;
        let plan = self.get_investment_plan(account_id)?;
        if plan.annual_return_pct < Decimal::ZERO
            || plan.annual_return_pct > Decimal::from(100)
            || plan.monthly_contribution.is_some_and(|m| m < Decimal::ZERO)
        {
            return Err(RetirementReadError::InvalidData);
        }
        let contribution = if let Some(saved) = plan.monthly_contribution.filter(|_| plan_exists) {
            RetirementContribution::Saved {
                monthly_amount: saved.normalize().to_string(),
            }
        } else {
            // Guard only the history that is actually needed. A saved amount (including zero) must not read unused history.
            let this_month = as_of.with_day(1).ok_or(RetirementReadError::InvalidData)?;
            let window_from = this_month
                .checked_sub_months(chrono::Months::new(6))
                .ok_or(RetirementReadError::InvalidData)?;
            let window_through = this_month.pred_opt().ok_or(RetirementReadError::InvalidData)?;
            let mut deposits = Decimal::ZERO;
            let mut withdrawals = Decimal::ZERO;
            let mut amounts = self
                .conn
                .prepare("SELECT amount FROM transactions WHERE account_id=?1 AND date>=?2 AND date<=?3 AND deleted_at IS NULL ORDER BY date")?;
            for amount in amounts.query_map(params![account_id, window_from.to_string(), window_through.to_string()], |r| {
                r.get::<_, String>(0)
            })? {
                let amount = decimal(&amount?)?;
                if amount > Decimal::ZERO {
                    deposits = bounded_add(deposits, amount)?;
                } else {
                    withdrawals = bounded_add(withdrawals, -amount)?;
                }
            }
            bounded_add(deposits, -withdrawals)?;
            // Reuse the existing per-account contribution authority, keeping exact Decimal month totals (not the legacy JS mean).
            let history = self.account_contributions_in_window(account_id, as_of, Some((window_from, window_through)))?;
            if let Some(first) = history.first_deposit {
                let end = index(as_of) - 1;
                let start = index(first).max(end - 5);
                if start > end {
                    RetirementContribution::Missing
                } else {
                    let mut sum = Decimal::ZERO;
                    for row in history.months.iter().filter(|r| r.month >= month(start) && r.month <= month(end)) {
                        sum = bounded_add(sum, row.money_in)?;
                    }
                    let mean = mean_cents(sum, end - start + 1)?;
                    RetirementContribution::History {
                        monthly_amount: mean.normalize().to_string(),
                        from_month: month(start),
                        to_month: month(end),
                        month_count: end - start + 1,
                    }
                }
            } else {
                RetirementContribution::Missing
            }
        };
        let inflation_exists: bool = self
            .conn
            .query_row("SELECT EXISTS(SELECT 1 FROM app_settings WHERE id=1)", [], |r| r.get(0))?;
        let inflation = self.get_inflation_pct()?;
        if inflation < Decimal::ZERO || inflation > Decimal::from(100) {
            return Err(RetirementReadError::InvalidData);
        }
        Ok(RetirementContextData {
            account: RetirementInvestmentAccount {
                id: account_id,
                name,
                r#type: "investment",
            },
            worth,
            contribution,
            return_assumption: if plan_exists {
                RetirementReturn::StoredPlan {
                    annual_pct: plan.annual_return_pct.normalize().to_string(),
                }
            } else {
                RetirementReturn::ApplicationDefault {
                    annual_pct: plan.annual_return_pct.normalize().to_string(),
                }
            },
            inflation: if inflation_exists {
                RetirementInflation::Stored {
                    pct: inflation.normalize().to_string(),
                }
            } else {
                RetirementInflation::ApplicationDefault {
                    pct: inflation.normalize().to_string(),
                }
            },
            retirement_month: plan.withdraw_month.map(|d| d.format("%Y-%m").to_string()),
        })
    }
}
