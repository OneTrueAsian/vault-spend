// The practice layer of the main household: every feature's "loose ends" (see COVERAGE.md), added on top of the tidy
// household in the same Python session, so it reuses its accounts (checking, savings, jsav, visa, ...), its date
// helpers (today, month_start, on) and its random seed. Merged from the old `npm run demo` data, the statements demo's
// practice accounts and the 1.3.4 UAT rows. Every account's balance still comes only from its own rows.
export const PRACTICE_PY = String.raw`
# ---------------------------------------------------------------------------
# Practice layer
# ---------------------------------------------------------------------------
def days_ago(n):
    return today - datetime.timedelta(days=n)

# A second person, Alex, who earns the ACME pay and buys the fuel, so per-person views show two people plus Shared.
# (The tidy household keeps Jordan alone: specs check its one-person layout.)
cur.execute("INSERT INTO family_members (name) VALUES ('Alex')")
alex = cur.lastrowid
cur.execute("UPDATE transactions SET member_id = ? WHERE description IN ('ACME CORP PAYROLL', 'Shell Oil')", (alex,))

# Rows a rule sorted ("Sorted by: Your rule"); the Shell Oil rule itself is added below.
cur.execute("UPDATE transactions SET category_source = 'rule' WHERE description IN ('Shell Oil', 'Netflix')")

pfp = [0]
def ptx(acc, date, desc, amt, cat, source="user", member=None, confidence=None):
    if date is None:
        return None
    pfp[0] += 1
    cur.execute("INSERT INTO transactions (account_id, date, description, amount, category, category_source, confidence, fingerprint, member_id) VALUES (?,?,?,?,?,?,?,?,?)",
                (acc, date.isoformat(), desc, f"{amt:.2f}", cat, (source if cat else None), confidence, f"practice-{pfp[0]}", member))
    return cur.lastrowid

def link(out_id, in_id, auto=0, reviewed=1):
    if out_id and in_id:
        cur.execute("INSERT INTO transfer_links (out_transaction_id, in_transaction_id, auto, reviewed) VALUES (?,?,?,?)", (out_id, in_id, auto, reviewed))

for name in ("Savings Goal", "Gifts", "Pet Care", "Medical", "Health", "Household", "Rent"):
    cur.execute("INSERT OR IGNORE INTO categories (name) VALUES (?)", (name,))

# Possible transfers to review: the monthly savings move as an ordinary category, unlinked, this month and last.
for back in (1, 0):
    ptx(checking, on(back, 2), "Transfer to Savings", -500.00, "Savings Goal")
    ptx(savings, on(back, 2), "Transfer from Checking", 500.00, "Savings Goal")

# Too far apart to be suggested (10 days): link these two by hand.
ptx(checking, days_ago(12), "Venmo to Sam", -120.00, "Gifts")
ptx(savings, days_ago(2), "Zelle from Sam", 120.00, "Gifts")

# Auto-linking: one link the app made that is waiting for review; an ambiguous move (one out, two deposits) that
# stays a suggestion; and an outgoing move whose deposit has not arrived yet.
link(ptx(checking, days_ago(5), "Move to Jordan's Savings", -350.00, "Transfer"),
     ptx(jsav, days_ago(5), "From Joint Checking", 350.00, "Transfer", member=jordan), auto=1, reviewed=0)
ptx(checking, days_ago(9), "Holiday Fund Transfer", -250.00, "Savings Goal")
ptx(savings, days_ago(9), "Holiday Fund Deposit", 250.00, "Savings Goal")
ptx(savings, days_ago(8), "Holiday Fund Deposit Copy", 250.00, "Savings Goal")
ptx(checking, days_ago(1), "Car Fund Transfer", -180.00, "Savings Goal")

# Categorizing: uncategorized rows, three identical trios for "apply to similar", a large charge and a duplicate pair.
ptx(checking, days_ago(6), "SQ *MYSTERY VENDOR 8841", -42.10, None)
ptx(checking, days_ago(4), "PAYPAL *INST XFER", -88.00, None)
for n, d in enumerate((9, 5, 1)):
    ptx(visa, days_ago(d), "Ferrywood Coffee", -round(4.2 + n * 0.35, 2), None)
for n, d in enumerate((8, 3, 0)):
    ptx(visa, days_ago(d), "Corner Cart", -round(3.0 + n * 0.10, 2), None)
for n, d in enumerate((7, 4, 1)):
    ptx(visa, days_ago(d), "Lunch Truck", -round(9.0 + n * 0.25, 2), None)
ptx(visa, days_ago(12), "Home Depot", -412.30, "Shopping")
ptx(visa, days_ago(2), "Chipotle", -14.25, "Dining Out")
ptx(visa, days_ago(2), "Chipotle", -14.25, "Dining Out")

# Review inbox: a shaky auto-category and a merchant the history can suggest for.
ptx(visa, days_ago(2), "Local Bakery Co", -11.50, "Dining Out", source="classifier", confidence=0.55)
ptx(visa, days_ago(1), "STARBUCKS #1042 SEATTLE", -6.75, None)

# A split purchase, tags and a note.
costco = ptx(checking, days_ago(6), "Costco Wholesale", -186.40, "Groceries")
if costco:
    for cat, amt, note in (("Groceries", "-120.40", None), ("Household", "-66.00", "Paper towels and cleaning")):
        cur.execute("INSERT INTO transaction_splits (transaction_id, category, amount, note) VALUES (?,?,?,?)", (costco, cat, amt, note))
    cur.execute("INSERT INTO transaction_tags (transaction_id, tag) VALUES (?, 'bulk buy')", (costco,))

# An account that has gone quiet.
cur.execute("INSERT INTO accounts (name, account_type, starting_balance, institution, mask) VALUES ('Old Checking', 'checking', '300.00', 'Regional Bank', '0912')")
ptx(cur.lastrowid, days_ago(60), "Dormant Deposit", 25.00, "Income")

# Bills: one whose price went up, one missed, one due yesterday and not posted yet, one steady.
def add_months(d, n):
    total = d.year * 12 + d.month - 1 + n
    y, m = divmod(total, 12)
    m += 1
    leap = y % 4 == 0 and (y % 100 != 0 or y % 400 == 0)
    dim = [31, 29 if leap else 28, 31, 30, 31, 30, 31, 31, 30, 31, 30, 31][m - 1]
    return datetime.date(y, m, min(d.day, dim))

def step_month(d):
    # Mirrors the backend's add_one_month: same day next month, walking back if it doesn't exist.
    y, m = (d.year + 1, 1) if d.month == 12 else (d.year, d.month + 1)
    for back in range(4):
        try:
            return datetime.date(y, m, d.day - back)
        except ValueError:
            pass

def bill(merchant, category, stored_amount, days_since_last_due, description, charges):
    anchor = add_months(today - datetime.timedelta(days=days_since_last_due), -3)
    cur.execute("INSERT INTO recurring (merchant, category, amount, cadence, anchor_date, account_id) VALUES (?,?,?,?,?,?)",
                (merchant, category, stored_amount, "monthly", anchor.isoformat(), checking))
    dues, d = [], anchor
    while d <= today:
        dues.append(d)
        d = step_month(d)
    for i, due in enumerate(reversed(dues)):
        if i in charges:
            ptx(checking, due, description, -charges[i], category)

bill("Hulu", "Subscriptions", "-14.99", 2, "HULU 877-8244858", {0: 17.99, 1: 14.99, 2: 14.99, 3: 14.99})
bill("Peak Climbing Gym", "Subscriptions", "-32.00", 20, "PEAK CLIMBING GYM", {1: 32.00, 2: 32.00, 3: 32.00})
bill("CloudBox Storage", "Subscriptions", "-9.99", 1, "CLOUDBOX STORAGE 8005551234", {1: 9.99, 2: 9.99, 3: 9.99})
bill("Trash & Recycling", "Utilities", "-41.20", 6, "CITY TRASH & RECYCLING", {0: 41.20, 1: 41.20, 2: 41.20, 3: 41.20})

# Budget: Household rolls its unspent money forward; Dining Out warns at 90% this month; Pet Care has spending but
# no budget line (for suggested amounts); last month has two overspent categories and two uncategorized rows.
cur.execute("UPDATE budgets SET rollover_enabled = 1 WHERE category = 'Household'")
cur.execute("UPDATE budgets SET cap_enabled = 1 WHERE category = 'Dining Out' AND period = ?", (month_start(0).strftime("%Y-%m"),))
for back, amount in ((3, 71.25), (2, 88.00), (1, 62.50)):
    ptx(visa, on(back, 18), "Pet Supplies Plus", -amount, "Pet Care")
ptx(visa, on(1, 16), "Big Box Outlet", -310.00, "Shopping")
ptx(visa, on(1, 19), "Prime Steakhouse", -145.00, "Dining Out")
ptx(checking, on(1, 10), "SQ *POP-UP MARKET", -18.40, None)
ptx(visa, on(1, 17), "VENMO CASHOUT", -60.00, None)

# The 1.3.4 UAT rows: a one-off medical bill, a reimbursed work dinner and its repayment (all marked Exclude from
# budget), a linked transfer, and last month's water heater (marked), with a Medical budget this month.
this_first = month_start(0)
ptx(checking, this_first, "UAT Pharmacy", -40.00, "Medical")
uat_marked = [
    ptx(checking, this_first, "UAT City Hospital ER bill", -1850.00, "Medical"),
    ptx(checking, this_first, "UAT Client dinner (work)", -240.00, "Dining Out"),
    ptx(checking, this_first, "UAT Employer reimbursement", 240.00, "Income"),
    ptx(checking, month_start(1).replace(day=14), "UAT Water heater replacement", -400.00, "Household"),
]
for tid in uat_marked:
    cur.execute("UPDATE transactions SET excluded_from_budget = 1 WHERE id = ?", (tid,))
cur.execute("UPDATE transactions SET notes = 'Client dinner, paid back by my employer' WHERE id = ?", (uat_marked[1],))
cur.execute("INSERT INTO transaction_tags (transaction_id, tag) VALUES (?, 'work')", (uat_marked[1],))
cur.execute("INSERT INTO transaction_tags (transaction_id, tag) VALUES (?, 'work')", (uat_marked[2],))
link(ptx(checking, this_first, "UAT Move to savings", -300.00, "Transfer"),
     ptx(savings, this_first, "UAT Move from checking", 300.00, "Transfer"))
cur.execute("INSERT OR REPLACE INTO budgets (category, period, monthly_amount, budget_group) VALUES ('Medical', ?, '500.00', 'flexible')", (this_first.strftime("%Y-%m"),))

# Goals: on track, behind, one without an account, one that follows an account's balance, and a sinking fund.
def bucket(name, target, tdate, acc, sinking=None):
    cur.execute("INSERT INTO buckets (name, target_amount, target_date, account_id, sinking_amount) VALUES (?,?,?,?,?)", (name, target, tdate, acc, sinking))
    return cur.lastrowid
b1 = bucket("Emergency Fund", "15000.00", None, savings)
b2 = bucket("Japan Trip", "5000.00", (today + datetime.timedelta(days=200)).isoformat(), savings)
b3 = bucket("New Laptop", "1800.00", (today + datetime.timedelta(days=90)).isoformat(), None)
b4 = bucket("Holiday Gifts", "900.00", (today + datetime.timedelta(days=150)).isoformat(), None)
bucket("Car Registration", "180.00", add_months(today, 8).isoformat(), None, "15.00")
for b, amts in [(b1, [1500, 500, 500, 750, 500, 500]), (b2, [400, 400, 600, 300]), (b3, [250, 250]), (b4, [200, 200, 200])]:
    for i, a in enumerate(amts):
        cur.execute("INSERT INTO bucket_contributions (bucket_id, date, amount) VALUES (?,?,?)", (b, month_start(len(amts) - i).isoformat(), f"{a:.2f}"))
cur.execute("INSERT INTO buckets (name, target_amount, account_id, tracks_account) VALUES ('Down Payment', '25000.00', ?, 1)", (savings,))

# Reconciliation practice: a statement ending balance of $2,896.60 covers the first four rows.
cur.execute("INSERT INTO accounts (name, account_type, starting_balance, institution, mask) VALUES ('Statement Checking', 'checking', '2000.00', 'Harbor Credit Union', '7742')")
statement = cur.lastrowid
for days, desc, amt, cat in ((28, "Payroll Deposit", 1500.00, "Income"), (24, "Landlord Payment", -420.00, "Rent"),
                             (20, "Grocery Mart", -63.40, "Groceries"), (15, "Electric Co", -120.00, "Utilities"),
                             (9, "Pharmacy", -45.25, "Health"), (3, "Gas & Go", -80.00, "Gas")):
    ptx(statement, days_ago(days), desc, amt, cat)

# Statement-file practice accounts (their PDFs are in files/, see files.mjs). No categories: the app suggests them.
def plain(name, typ, start):
    cur.execute("INSERT INTO accounts (name, account_type, starting_balance) VALUES (?,?,?)", (name, typ, start))
    return cur.lastrowid
practice = plain("Practice Checking", "checking", "1000.00")
ptx(practice, on(2, 5), "Coffee Shop", -50.00, None)
ptx(practice, on(2, 12), "Gas Station", -30.00, None)
plain("Riverbend Checking", "checking", "0.00")
plain("Corner Credit Union", "checking", "0.00")
harbor = plain("Harborview Brokerage", "investment", "0.00")
ptx(harbor, on(2, 2), "Deposit from bank", 1000.00, None)
cur.execute("INSERT INTO holdings (account_id, symbol, name, shares, price, cost_basis, asset_class) VALUES (?, 'QQQZ', 'NASDAQ TRACKER FUND', '10', '300.25', '3000.00', 'US Stocks')", (harbor,))
rewards = plain("Rewards Card", "credit", "0.00")
ptx(rewards, on(2, 6), "Grocery Market", -64.10, None)
ptx(rewards, on(2, 14), "Streaming Service", -12.99, None)
ptx(rewards, on(2, 21), "Fuel Stop", -38.40, None)

# Investments: accumulation and projection (a Roth with a missed month and a withdrawal; two 529s with plans; a
# brokerage with holdings but no deposits), allocation targets, and value history.
def inv(name, inst, mask):
    cur.execute("INSERT INTO accounts (name, account_type, starting_balance, institution, mask) VALUES (?,?,?,?,?)", (name, "investment", "0.00", inst, mask))
    return cur.lastrowid
sroth = inv("Sample Roth IRA", "Fidelity", "8822")
sam529 = inv("Sam's 529", "Vanguard", "5529")
alex529 = inv("Alex's 529", "Vanguard", "5530")
fid = inv("Fidelity Brokerage", "Fidelity", "3307")
for back in range(13, -1, -1):
    if back != 5:
        ptx(sroth, month_start(back), "Roth contribution", 450.00, "Transfer")
ptx(sroth, month_start(3).replace(day=12), "Roth withdrawal", -310.00, "Transfer")
for back in range(14, -1, -1):
    ptx(sam529, month_start(back), "529 contribution - Sam", 275.00, "Transfer")
for back in range(8, -1, -1):
    ptx(alex529, month_start(back), "529 contribution - Alex", 225.00, "Transfer", member=alex)
for acc, sym, name, sh, price, basis, cls in [
    (sroth, "VTI", "Vanguard Total Stock Market ETF", "20", "296.40", "5400.00", "US Stock"),
    (sroth, "VXUS", "Vanguard Total International", "30", "68.15", "1900.00", "Intl Stock"),
    (sam529, "VTI", "Vanguard Total Stock Market ETF", "10", "296.40", "2500.00", "US Stock"),
    (sam529, "BND", "Vanguard Total Bond Market", "25", "73.20", "1800.00", "Bond"),
    (alex529, "BND", "Vanguard Total Bond Market", "20", "73.20", "1400.00", "Bond"),
    (alex529, "VTI", "Vanguard Total Stock Market ETF", "4", "296.40", "1000.00", "US Stock"),
    (fid, "VTI", "Vanguard Total Stock Market ETF", "48", "296.40", "11040.00", "US Stock"),
    (fid, "BND", "Vanguard Total Bond Market", "40", "73.20", "3100.00", "Bond"),
]:
    cur.execute("INSERT INTO holdings (account_id, symbol, name, shares, price, cost_basis, asset_class) VALUES (?,?,?,?,?,?,?)",
                (acc, sym, name, sh, price, basis, cls))
for acc, now_value in ((sroth, 20 * 296.40 + 30 * 68.15), (sam529, 10 * 296.40 + 25 * 73.20)):
    for i in range(30, 0, -1):
        value = now_value * (0.95 + 0.0017 * (30 - i)) + 35 * ((i * 5) % 7 - 3)
        cur.execute("INSERT INTO account_value_snapshots (account_id, date, value) VALUES (?,?,?)", (acc, days_ago(i).isoformat(), f"{value:.2f}"))
first_of_this_month = today.replace(day=1)
cur.execute("INSERT INTO investment_plans (account_id, monthly_contribution, annual_return_pct, withdraw_date, withdraw_years) VALUES (?,?,?,?,?)",
            (sam529, None, "6", add_months(first_of_this_month, 84).isoformat(), 4))
cur.execute("INSERT INTO investment_plans (account_id, monthly_contribution, annual_return_pct, withdraw_date, withdraw_years) VALUES (?,?,?,?,?)",
            (alex529, None, "7", add_months(first_of_this_month, 132).isoformat(), None))
for cls, pct in (("US Stock", "55"), ("Intl Stock", "20"), ("Bond", "25")):
    cur.execute("INSERT INTO allocation_targets (asset_class, percent) VALUES (?, ?)", (cls, pct))
total = sum(float(s) * float(p) for s, p in cur.execute("SELECT shares, price FROM holdings").fetchall())
for i in range(24, 0, -1):
    value = total * (0.93 + 0.0030 * (24 - i)) + 90 * ((i * 7) % 5 - 2)
    cur.execute("INSERT INTO portfolio_snapshots (date, value) VALUES (?, ?)", (days_ago(i).isoformat(), f"{value:.2f}"))

# A categorization rule (Ferrywood Coffee is left for making one in the rules walk-through).
cur.execute("INSERT INTO rules (pattern, category) VALUES ('Shell Oil', 'Gas')")

# Opt-in features on, so each shows with its data.
cur.execute("""INSERT INTO app_settings (id, budget_exclusion_enabled, auto_link_transfers, safe_to_spend_enabled, envelope_caps_enabled, rollover_enabled)
               VALUES (1, 1, 1, 1, 1, 1)
               ON CONFLICT(id) DO UPDATE SET budget_exclusion_enabled = 1, auto_link_transfers = 1, safe_to_spend_enabled = 1,
                                             envelope_caps_enabled = 1, rollover_enabled = 1""")
`;
