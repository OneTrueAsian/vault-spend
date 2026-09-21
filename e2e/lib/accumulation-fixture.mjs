// A small, fixed set of investment accounts for the accumulation & projection
// specs that look at several accounts together (feature94, feature95). Every
// date is relative to today; every figure the specs expect is derived from the
// numbers below (see e2e/lib/accumulation.mjs for the independent maths).
//
//   Joey Roth IRA   6 x $450 deposits (back 6..1), holdings worth $10,000,
//                   plan: 7%, withdraw in 36 months, no monthly saved (uses the
//                   $450 average), no "spread over years"
//   Sam's 529       4 x $275 deposits (back 4..1), holdings worth $3,000,
//                   plan: $300 a month saved, 6%, withdraw in 60 months, spread over 3 years
//   Alex's 529      2 x $225 deposits (back 2..1), holdings worth $1,000, no plan
//   Fidelity Brokerage  holdings worth $2,000, no deposits, no plan

export const SUMMARY_FIXTURE_PY = `
import datetime
today = datetime.date.today()

def month_start(back):
    total = today.year * 12 + today.month - 1 - back
    y, m = divmod(total, 12)
    return datetime.date(y, m + 1, 1)

def acct(name, typ):
    cur.execute("INSERT INTO accounts (name, account_type, starting_balance) VALUES (?,?,?)", (name, typ, "0.00"))
    return cur.lastrowid

counter = [0]
def deposit(account_id, when, description, amount):
    counter[0] += 1
    cur.execute("INSERT INTO transactions (account_id, date, description, amount, category, category_source, fingerprint) VALUES (?,?,?,?,?,?,?)",
                (account_id, when.isoformat(), description, amount, "Transfer", "user", f"acc-fixture-{counter[0]}"))

def holding(account_id, symbol, shares, price, basis):
    cur.execute("INSERT INTO holdings (account_id, symbol, name, shares, price, cost_basis, asset_class) VALUES (?,?,?,?,?,?,?)",
                (account_id, symbol, symbol + " fund", shares, price, basis, "US Stock"))

def plan(account_id, monthly, pct, months_ahead, years):
    d = month_start(-months_ahead).isoformat()
    cur.execute("INSERT INTO investment_plans (account_id, monthly_contribution, annual_return_pct, withdraw_date, withdraw_years) VALUES (?,?,?,?,?)",
                (account_id, monthly, pct, d, years))

roth = acct("Joey Roth IRA", "investment")
sam = acct("Sam's 529", "investment")
alex = acct("Alex's 529", "investment")
brokerage = acct("Fidelity Brokerage", "investment")

for back in range(6, 0, -1):
    deposit(roth, month_start(back), f"Roth deposit {back}", "450.00")
for back in range(4, 0, -1):
    deposit(sam, month_start(back), f"Sam deposit {back}", "275.00")
for back in range(2, 0, -1):
    deposit(alex, month_start(back), f"Alex deposit {back}", "225.00")

holding(roth, "VTI", "20", "500.00", "8000.00")
holding(sam, "VXUS", "10", "300.00", "2500.00")
holding(alex, "BND", "5", "200.00", "900.00")
holding(brokerage, "AAPL", "2", "1000.00", "1500.00")

plan(roth, None, "7", 36, None)
plan(sam, "300.00", "6", 60, 3)
`;

/** What the fixture adds up to, worked out by hand. */
export const SUMMARY_EXPECTED = {
  rows: 4,
  invested: { "Joey Roth IRA": 2700, "Sam's 529": 1100, "Alex's 529": 450, "Fidelity Brokerage": 0 },
  worth: { "Joey Roth IRA": 10000, "Sam's 529": 3000, "Alex's 529": 1000, "Fidelity Brokerage": 2000 },
  monthly: { "Joey Roth IRA": 450, "Sam's 529": 300, "Alex's 529": 225 },
  totalInvested: 4250,
  totalWorth: 16000,
  totalMonthly: 975,
};
