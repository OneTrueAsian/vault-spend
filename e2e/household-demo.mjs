// `npm run demo:household` — opens the REAL compiled app on a complete, tidy two-person household:
// 15 months of history, and every account (checking, savings, two cards, three loans, three
// investment accounts) holding a balance that its own transactions explain. Unlike `npm run demo`,
// there are no deliberate loose ends; it is for trying features (Comparisons in particular, which
// needs 12 completed months of spending) against data that simply looks like a real household.
//
// The data is rebuilt from scratch on every run, relative to today, in `.demo-household/`
// (gitignored) through the same VAULTSPEND_DB_DIR switch the e2e suite uses — never your real data.
//
// Usage:
//   npm run demo:household             # rebuild the data, launch the app
//   npm run demo:household -- --keep   # relaunch on the existing data (keeps your changes)
//   npm run demo:household -- --seed   # rebuild the data only, do not launch

import { spawn } from "node:child_process";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { seedFixtureInto } from "./lib/seed.mjs";

const PY = `
import datetime, random
random.seed(7)
today = datetime.date.today()
MONTHS = 15  # months of history before the current one

def month_start(back):
    y, m = today.year, today.month - back
    while m <= 0:
        m += 12
        y -= 1
    return datetime.date(y, m, 1)

def on(back, day):
    # The given day-of-month, back months ago; None when it is still in the future.
    d = month_start(back).replace(day=min(day, 28))
    return d if d <= today else None

cur.execute("INSERT INTO family_members (name) VALUES ('Jordan')")
jordan = cur.lastrowid

def acct(name, typ, start, inst, mask, rate=None, member=None):
    cur.execute("INSERT INTO accounts (name, account_type, starting_balance, institution, mask, interest_rate, member_id) VALUES (?,?,?,?,?,?,?)",
                (name, typ, start, inst, mask, rate, member))
    return cur.lastrowid

# Opening balances are as of the start of the history. A card's is its credit limit (the app tracks
# available credit); a loan's is what was owed; an investment account with holdings shows their value.
checking = acct("Joint Checking", "checking", "3400.00", "Chase", "4821")
savings  = acct("Emergency Savings", "savings", "9200.00", "Ally", "1177", "4.20")
jsav     = acct("Jordan's Savings", "savings", "3100.00", "Marcus", "6610", "4.40", jordan)
visa     = acct("Visa Rewards", "credit", "12000.00", "Capital One", "9034", "24.99")
redcard  = acct("Target RedCard", "credit", "3000.00", "Target", "2207", "29.95", jordan)
mortgage = acct("Home Mortgage", "loan", "292000.00", "Rocket Mortgage", "7781", "6.25")
car      = acct("Car Loan", "loan", "19800.00", "Toyota Financial", "5520", "5.90")
student  = acct("Jordan's Student Loan", "loan", "26500.00", "Nelnet", "3390", "4.99", jordan)
k401     = acct("401(k)", "investment", "52000.00", "Fidelity", "8821")
roth     = acct("Jordan's Roth IRA", "investment", "14000.00", "Vanguard", "4412", None, jordan)
broker   = acct("Brokerage", "investment", "8500.00", "Schwab", "3306")

fp = [0]
def tx(acc, date, desc, amt, cat, member=None, principal=None):
    if date is None:
        return None
    fp[0] += 1
    cur.execute("INSERT INTO transactions (account_id, date, description, amount, category, category_source, fingerprint, member_id, principal_amount) VALUES (?,?,?,?,?,?,?,?,?)",
                (acc, date.isoformat(), desc, f"{amt:.2f}", cat, "user", f"household-{fp[0]}", member,
                 None if principal is None else f"{principal:.2f}"))
    return cur.lastrowid

def transfer(src, dst, date, amt, out_desc, in_desc, member=None):
    # Money moving between two of your own accounts: both legs "Transfer", linked, never spending.
    out_id = tx(src, date, out_desc, -amt, "Transfer", member)
    in_id = tx(dst, date, in_desc, amt, "Transfer", member)
    if out_id and in_id:
        cur.execute("INSERT INTO transfer_links (out_transaction_id, in_transaction_id) VALUES (?, ?)", (out_id, in_id))

owed = {mortgage: 292000.00, car: 19800.00, student: 26500.00}
def loan_payment(loan, date, payment, escrow, rate, desc, cat, member=None):
    # The full payment leaves checking as an expense; only the principal part lowers what is owed.
    if date is None:
        return
    interest = round(owed[loan] * rate / 12, 2)
    principal = round(payment - escrow - interest, 2)
    owed[loan] -= principal
    tx(checking, date, desc, -payment, cat, member)
    tx(loan, date, "Payment received", payment, "Transfer", member, principal)

saved = {savings: 9200.00, jsav: 3100.00}
card_charges = {visa: {}, redcard: {}}
def charge(card, back, day, desc, amt, cat, member=None):
    date = on(back, day)
    if date is None:
        return
    tx(card, date, desc, -amt, cat, member)
    card_charges[card][back] = card_charges[card].get(back, 0) + amt

groc = ["Kroger", "Trader Joe's", "Whole Foods", "Costco", "Aldi"]
dine = ["Chipotle", "Starbucks", "Olive Garden", "Local Thai Kitchen", "Panera", "Sushi Zen", "Shake Shack"]
shop = ["Amazon", "Target", "Best Buy", "Etsy", "IKEA"]
fun  = ["AMC Theatres", "Steam Games", "Concert Tickets", "Bowling Alley"]

for back in range(MONTHS, -1, -1):
    # Pay: Alex on the 1st and 15th, Jordan on the 5th and 20th. 401(k) money comes out of Alex's pay.
    for day in (1, 15):
        tx(checking, on(back, day), "ACME CORP PAYROLL", 2450.00, "Income")
        tx(k401, on(back, day), "Payroll contribution", 350.00, "Transfer")
    tx(k401, on(back, 15), "Employer match", 175.00, "Transfer")
    for day in (5, 20):
        tx(checking, on(back, day), "RIVERSIDE HOSPITAL PAYROLL", 1650.00, "Income", jordan)

    # Loans
    loan_payment(mortgage, on(back, 1), 2140.00, 340.00, 0.0625, "Rocket Mortgage", "Mortgage")
    loan_payment(car, on(back, 18), 385.00, 0.00, 0.059, "Toyota Financial", "Car Payment")
    loan_payment(student, on(back, 22), 310.00, 0.00, 0.0499, "Nelnet Student Loan", "Student Loan", jordan)

    # Saving and investing
    transfer(checking, savings, on(back, 3), 900.00, "Transfer to Emergency Savings", "Transfer from Joint Checking")
    transfer(checking, jsav, on(back, 6), 300.00, "Transfer to Jordan's Savings", "Transfer from Joint Checking", jordan)
    transfer(checking, roth, on(back, 10), 400.00, "Vanguard Roth IRA contribution", "Contribution", jordan)
    transfer(checking, broker, on(back, 12), 500.00, "Schwab Brokerage deposit", "Deposit")
    for acc, rate in ((savings, 0.042), (jsav, 0.044)):
        d = on(back, 28)
        if d:
            saved[acc] += 900.00 if acc == savings else 300.00
            interest = round(saved[acc] * rate / 12, 2)
            saved[acc] += interest
            tx(acc, d, "Interest paid", interest, "Income", jordan if acc == jsav else None)

    # Bills from checking
    month = month_start(back).month
    electric = 160 if month in (6, 7, 8) else 135 if month in (12, 1, 2) else 95
    tx(checking, on(back, 7), "City Electric", -round(electric + random.uniform(-12, 18), 2), "Utilities")
    tx(checking, on(back, 9), "Water Utility", -round(random.uniform(48, 62), 2), "Utilities")
    tx(checking, on(back, 8), "Comcast Internet", -79.99, "Utilities")
    tx(checking, on(back, 11), "Verizon Wireless", -142.00, "Phone")
    tx(checking, on(back, 20), "Geico Auto", -168.00, "Insurance")
    tx(checking, on(back, 4), "Iron Works Gym", -64.00, "Subscriptions")
    tx(checking, on(back, 26), "Red Cross Donation", -150.00, "Charity")

    # Everyday spending
    for i in range(4):
        tx(checking, on(back, 3 + i * 7), random.choice(groc), -round(random.uniform(70, 165), 2), "Groceries")
        charge(visa, back, 5 + i * 7, random.choice(groc), round(random.uniform(40, 120), 2), "Groceries")
    for i in range(random.randint(6, 9)):
        charge(visa, back, 1 + i * 3 + random.randint(0, 2), random.choice(dine), round(random.uniform(12, 72), 2), "Dining Out")
    for i in range(4):
        charge(visa, back, 2 + i * 7, "Shell Oil", round(random.uniform(38, 62), 2), "Gas")
    for i in range(random.randint(2, 4)):
        charge(visa, back, 6 + i * 6, random.choice(shop), round(random.uniform(20, 180), 2), "Shopping")
    for i in range(random.randint(1, 3)):
        charge(visa, back, 9 + i * 7, random.choice(fun), round(random.uniform(15, 75), 2), "Entertainment")
    charge(visa, back, 12, "Netflix", 15.49, "Subscriptions")
    charge(visa, back, 14, "Spotify Family", 16.99, "Subscriptions")
    for i in range(random.randint(1, 3)):
        charge(redcard, back, 4 + i * 8, "Target", round(random.uniform(25, 110), 2), "Household", jordan)
    if back % 3 == 0:
        charge(visa, back, 16, "CVS Pharmacy", round(random.uniform(18, 60), 2), "Health")
    if back % 4 == 1:
        charge(visa, back, 21, "Bright Smile Dental", 145.00, "Health")
    if back in (11, 4):
        charge(visa, back, 8, "Delta Air Lines", 612.40, "Travel")
        charge(visa, back, 15, "Marriott Hotels", 488.75, "Travel")
    if back == 7:
        charge(visa, back, 13, "Home Depot", 734.20, "Home Maintenance")
    if back == 2:
        tx(checking, on(back, 24), "Zenith Plumbing Services", -385.00, "Home Maintenance")
    if back % 6 == 0:
        tx(checking, on(back, 2), "Geico Renters & Umbrella", -96.00, "Insurance")

# Card payments: each card is paid in full on the 25th for the month before. Whatever was bought
# since is still owed, so both cards carry a balance.
for back in range(MONTHS - 1, -1, -1):
    for card, desc in ((visa, "Capital One Payment"), (redcard, "Target RedCard Payment")):
        amount = round(card_charges[card].get(back + 1, 0), 2)
        if amount > 0:
            transfer(checking, card, on(back, 25), amount, desc, "Payment - thank you", jordan if card == redcard else None)

# Holdings: what the investment accounts are worth today (their opening balance plus every
# contribution, plus some growth).
for acc, sym, name, sh, price, basis, cls in [
    (k401, "FXAIX", "Fidelity 500 Index Fund", "265", "205.10", "48200.00", "US Stock"),
    (k401, "FTIHX", "Fidelity Total International Index", "820", "15.40", "11800.00", "Intl Stock"),
    (k401, "FXNAX", "Fidelity US Bond Index", "640", "10.55", "6900.00", "Bond"),
    (roth, "VTI", "Vanguard Total Stock Market ETF", "52", "296.40", "13400.00", "US Stock"),
    (roth, "VXUS", "Vanguard Total International", "90", "68.15", "6800.00", "Intl Stock"),
    (broker, "SCHB", "Schwab US Broad Market ETF", "400", "24.80", "9300.00", "US Stock"),
    (broker, "AAPL", "Apple Inc.", "12", "238.10", "2500.00", "US Stock"),
    (broker, "SCHZ", "Schwab US Aggregate Bond ETF", "200", "23.15", "4200.00", "Bond"),
]:
    cur.execute("INSERT INTO holdings (account_id, symbol, name, shares, price, cost_basis, asset_class) VALUES (?,?,?,?,?,?,?)",
                (acc, sym, name, sh, price, basis, cls))

cur.execute("INSERT INTO assets (name, asset_type, value, valued_on) VALUES ('Our House', 'property', '415000.00', ?)", (today.isoformat(),))
cur.execute("INSERT INTO assets (name, asset_type, value, valued_on) VALUES ('2022 Toyota RAV4', 'vehicle', '24500.00', ?)", (today.isoformat(),))

for name in ("Mortgage", "Car Payment", "Student Loan", "Phone", "Household", "Health", "Home Maintenance", "Travel", "Charity"):
    cur.execute("INSERT OR IGNORE INTO categories (name) VALUES (?)", (name,))

# A budget for this month and last.
for back in (1, 0):
    period = month_start(back).strftime("%Y-%m")
    cur.execute("INSERT OR IGNORE INTO budget_periods (period) VALUES (?)", (period,))
    for cat, amt, grp in [
        ("Income", "8200.00", "income"),
        ("Mortgage", "2140.00", "fixed"), ("Car Payment", "385.00", "fixed"), ("Student Loan", "310.00", "fixed"),
        ("Utilities", "330.00", "fixed"), ("Phone", "142.00", "fixed"), ("Insurance", "200.00", "fixed"),
        ("Subscriptions", "100.00", "fixed"),
        ("Groceries", "800.00", "flexible"), ("Dining Out", "300.00", "flexible"), ("Gas", "220.00", "flexible"),
        ("Shopping", "300.00", "flexible"), ("Entertainment", "120.00", "flexible"), ("Household", "150.00", "flexible"),
        ("Health", "80.00", "flexible"), ("Travel", "200.00", "nonmonthly"),
    ]:
        cur.execute("INSERT OR REPLACE INTO budgets (category, period, monthly_amount, budget_group) VALUES (?,?,?,?)", (cat, period, amt, grp))

# Recurring bills, anchored on their next due date.
def next_on(day):
    d = today.replace(day=day)
    if d < today:
        d = (today.replace(day=1) + datetime.timedelta(days=32)).replace(day=day)
    return d
for merchant, cat, amt, day, acc in [
    ("ACME CORP PAYROLL", "Income", "2450.00", 15, checking),
    ("Rocket Mortgage", "Mortgage", "-2140.00", 1, checking),
    ("Iron Works Gym", "Subscriptions", "-64.00", 4, checking),
    ("Comcast Internet", "Utilities", "-79.99", 8, checking),
    ("Verizon Wireless", "Phone", "-142.00", 11, checking),
    ("Netflix", "Subscriptions", "-15.49", 12, visa),
    ("Spotify Family", "Subscriptions", "-16.99", 14, visa),
    ("Toyota Financial", "Car Payment", "-385.00", 18, checking),
    ("Geico Auto", "Insurance", "-168.00", 20, checking),
    ("Nelnet Student Loan", "Student Loan", "-310.00", 22, checking),
]:
    cur.execute("INSERT INTO recurring (merchant, category, amount, cadence, anchor_date, account_id) VALUES (?,?,?,?,?,?)",
                (merchant, cat, amt, "monthly", next_on(day).isoformat(), acc))
`;

