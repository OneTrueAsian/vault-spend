// The demo dataset behind `npm run demo` (see e2e/demo.mjs): a realistic
// household — six months of history, a budget, goals, holdings, recurring
// bills and a paycheck — plus a few deliberately "loose ends" so every
// feature added in the enhancement phases has something to act on the moment
// the app opens. Every date is relative to *today*, so the demo never goes
// stale (bills are always due in the next few days, the budget is always the
// current month).
//
// Loose ends on purpose (Phase 1):
//   - two savings transfers waiting to be linked ("possible transfers"), one
//     pair too far apart to be suggested (link it by hand), older pairs
//     already linked;
//   - a few uncategorized transactions, a trio of identical "Corner Cart"
//     rows (try correcting one -> "apply to similar"), a trio of "Lunch
//     Truck" rows (same offer, via the bulk bar), and "Ferrywood Coffee"
//     rows for the rules manager;
//   - an account that's gone quiet for 60 days (Dashboard "To do");
//   - budgeted income well above budgeted expenses ("unallocated");
//   - NO family members, so Household shows its empty state.
//
// Loose ends on purpose (Phase 2):
//   - recurring bills that line up with real charges: Hulu (paid, but the last
//     charge went up), Iron Works Gym (a missed charge), CloudBox Storage (due
//     yesterday, not posted yet), Water Utility (paid, steady);
//   - Pet Care and Health spending with no budget line, for "Suggest from
//     3-month average"; a Household line with rollover on;
//   - last month with over-budget categories and uncategorized rows, for the
//     month-end review;
//   - goals: one on track, ones behind, one that follows the savings balance;
//   - a low-confidence auto-category, a Starbucks row with a suggestion, and
//     (from Phase 1) a duplicate pair and a large charge, for the review inbox;
//   - 24 days of portfolio value history;
//   - "Statement Checking": a statement ending balance of $2,896.60 covers its
//     first four transactions (the last two are still outstanding).

import { seedFixtureInto } from "./seed.mjs";

