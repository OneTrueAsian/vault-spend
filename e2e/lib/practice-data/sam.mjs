// The "Sam" practice profile: small, plaintext, with two backups next to it, for turning on password protection live.

// ---------------------------------------------------------------------------
// Phase C loose end: a second, already-populated PLAINTEXT profile ("Sam"),
// real but modest — three months of an ordinary checking/savings life, no
// budget or goals of its own (that's what makes it obviously a different,
// smaller household than the main profile) — sitting next to two historical
// plaintext backups, so the demo walker can turn password protection on for
// it live and immediately see Settings' leftover-plaintext-files banner
// (Task 8) offer to clean up real files that really exist on disk.
// ---------------------------------------------------------------------------
export const SAM_PY = `
import datetime
today = datetime.date.today()

def days_ago(n):
    return today - datetime.timedelta(days=n)

def acct(name, typ, start, inst=None, mask=None):
    cur.execute("INSERT INTO accounts (name, account_type, starting_balance, institution, mask) VALUES (?,?,?,?,?)",
                (name, typ, start, inst, mask))
    return cur.lastrowid

checking = acct("Sam's Checking", "checking", "1450.00", "Ally", "2290")
savings = acct("Sam's Savings", "savings", "600.00", "Ally", "2291")

fp = [0]
def tx(acc, date, desc, amt, cat, source="user"):
    fp[0] += 1
    cur.execute("INSERT INTO transactions (account_id, date, description, amount, category, category_source, fingerprint) VALUES (?,?,?,?,?,?,?)",
                (acc, date.isoformat(), desc, f"{amt:.2f}", cat, (source if cat else None), f"sam-demo-{fp[0]}"))

tx(checking, days_ago(58), "Campus Payroll", 1350.00, "Income")
tx(checking, days_ago(44), "Campus Payroll", 1350.00, "Income")
tx(checking, days_ago(30), "Campus Payroll", 1350.00, "Income")
tx(checking, days_ago(16), "Campus Payroll", 1350.00, "Income")
tx(checking, days_ago(2), "Campus Payroll", 1350.00, "Income")
tx(checking, days_ago(55), "Maple Court Apartments", -820.00, "Rent")
tx(checking, days_ago(27), "Maple Court Apartments", -820.00, "Rent")
tx(checking, days_ago(1), "Maple Court Apartments", -820.00, "Rent")
tx(checking, days_ago(50), "Trader Joe's", -58.40, "Groceries")
tx(checking, days_ago(36), "Trader Joe's", -64.10, "Groceries")
tx(checking, days_ago(22), "Trader Joe's", -71.85, "Groceries")
tx(checking, days_ago(8), "Trader Joe's", -66.30, "Groceries")
tx(checking, days_ago(41), "Spotify", -11.99, "Subscriptions")
tx(checking, days_ago(11), "Spotify", -11.99, "Subscriptions")
tx(checking, days_ago(33), "Metro Transit Pass", -76.00, "Transportation")
tx(checking, days_ago(3), "Metro Transit Pass", -76.00, "Transportation")
tx(checking, days_ago(19), "Noodle House", -24.60, "Dining Out")
tx(checking, days_ago(6), "Noodle House", -18.15, "Dining Out")
cur.execute(
    "INSERT INTO transactions (account_id, date, description, amount, category, category_source, fingerprint) VALUES (?,?,?,?,?,?,?)",
    (checking, days_ago(45).isoformat(), "Transfer to Savings", "-150.00", "Savings Goal", "user", "sam-demo-transfer-out"),
)
out_id = cur.lastrowid
cur.execute(
    "INSERT INTO transactions (account_id, date, description, amount, category, category_source, fingerprint) VALUES (?,?,?,?,?,?,?)",
    (savings, days_ago(45).isoformat(), "Transfer from Checking", "150.00", "Savings Goal", "user", "sam-demo-transfer-in"),
)
in_id = cur.lastrowid
cur.execute("INSERT INTO transfer_links (out_transaction_id, in_transaction_id) VALUES (?, ?)", (out_id, in_id))
tx(checking, days_ago(9), "SQ *CORNER BAKERY", -6.75, None)
`;