/** Creates the household database in `dbDir` (which must exist and not hold a vaultspend.db yet). */
export async function seedHouseholdDatabase(dbDir) {
  await seedFixtureInto(dbDir, PY);
}

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  const repoRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
  process.chdir(repoRoot); // seed.mjs resolves target/debug/init_db.exe relative to cwd
  const exe = path.join(repoRoot, "target", "debug", "vaultspend.exe");
  const dataDir = path.join(repoRoot, ".demo-household");
  const args = new Set(process.argv.slice(2));

  if (!args.has("--keep") || !fs.existsSync(path.join(dataDir, "vaultspend.db"))) {
    fs.rmSync(dataDir, { recursive: true, force: true });
    fs.mkdirSync(dataDir, { recursive: true });
    console.log("Seeding the household data (relative to today)...");
    await seedHouseholdDatabase(dataDir);
  }
  if (args.has("--seed")) {
    console.log(`Household data is in ${dataDir}`);
  } else {
    if (!fs.existsSync(exe)) {
      console.error("Build the app first: npx tauri build --debug --no-bundle");
      process.exit(1);
    }
    spawn(exe, [], { detached: true, stdio: "ignore", env: { ...process.env, VAULTSPEND_DB_DIR: dataDir } }).unref();
    console.log(`Vault Spend is open on the household data in ${dataDir}. Re-run for a fresh copy.`);
  }
}
