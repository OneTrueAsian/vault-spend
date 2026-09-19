// E2E test for Phase 2 item 6 (recurring matching + price-change alerts):
//   - each Recurring row says whether its latest due date actually posted:
//     "Paid <date>", "Due <date> — not posted yet", or "No charge for <date>";
//   - a subscription whose latest charge is higher than the steady price before
//     it gets an alert with an "Update to $X" button (which clears the alert);
//   - the Dashboard's To do list carries "bill looks missed" and
//     "subscription changed price" rows.
//
// Run with: node e2e/feature74_recurring_matching.mjs

import { launchApp } from "./harness.mjs";
import { seedFixture } from "./lib/seed.mjs";

const dbDir = await seedFixture(`
import datetime, calendar
today = datetime.date.today()

def add_months_clamped(d, n):
    total = d.year * 12 + d.month - 1 + n
    y, m = divmod(total, 12)
    m += 1
    return datetime.date(y, m, min(d.day, calendar.monthrange(y, m)[1]))

def step_month(d):
    # Mirrors the backend's add_one_month: same day next month, walking back if it doesn't exist.
    y, m = (d.year + 1, 1) if d.month == 12 else (d.year, d.month + 1)
    for back in range(4):
        try:
            return datetime.date(y, m, d.day - back)
        except ValueError:
            pass

def occurrences(anchor):
    out, d = [], anchor
    while d <= today:
        out.append(d)
        d = step_month(d)
    return out

cur.execute("INSERT INTO accounts (name, account_type, starting_balance) VALUES ('Checking', 'checking', '5000.00')")
acct = cur.lastrowid

def item(merchant, amount, days_since_last_due):
    base = today - datetime.timedelta(days=days_since_last_due)
    anchor = add_months_clamped(base, -3)
    cur.execute("INSERT INTO recurring (merchant, category, amount, cadence, anchor_date, account_id) VALUES (?,?,?,?,?,?)",
                (merchant, None, amount, "monthly", anchor.isoformat(), acct))
    return occurrences(anchor)

def charge(date, description, amount):
    fp = f"{acct}|{date}|{description.lower()}|{amount}"
    cur.execute("INSERT INTO transactions (account_id, date, description, amount, fingerprint) VALUES (?,?,?,?,?)",
                (acct, date.isoformat(), description, amount, fp))

# Netflix: steady $15.49, then the latest charge is $17.99 -> price change (and paid).
occ = item("Netflix", "-15.49", 2)
for i, d in enumerate(occ):
    charge(d, "NETFLIX.COM 866-579", "-17.99" if i == len(occ) - 1 else "-15.49")

# Spotify: paid, steady.
for d in item("Spotify", "-11.99", 3):
    charge(d, "SPOTIFY USA", "-11.99")

# Geico Auto: the latest due date was ~20 days ago and never posted -> missed.
occ = item("Geico Auto", "-120.00", 20)
for d in occ[:-1]:
    charge(d, "GEICO AUTO INS", "-120.00")

# Gym: due yesterday, not posted yet -> pending.
occ = item("Fit Gym", "-30.00", 1)
for d in occ[:-1]:
    charge(d, "FIT GYM MEMBERSHIP", "-30.00")
`);

const app = await launchApp({ dbDir });
const { browser } = app;
async function nav(label) {
  for (const b of await browser.$$("nav button")) {
    if ((await b.getText()).trim() === label) return b.click();
  }
  throw new Error(`no nav button "${label}"`);
}
const row = (merchant) => browser.$(`//tr[.//div[contains(@class,'account-name-cell')][normalize-space()='${merchant}']]`);
async function noteOf(merchant) {
  const r = await row(merchant);
  await r.waitForExist({ timeout: 10000, timeoutMsg: `no Recurring row for ${merchant}` });
  const note = await r.$("[data-match-state]");
  await note.waitForExist({ timeout: 10000, timeoutMsg: `${merchant} has no paid/pending/missed note` });
  return { state: await note.getAttribute("data-match-state"), text: (await note.getText()).trim() };
}

try {
  await browser.setWindowSize(1440, 1200);
  await nav("Recurring");

  const netflix = await noteOf("Netflix");
  const spotify = await noteOf("Spotify");
  const geico = await noteOf("Geico Auto");
  const gym = await noteOf("Fit Gym");
  console.log("notes:", JSON.stringify({ netflix, spotify, geico, gym }));
  if (netflix.state !== "paid" || !netflix.text.startsWith("Paid ")) throw new Error(`Netflix should be paid: ${JSON.stringify(netflix)}`);
  if (spotify.state !== "paid") throw new Error(`Spotify should be paid: ${JSON.stringify(spotify)}`);
  if (geico.state !== "missed" || !geico.text.startsWith("No charge for ")) throw new Error(`Geico should look missed: ${JSON.stringify(geico)}`);
  if (gym.state !== "pending" || !gym.text.includes("not posted yet")) throw new Error(`Fit Gym should be pending: ${JSON.stringify(gym)}`);

  // --- price-change alert ------------------------------------------------
  const alert = await browser.$("[data-price-alert='Netflix']");
  await alert.waitForExist({ timeout: 10000, timeoutMsg: "Netflix should have a price-change alert" });
  const alertText = await alert.getText();
  if (!alertText.includes("went from $15.49 to $17.99")) throw new Error(`unexpected alert text: ${alertText}`);
  if (await browser.$("[data-price-alert='Spotify']").isExisting()) throw new Error("a steady price must not raise an alert");
  if (await browser.$("[data-price-alert='Geico Auto']").isExisting()) throw new Error("a missed bill is not a price change");

  // --- Dashboard to-do rows ---------------------------------------------
  await nav("Dashboard");
  const todo = await browser.$(".todo-list");
  await todo.waitForExist({ timeout: 10000 });
  await browser.waitUntil(async () => /looks missed/.test(await todo.getText()), { timeout: 10000, timeoutMsg: "the To do list should mention the missed bill" });
  const todoText = await todo.getText();
  console.log("to do:", todoText.replace(/\s+/g, " "));
  if (!todoText.includes("Geico Auto")) throw new Error(`the missed bill should be named: ${todoText}`);
  if (!todoText.includes("1 subscription changed price") || !todoText.includes("Netflix $15.49 → $17.99")) {
    throw new Error(`the price change should be listed: ${todoText}`);
  }

  // Clicking a row lands on Recurring.
  await (await todo.$("//button[contains(., 'looks missed')]")).click();
  await browser.$("//h1[normalize-space()='Recurring']").waitForExist({ timeout: 10000 });

  // --- Update to the new price clears the alert ---------------------------
  await (await browser.$("[data-price-alert='Netflix'] button")).click();
  await browser.waitUntil(async () => !(await browser.$("[data-price-alert='Netflix']").isExisting()), {
    timeout: 10000,
    timeoutMsg: "updating the amount should clear the alert",
  });
  const netflixRow = await (await row("Netflix")).getText();
  if (!netflixRow.includes("$17.99")) throw new Error(`the row should now show $17.99: ${netflixRow}`);

  await nav("Dashboard");
  await browser.waitUntil(async () => !/changed price/.test(await (await browser.$(".todo-list")).getText()), {
    timeout: 10000,
    timeoutMsg: "the Dashboard should stop listing the price change once it's updated",
  });

  console.log("FEATURE 74 E2E TEST PASSED");
} finally {
  await app.close();
}