const PY = `
import datetime, random
random.seed(11)
today = datetime.date.today()

def month_start(back):
    y, m = today.year, today.month - back
    while m <= 0:
        m += 12
        y -= 1
    return datetime.date(y, m, 1)

def on(back, day):
    # The given day-of-month, back months ago; None when it's still in the future.
    d = month_start(back).replace(day=min(day, 28))
    return d if d <= today else None

def days_ago(n):
    return today - datetime.timedelta(days=n)

def acct(name, typ, start, inst=None, mask=None, rate=None):
    cur.execute("INSERT INTO accounts (name, account_type, starting_balance, institution, mask, interest_rate) VALUES (?,?,?,?,?,?)",
                (name, typ, start, inst, mask, rate))
    return cur.lastrowid

checking = acct("Everyday Checking", "checking", "3200.00", "Chase", "4821")
savings  = acct("High-Yield Savings", "savings", "3500.00", "Ally", "1177")
visa     = acct("Visa Rewards", "credit", "9000.00", "Capital One", "9034")
loan     = acct("Car Loan", "loan", "14500.00", "Toyota Financial", "5520", "5.9")
broker   = acct("Fidelity Brokerage", "investment", "0.00", "Fidelity", "3306")
old      = acct("Old Checking", "checking", "300.00", "Regional Bank", "0912")

fp_counter = [0]
def tx(acc, date, desc, amt, cat, source="rule"):
    if date is None:
        return None
    fp_counter[0] += 1
    cur.execute("INSERT INTO transactions (account_id, date, description, amount, category, category_source, fingerprint) VALUES (?,?,?,?,?,?,?)",
                (acc, date.isoformat(), desc, f"{amt:.2f}", cat, (source if cat else None), f"demo-{fp_counter[0]}"))
    return cur.lastrowid

groc = ["Kroger", "Trader Joe's", "Whole Foods", "Aldi"]
dine = ["Chipotle", "Starbucks", "Olive Garden", "Local Thai Kitchen", "Panera", "Sushi Zen"]
shop = ["Amazon", "Target", "Best Buy", "Etsy"]
ent  = ["AMC Theatres", "Steam Games", "Concert Tickets"]

pre_linked = []   # (out_id, in_id) savings transfers older than two months
for back in range(5, -1, -1):
    for day in (1, 15):
        tx(checking, on(back, day), "ACME CORP PAYROLL", 2200.00, "Income")
    tx(checking, on(back, 1), "Union Realty", -1850.00, "Rent")
    tx(checking, on(back, 3), "Planet Fitness", -45.00, "Subscriptions")
    tx(checking, on(back, 5), "City Electric", -round(random.uniform(88, 140), 2), "Utilities")
    tx(checking, on(back, 8), "Comcast Internet", -70.00, "Utilities")
    tx(visa, on(back, 12), "Netflix", -15.49, "Subscriptions")
    tx(visa, on(back, 14), "Spotify", -11.99, "Subscriptions")
    tx(checking, on(back, 20), "Geico Auto", -175.00, "Insurance")
    tx(checking, on(back, 22), "Toyota Financial", -385.00, "Transfer")
    for i in range(6 if back else 4):
        tx(visa if i % 2 else checking, on(back, 2 + i * 4), random.choice(groc), -round(random.uniform(32, 145), 2), "Groceries")
    for i in range(random.randint(6, 9) if back else 7):
        tx(visa, on(back, 1 + i * 3 + random.randint(0, 2)), random.choice(dine), -round(random.uniform(12, 68), 2), "Dining Out")
    for i in range(3):
        tx(visa, on(back, 4 + i * 9), "Shell Oil", -round(random.uniform(36, 58), 2), "Gas")
    for i in range(random.randint(2, 4)):
        tx(visa, on(back, 6 + i * 6), random.choice(shop), -round(random.uniform(22, 190), 2), "Shopping")
    for i in range(random.randint(1, 3)):
        tx(visa, on(back, 9 + i * 7), random.choice(ent), -round(random.uniform(14, 62), 2), "Entertainment")
    # The monthly savings move: an ORDINARY category on both legs, so only a
    # link keeps it out of spending/income.
    out_id = tx(checking, on(back, 2), "Transfer to Savings", -500.00, "Savings Goal")
    in_id = tx(savings, on(back, 2), "Transfer from Checking", 500.00, "Savings Goal")
    if back >= 2 and out_id and in_id:
        pre_linked.append((out_id, in_id))
    # Paying the card off from checking — already linked, so it isn't a
    # "possible transfer" and doesn't count as spending.
    pay_out = tx(checking, on(back, 25), "Visa Payment", -1150.00, "Transfer")
    pay_in = tx(visa, on(back, 25), "Payment Thank You", 1150.00, "Transfer")
    if pay_out and pay_in:
        pre_linked.append((pay_out, pay_in))

for out_id, in_id in pre_linked:
    cur.execute("INSERT INTO transfer_links (out_transaction_id, in_transaction_id) VALUES (?, ?)", (out_id, in_id))

# Too far apart to be suggested (10 days) — link these two by hand.
tx(checking, days_ago(12), "Venmo to Sam", -120.00, "Gifts", "user")
tx(savings, days_ago(2), "Zelle from Sam", 120.00, "Gifts", "user")

# Loose ends for the categorization work.
tx(checking, days_ago(6), "SQ *MYSTERY VENDOR 8841", -42.10, None)
tx(checking, days_ago(4), "PAYPAL *INST XFER", -88.00, None)
for n, d in enumerate((9, 5, 1)):
    tx(visa, days_ago(d), "Ferrywood Coffee", -round(4.2 + n * 0.35, 2), None)
for n, d in enumerate((8, 3, 0)):
    tx(visa, days_ago(d), "Corner Cart", -round(3.0 + n * 0.10, 2), None)
# A second set of identical rows, for trying the same "apply to similar" offer
# through the blue bulk bar instead of a row's own dropdown.
for n, d in enumerate((7, 4, 1)):
    tx(visa, days_ago(d), "Lunch Truck", -round(9.0 + n * 0.25, 2), None)
tx(visa, days_ago(12), "Home Depot", -412.30, "Shopping")
tx(visa, days_ago(2), "Chipotle", -14.25, "Dining Out")
tx(visa, days_ago(2), "Chipotle", -14.25, "Dining Out")

# An everyday account that's gone quiet.
tx(old, days_ago(60), "Dormant Deposit", 25.00, "Income", "user")

# Budget for the current month (+ last month so month navigation has something).
for back in (1, 0):
    period = month_start(back).strftime("%Y-%m")
    cur.execute("INSERT OR IGNORE INTO budget_periods (period) VALUES (?)", (period,))
    for cat, amt, grp in [
        ("Income", "4400.00", "income"),
        ("Rent", "1850.00", "fixed"), ("Utilities", "220.00", "fixed"),
        ("Insurance", "175.00", "fixed"), ("Subscriptions", "75.00", "fixed"),
        ("Groceries", "650.00", "flexible"), ("Dining Out", "300.00", "flexible"),
        ("Gas", "160.00", "flexible"), ("Shopping", "250.00", "flexible"),
        ("Entertainment", "120.00", "flexible"), ("Travel", "200.00", "nonmonthly"),
    ]:
        cur.execute("INSERT OR REPLACE INTO budgets (category, period, monthly_amount, budget_group) VALUES (?,?,?,?)", (cat, period, amt, grp))

# Recurring: bills due over the next couple of weeks and a paycheck in ~9 days.
next_first = (today.replace(day=1) + datetime.timedelta(days=32)).replace(day=1)
for merchant, cat, amt, cad, anchor, acc in [
    ("ACME CORP PAYROLL", "Income", "2200.00", "biweekly", today + datetime.timedelta(days=9), checking),
    ("Union Realty", "Rent", "-1850.00", "monthly", next_first, checking),
    ("Geico Auto", "Insurance", "-175.00", "monthly", today + datetime.timedelta(days=2), checking),
    ("Netflix", "Subscriptions", "-15.49", "monthly", today + datetime.timedelta(days=4), visa),
    ("Spotify", "Subscriptions", "-11.99", "monthly", today + datetime.timedelta(days=6), visa),
    ("City Electric", "Utilities", "-110.00", "monthly", today + datetime.timedelta(days=7), checking),
    ("Planet Fitness", "Subscriptions", "-45.00", "monthly", today + datetime.timedelta(days=12), checking),
    ("Amazon Prime", "Subscriptions", "-139.00", "annual", today + datetime.timedelta(days=40), visa),
]:
    cur.execute("INSERT INTO recurring (merchant, category, amount, cadence, anchor_date, account_id) VALUES (?,?,?,?,?,?)",
                (merchant, cat, amt, cad, anchor.isoformat(), acc))

# Goals
def bucket(name, target, tdate, acc):
    cur.execute("INSERT INTO buckets (name, target_amount, target_date, account_id) VALUES (?,?,?,?)", (name, target, tdate, acc))
    return cur.lastrowid
b1 = bucket("Emergency Fund", "15000.00", None, savings)
b2 = bucket("Japan Trip", "5000.00", (today + datetime.timedelta(days=200)).isoformat(), savings)
b3 = bucket("New Laptop", "1800.00", (today + datetime.timedelta(days=90)).isoformat(), None)
for b, amts in [(b1, [1500, 500, 500, 750, 500, 500]), (b2, [400, 400, 600, 300]), (b3, [250, 250])]:
    for i, a in enumerate(amts):
        cur.execute("INSERT INTO bucket_contributions (bucket_id, date, amount) VALUES (?,?,?)", (b, month_start(len(amts) - i).isoformat(), f"{a:.2f}"))

# Holdings + property
for sym, name, sh, price, basis, cls in [
    ("VTI", "Vanguard Total Stock Market ETF", "48", "296.40", "11040.00", "US Stock"),
    ("VXUS", "Vanguard Total International", "60", "68.15", "3900.00", "Intl Stock"),
    ("BND", "Vanguard Total Bond Market", "40", "73.20", "3100.00", "Bond"),
    ("AAPL", "Apple Inc.", "15", "238.10", "2600.00", "US Stock"),
]:
    cur.execute("INSERT INTO holdings (account_id, symbol, name, shares, price, cost_basis, asset_class) VALUES (?,?,?,?,?,?,?)",
                (broker, sym, name, sh, price, basis, cls))
cur.execute("INSERT INTO assets (name, asset_type, value, valued_on) VALUES ('Primary Residence','property','385000.00',?)", (today.isoformat(),))
cur.execute("INSERT INTO assets (name, asset_type, value, valued_on) VALUES ('2021 Toyota RAV4','vehicle','18500.00',?)", (today.isoformat(),))

# ---------------------------------------------------------------------------
# Phase 2 loose ends
# ---------------------------------------------------------------------------
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

def due_dates(anchor):
    out, d = [], anchor
    while d <= today:
        out.append(d)
        d = step_month(d)
    return out

def register_category(name):
    cur.execute("INSERT OR IGNORE INTO categories (name) VALUES (?)", (name,))

def bill(merchant, category, stored_amount, days_since_last_due, description, charges):
    # A monthly bill whose latest due date was days_since_last_due days ago.
    # charges maps "how many cycles back" (0 = the latest) to the amount that posted.
    anchor = add_months(today - datetime.timedelta(days=days_since_last_due), -3)
    cur.execute("INSERT INTO recurring (merchant, category, amount, cadence, anchor_date, account_id) VALUES (?,?,?,?,?,?)",
                (merchant, category, stored_amount, "monthly", anchor.isoformat(), checking))
    for i, due in enumerate(reversed(due_dates(anchor))):
        if i in charges:
            tx(checking, due, description, -charges[i], category, "user")

bill("Hulu", "Subscriptions", "-14.99", 2, "HULU 877-8244858", {0: 17.99, 1: 14.99, 2: 14.99, 3: 14.99})
bill("Iron Works Gym", "Subscriptions", "-32.00", 20, "IRON WORKS GYM", {1: 32.00, 2: 32.00, 3: 32.00})
bill("CloudBox Storage", "Subscriptions", "-9.99", 1, "CLOUDBOX STORAGE 8005551234", {1: 9.99, 2: 9.99, 3: 9.99})
bill("Water Utility", "Utilities", "-41.20", 6, "WATER UTILITY - CITY BILLING", {0: 41.20, 1: 41.20, 2: 41.20, 3: 41.20})

# Spending with no budget line yet ("Suggest from 3-month average"), and a
# Household line that rolls its unspent money forward.
for name in ("Pet Care", "Health", "Household"):
    register_category(name)
for back, amount in ((3, 71.25), (2, 88.00), (1, 62.50)):
    tx(visa, on(back, 18), "Pet Supplies Plus", -amount, "Pet Care", "user")
for back in (3, 2, 1):
    tx(visa, on(back, 21), "Walgreens", -34.10, "Health", "user")
tx(checking, on(1, 10), "Bright Smile Dental", -120.00, "Health", "user")
for back in (1, 0):
    period = month_start(back).strftime("%Y-%m")
    cur.execute("INSERT OR REPLACE INTO budgets (category, period, monthly_amount, budget_group, rollover_enabled) VALUES ('Household', ?, '120.00', 'flexible', 1)", (period,))
tx(visa, on(1, 9), "Ace Hardware", -78.00, "Household", "user")
tx(visa, days_ago(3), "Ace Hardware", -35.00, "Household", "user")

# Last month, for the month-end review: two overspent categories and two
# uncategorized rows.
tx(visa, on(1, 16), "Big Box Outlet", -310.00, "Shopping", "user")
tx(visa, on(1, 19), "Prime Steakhouse", -145.00, "Dining Out", "user")
tx(checking, on(1, 10), "SQ *POP-UP MARKET", -18.40, None)
tx(visa, on(1, 17), "VENMO CASHOUT", -60.00, None)

# Review inbox: a shaky auto-category and a merchant the history can suggest for.
cur.execute("INSERT INTO transactions (account_id, date, description, amount, category, category_source, confidence, fingerprint) VALUES (?,?,?,?,?,?,?,?)",
            (visa, days_ago(2).isoformat(), "Local Bakery Co", "-11.50", "Dining Out", "classifier", 0.55, "demo-bakery"))
tx(visa, days_ago(1), "STARBUCKS #1042 SEATTLE", -6.75, None)

# Goals: one comfortably on track, one that follows an account's balance.
holiday = bucket("Holiday Gifts", "900.00", (today + datetime.timedelta(days=150)).isoformat(), None)
for k in (3, 2, 1):
    cur.execute("INSERT INTO bucket_contributions (bucket_id, date, amount) VALUES (?,?,?)", (holiday, month_start(k).isoformat(), "200.00"))
cur.execute("INSERT INTO buckets (name, target_amount, account_id, tracks_account) VALUES ('Down Payment', '25000.00', ?, 1)", (savings,))

# Portfolio value history (the app adds today's point at launch).
for i in range(24, 0, -1):
    value = 24815.70 * (0.93 + 0.0030 * (24 - i)) + 90 * ((i * 7) % 5 - 2)
    cur.execute("INSERT INTO portfolio_snapshots (date, value) VALUES (?, ?)", (days_ago(i).isoformat(), f"{value:.2f}"))

# Reconciliation practice: a statement ending balance of $2,896.60 covers the
# first four transactions; the last two are still outstanding.
statement = acct("Statement Checking", "checking", "2000.00", "Harbor Credit Union", "7742")
for days, desc, amt, cat in (
    (28, "Payroll Deposit", 1500.00, "Income"),
    (24, "Landlord Payment", -420.00, "Rent"),
    (20, "Grocery Mart", -63.40, "Groceries"),
    (15, "Electric Co", -120.00, "Utilities"),
    (9, "Pharmacy", -45.25, "Health"),
    (3, "Gas & Go", -80.00, "Gas"),
):
    tx(statement, days_ago(days), desc, amt, cat, "user")
`;

/** Creates a fresh demo database in `dbDir` (which must already exist and be
 * empty, or not contain a vaultspend.db yet). */
export async function seedDemoDatabase(dbDir) {
  await seedFixtureInto(dbDir, PY);
}
