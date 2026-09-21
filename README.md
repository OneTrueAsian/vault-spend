# Vault Spend

*Own your Data, Own your Money!*

A local, private budgeting and transaction ledger for Windows. There's no
account, no cloud sync, and no subscription — everything lives in a single
file on your own computer, and nothing is ever sent anywhere else.

Vault Spend is an independent open-source project and is not affiliated
with, endorsed by, or partnered with any external financial services or
wallet providers.

## Installing

1. Run the installer you were given (`Vault Spend_x.x.x_x64-setup.exe`, or
   the `.msi` if you were sent that instead).
2. Windows may show a **"Windows protected your PC"** SmartScreen warning —
   see the FAQ below for why, and how to get past it.
3. Launch Vault Spend from the Start Menu. It starts completely empty — no
   sample data, nothing pre-loaded — ready for your own accounts and
   transactions.

## Getting started

1. **Add an account** — from the Accounts tab ("Add account…"), or you'll be
   prompted automatically the first time you import a file. Checking,
   savings, credit card, loan, investment, and "other" are all supported.
2. **Get your transactions in**, either by importing a CSV from your bank
   (see below) or entering them by hand in the Ledger.
3. **Set up your budget** in the Budget tab — add a monthly amount per
   category, grouped as Income / Fixed / Flexible / Non-Monthly.
4. From there, the Dashboard and Cash Flow tabs summarize everything
   automatically — there's nothing else to configure.

## A tour of the tabs

- **Dashboard** — a row of **Quick actions** (add a transaction or account,
  jump to Budget or Goals) sits above net worth, cash, debt, and
  investments at a glance (click any of the four for a breakdown of what
  changed and which accounts drove it), this month's spending by category,
  recent transactions, and an **Insights** feed that surfaces things worth
  a look on its own: a category on pace to go over budget, a
  month-over-month jump, an unusually large charge — and good news too,
  like a category you meaningfully cut back on. The layout is yours:
  pin/unpin widgets, drag to reorder, or use **"+ Add widget…"** to pin one
  specific account, goal, or investment account, not just the fixed
  catalog. Pick a built-in preset — Default, Bills Focus, Investor Focus —
  from the Layout dropdown, or, once you've customized the layout
  yourself, **"+ Save as…"** to name and keep your own arrangement right
  alongside them — switch back to it any time from the same dropdown, or
  delete it when you no longer need it. **Needs a look** opens with a
  **To do** list that now also calls out Recurring bills that look missed
  or changed price, and a finished month waiting for its **month-end
  review**. The header's **Hide amounts** button covers every dollar figure
  with •••• for when someone's looking over your shoulder, and **Ctrl+K**
  opens a command palette that jumps to any tab, account, goal, or
  transaction (press **?** for the shortcut list).
- **Accounts** — every account grouped by type (cash, credit, loan,
  investment, other), with running totals for Total Assets, Total
  Liabilities, and Net Worth — click any of those for a breakdown of what
  changed and which accounts drove it. Add, edit, or delete an account
  here, including its institution, last-4 digits, and which family member
  it belongs to. **Details** on a card opens that account's own page: a
  balance-history chart, its transactions, and — for checking and savings
  accounts — **Reconcile**, which checks your records against a
  statement's ending balance (see FAQ). **Property & Valuables** (a home
  or a vehicle, counted in your net worth) are at the bottom of this tab.
- **Ledger** — every transaction, filterable by account/category/tag/family
  member, with inline category correction and tagging — either one at a
  time or, after selecting several rows, in bulk — splitting a transaction
  across multiple categories, applying a payment toward a debt account,
  and — for households tracking more than one person — assigning any
  account, transaction, goal, asset, or recurring item to a family member
  via **"Manage family members…"**. After an import (and any time from
  **Review inbox**), a review dialog lists the transactions worth a second
  look — uncategorized, a low-confidence guess, a possible duplicate, or
  an unusually large charge — with a suggested category to accept, change,
  or skip.
- **Budget** — this month's budgeted vs. actual per category, with
  prev/next month navigation and reordering (drag a row, or use the ↑/↓
  buttons next to it). Click any category name to see every transaction
  behind that number and fix any that are miscategorized, right from that
  screen. **"Suggest from 3-month average"** proposes an amount per
  category from your recent spending, which you accept line by line. Tick
  **"Roll over unspent"** on a category to carry what's left into next
  month's budget (see FAQ), and **"Month-end review"** walks through a
  finished month — what ran over, what's still uncategorized, and how
  your goals moved.
- **Goals** — savings goals with a target amount/date, optionally linked
  to an account and, for households, a family member, with a running
  total and contribution history. Pick a custom icon and color for each
  one, and set an optional **"Auto-contribute monthly"** amount for
  something like insurance or gifts that only comes due once a year (see
  FAQ). A goal with a target date shows its **monthly pace** — what
  you've actually been adding over the last three months — and whether
  that gets it there on time. A goal linked to an account can follow that
  account's balance so its progress updates by itself, and **"+ Add"** on
  a card logs a contribution without leaving the page.
- **Cash Flow** — income vs. expenses over a 3 or 6 month window (with an
  optional year-over-year comparison); click a bar to see that month's
  spending by category and any unusually large charges. The "Top
  categories"/"Top merchants" cards below are scoped to a single month
  (defaulting to the current one, with a picker to look back further) and
  show a month-over-month trend per category. Further down, a **Forecast**
  projects your checking/savings balance 30, 60, or 90 days out — each
  Recurring bill and paycheck lands on its due date, the lowest balance is
  called out, and a "Coming up" list shows what's next — and the
  **Debt Payoff Planner** shows how fast your credit cards and loans clear
  under a snowball or avalanche strategy.
- **Recurring** — a maintained list of recurring bills/income, each
  showing its next expected date and editable in place. A **Suggested**
  section above it auto-detects merchant/amount pairs in your ledger that
  look recurring but aren't tracked yet, so you can add them with one
  click instead of typing them in by hand. Each bill is also checked
  against your transactions: it shows when a matching charge has posted,
  flags a bill that looks **missed**, and calls out a **price change**
  (see FAQ).
- **Investments** — holdings per account (shares, price, cost basis) with
  computed value and gain/loss. Click **"Total gain/loss"** or **"Today's
  gain/loss"** to see which holdings are driving it. Also includes a
  **goal projection** calculator that projects a future balance from a
  starting amount, a monthly contribution, and an assumed annual return.
  Prices are manual by default; optionally turn on live pricing (Settings
  tab) to auto-fill a new holding's price by symbol and keep existing ones
  current automatically. Your portfolio's value is recorded each day you
  open the app or refresh prices, so a **history chart** builds up over
  time; a **Target allocation** by asset class shows how far each has
  drifted; and **"Save as goal…"** turns a goal projection into a real
  goal. Each investment account also gets an **Accumulation & projection**
  card: the cash put in, what it's worth now, and where it's headed by its
  withdraw date. Open an account's Details page to set its plan (see FAQ).
- **Household** — spending and income broken down by family member for
  whichever month you're viewing, net worth by person (always as of
  today — it isn't a monthly figure the way the cards above it are), and
  a budget grid split by category and person. Anything not assigned to a
  specific person lands under "Unassigned" — see the Ledger's "Manage
  family members…" to start attributing accounts and transactions.
- **Reports** — pick a range (Year to date, Last 12 months, Last 6
  months, or Last month) and see income, spending, net, and savings rate
  for it, a Sankey diagram of income flowing to your biggest spending
  categories (with a "Left over" or "Shortfall" flow depending on which
  side won), a table of where the money went by category and month, a
  daily-spending heatmap (darker days are bigger spending days; hover or
  Tab to a day for its total, and one big bill like rent doesn't wash the
  rest out), spending by family member and by tag, a year-by-year
  comparison, a savings-rate trend, and net worth by family member — with
  the CSV/PDF export described below. Account balances and
  net worth by *account*, and Property & Valuables, live on the Accounts
  tab; the setup-data import/export is in Settings.
- **Settings** — separate profiles (completely independent data files you
  can create, switch, rename, and delete — see FAQ), an optional live
  stock-price integration for the Investments tab, and appearance:
  Light/Dark/System plus two visual styles — Slate and Futuristic (see
  FAQ). **Privacy** can also hide your amounts whenever the window loses
  focus, and **Background reminders** keeps Vault Spend in the system tray
  (optionally starting when you sign in) so bill reminders arrive with the
  window closed. One **Data** section holds everything about your data:
  where your data file lives (and a button to move it), your backup
  history with a manual "Back up now", per-backup restore and an optional
  second copy of every backup in another folder, and the bulk setup-data
  template download and import. **Feature toggles** can hide Apply to
  Debt, Split, Envelope Caps and **Rollover unspent** (see FAQ) everywhere
  they appear.

## Importing transactions

From the **Ledger** tab, click **"Import transactions…"**:

1. Pick which account the file belongs to (or create a new one on the
   spot).
2. Choose the file exported from your bank or credit card — CSV, OFX/QFX,
   or QIF are all supported.
3. Confirm which way the amounts go. Vault Spend's convention is
   *negative = money out* for a checking/savings/investment account; if
   your file shows charges as positive numbers (common for credit card
   exports), choose "Flip the signs" — otherwise "Keep as-is." For a
   credit card or loan account specifically, it's the other way around —
   a payment is *positive* (it reduces what's owed) and a charge or new
   debt is negative — so check a payment row's sign in the preview before
   confirming.
4. You'll see a preview of every row before anything is saved. Rows that
   look like duplicates of something already in your ledger are
   unchecked by default (see the FAQ on duplicates) — check or uncheck
   any row, or override which account a specific row should land in.
5. Confirm the import. Each new transaction is auto-categorized where
   possible; anything it can't confidently place is left Uncategorized
   for you to set yourself.
6. A **Review transactions** dialog then lists the ones worth a look —
   uncategorized, a low-confidence guess, a possible duplicate, or an
   unusually large charge — with a suggested category to accept, change,
   or skip. Close it any time; it's one click away under **Review
   inbox** on the Ledger tab.

## Bulk setup-data import/export

If you'd rather set up accounts, categories, budgets, goals, and
investment holdings in bulk instead of one at a time through the UI, use
the two buttons in **Settings → Data → Setup data**:

- **"Download setup template…"** saves one CSV file with a section for
  each of Accounts / Categories / Budgets / Goals / Holdings, with one
  example row in each section to show the expected columns. Opens and
  saves fine in Excel.
- Open it, delete the example rows, fill in your own (keep the section
  titles and column headers as they are), and save.
- **"Import setup data…"** reads the file back in and shows you a review
  screen — anything that already exists is flagged, and you choose what
  to actually apply before anything is written.
- A blank `Period` on a budget row defaults to the current month.
- A Holdings row's `Account` must match an existing account's name exactly
  (case-insensitive) — a row whose account isn't found is flagged on the
  review screen and skipped, not partially created.

## Exporting your data

- **"Export CSV…"** (Reports tab) exports whatever rows are currently
  visible/filtered.
- **"Print / Save as PDF…"** opens your system print dialog against the
  current Reports view — choose "Save as PDF" as the destination if you
  want a file instead of a physical printout.

## FAQ

**Is my data private?**
Yes. Everything is stored in one SQLite file on your own computer
(`%APPDATA%\com.joeyf.vaultspend\vaultspend.db`), created fresh the first
time you launch the app. There's no account, no server, and nothing is
ever uploaded — a fresh install on someone else's computer starts
completely empty, never with your data.

**I got a "Windows protected your PC" warning — is this safe?**
That's Windows SmartScreen, and it appears because this installer isn't
signed with a certificate Microsoft already recognizes — it doesn't mean
anything is actually wrong. Click **"More info"**, then **"Run anyway."**

**"Update now" found a newer version but couldn't open it — what do I do?**
On versions 1.1.5 and 1.1.6 specifically, "Update now" downloads the new
installer correctly but has a bug that blocks it from opening the file
afterward — you'll see an error, and it falls back to opening the GitHub
release page instead. That's expected on those two versions only, and
there's no way for it to fix itself: Vault Spend has no silent
auto-updater (a deliberate choice — that needs a signing certificate and
CI infrastructure this project doesn't have), so a version's own copy of
this logic can't be patched after it's installed. Just download and run
the installer from the release page it opens, same as any manual update —
"Update now" works correctly on 1.1.7 and every version after it.

**Will I get a reminder before a bill is due?**
If a recurring bill (Recurring tab) is due within 3 days, Vault Spend
shows a native Windows notification when you open the app. To get them
while the window is closed, turn on **Settings → Background reminders →
"Keep Vault Spend running in the tray"**: closing the window then hides
it to the system tray instead of quitting (the tray icon's menu opens it
again or quits for real), and you can also have it start hidden when you
sign in to Windows. It's off by default, and with it off nothing runs —
or can notify you — while the app is closed.

**What happens if I import the same file twice?**
Every transaction is fingerprinted from its date, description, amount,
and account. An exact repeat is flagged as a likely duplicate in the
import preview and left unchecked by default, so re-importing the same
statement won't create doubled entries unless you explicitly check it
back in.

**How does auto-categorization work?**
New transactions are matched against rules first — an exact merchant
match, or a pattern Vault Spend has learned from a category you've
corrected before. Once you've made at least 10 corrections, a lightweight
classifier also kicks in for transactions the rules don't cover. Anything
neither can confidently place is left **Uncategorized** rather than
guessing — setting it yourself teaches the app for next time.

**How does Vault Spend suggest recurring items?**
The Recurring tab's "Suggested" section looks for a merchant and amount
that's repeated at least 3 times on a roughly consistent schedule (weekly,
biweekly, monthly, or annual) but isn't tracked yet. Add it with one click
to start it, or dismiss it if it's not actually recurring — a dismissed
suggestion won't reappear.

**Can I fix a transaction's category after the fact?**
Yes, several ways: the category dropdown on any Ledger row; selecting
several rows and using the Ledger's bulk-edit bar to recategorize them
all at once; or, from the Budget page, clicking a category name to see
every transaction behind that month's number and fixing any of them right
there (individually or in bulk).

**How do budgets carry forward month to month?**
A new month starts from whatever the closest earlier month had set for
each category, so you don't need to re-enter every line every month.
Changing the current month's amount never changes a past month's numbers.
This copy happens the first time you open a given month — so if you
browse ahead to a future month before finishing your edits (amount,
group, or the 90% "Cap" toggle) in the current one, that future month
locks in whatever the current month looked like at that moment and won't
retroactively pick up later changes. Finish editing the current month
first, then move forward.

**What does a goal's "Auto-contribute monthly" do?**
It turns the goal into a sinking fund for an irregular annual cost —
insurance, gifts, an annual subscription — that's easier to save for a
little at a time than all at once. The next time you open the app after a
new calendar month starts, Vault Spend logs that amount as a contribution
automatically (you'll see a one-time notice naming which goal(s) it
applied to) — at most once per goal per month, and independently of any
manual contribution you also log that month, so the two never skip or
double up on each other.

**Can I save my own Dashboard layout?**
Yes — customize the layout (pin/unpin widgets, drag to reorder, or "+ Add
widget…" to pin a specific account/goal/investment account) until the
Layout dropdown shows "Custom (unsaved)," then click **"+ Save as…"** and
give it a name. It's saved right alongside the built-in Default/Bills
Focus/Investor Focus presets — pick it from the same dropdown any time to
switch back, or select it and click **"Delete"** to remove it. Saving
under a name you've already used replaces that layout rather than
creating a second copy.

**What does "Roll over unspent" do on a budget line?**
Tick it on a category and whatever you don't spend there in a month is
added to that category's budget the next month — a $400 grocery line with
$100 left over gives you $500 to spend the month after, and the row shows
"+ $100.00 rolled in". Going over doesn't carry a debt forward; the carry
is never below zero. Turning it on starts fresh from the current month
rather than reaching back into old ones, and Budget alerts and the
month-end review count the rolled-in amount as part of the budget.
Settings → Feature toggles has a master **Rollover unspent** switch, on by
default: turn it off and nothing carries into a later month — the
per-category checkboxes and "rolled in" notes disappear from Budget, while
every budget and earlier month stays exactly as it was. Each category's own
tick is remembered, so turning the switch back on picks up where you left
off.

**How does Vault Spend know a recurring bill was paid?**
It looks for a charge dated from a few days before to about ten days after
the bill's due date whose description contains the bill's merchant name —
so name the bill the way it appears on your statement (a bill called
"Water" won't match a charge that only says "CITY BILLING"). A matching
charge marks the bill paid; a bill with no matching charge once that
window has passed is flagged as missed; and a charge that comes in at a
different amount after a steady run of identical ones is called out as a
price change, on the Recurring tab and in your Dashboard To do. The
cash-flow forecast doesn't count a bill that has already posted.

**How do I reconcile an account against a statement?**
On Accounts, click **Details** on a checking or savings account, enter
the statement's ending balance, and start. Tick each transaction that
appears on the statement; the page shows the difference between your
cleared balance and the statement, and once it reaches $0.00 you can
finish and Vault Spend records the reconciliation. Ticked rows stay marked
as cleared, and a difference that won't close usually means a missing,
mistyped, or wrongly dated transaction.

**What does "Hide amounts" do?**
The header's button covers every dollar figure in the app with •••• until
you press it again, so you can open Vault Spend with someone next to you.
It hides the numbers, not the shapes of charts or what a hover tooltip
says. In Settings → Privacy you can also have the amounts hidden
automatically whenever the window isn't in front. It's a screen privacy
aid — your data file itself isn't encrypted or changed.

**Are there keyboard shortcuts?**
**Ctrl+K** opens a command palette: type to jump to any tab, account,
goal, or transaction, or to run an action like adding a transaction.
Outside a text box, **N** adds a transaction, **/** searches
transactions, **?** shows the list, and **Esc** closes a dialog or the
palette.

**Can I split one transaction across multiple categories?**
Yes — the Ledger's "Split →" control on any transaction lets you divide
it into as many category/amount lines as you need, each with an optional
note.

**Does it support credit cards and loans, not just checking/savings?**
Yes — each account type tracks its balance the way that type actually
works: a credit card's balance is available credit, a loan's is what's
still owed, and a checking/savings/investment/other account's is a
literal balance. For both credit and loan accounts, a payment is entered
as a *positive* amount and reduces what's owed; a charge or new borrowing
is negative and increases it — the same convention for both account
types.

**How is the cash-flow forecast calculated?**
It starts from the cash in your checking and savings accounts and places
every active bill and paycheck on your Recurring list on the day it's due,
so a big bill shows up as a dip on its due date. Your everyday spending
carries on at your recent average (roughly the last 90 days, leaving out
anything already on your Recurring list and transfers between your own
accounts, so nothing is counted twice). A canceled Recurring item is
skipped. With nothing active in Recurring, it falls back to a smooth trend
of your net cash flow instead.

**What does "Safe to spend" mean?**
It's your checking and savings balance, minus every Recurring bill due
between now and your next Recurring paycheck (a bill due today or on
payday counts), minus an optional buffer you choose to keep. It needs your
bills and paycheck on the Recurring tab — without a paycheck it counts
every bill in the next 45 days instead. It's a planning guide, not a
guarantee: it doesn't know about a one-off expense that isn't on your
Recurring list.

**What is a linked transfer, and why link one?**
Moving $500 from checking to savings creates two transactions — one out,
one in. Left alone they'd count as $500 of spending *and* $500 of income.
Linking them tells Vault Spend they're one move between your own accounts,
so neither counts (whatever category they carry), and they show as a
single "A → B" row. Vault Spend suggests pairs with equal amounts,
opposite directions, in different accounts, within 3 days of each other;
you can also tick any two rows and choose "Link as transfer", and unlink
from the row at any time. Anything categorized "Transfer" is treated the
same way.

**Can Vault Spend link transfers for me?**
Yes, if you turn it on: Settings → Feature toggles → "Link matching
transfers automatically" (off by default). It only links a pair that is
clear-cut — equal amounts, opposite directions, different accounts, within 3
days, and no other possible match for either side. Anything ambiguous (say,
one $500 out and two $500 deposits) stays in "possible transfers" for you to
decide. Turning it on also links the clear-cut pairs already in your ledger,
and it runs after every import and every transaction you add. Each automatic
link appears under "N auto-linked — review" on Transactions: choose "Looks
right" to clear it from the list (the link stays) or Unlink if it isn't a
transfer — that pair won't be linked automatically again, though it can
still be linked by hand.

**How do the accumulation & projection numbers for a Roth or 529 work?**
Open an investment account's Details page (Accounts tab, or click the
account's name in the "Accumulation & projection" card on the Investments
tab). **Cash invested** is the deposits you've logged on that account — every
money-in counts, and money out is shown separately and lowers the net. **Worth
now** is the same figure the Accounts tab shows, and **Growth** is worth minus
what you put in. "What was counted" lists it month by month; a month with no
deposit shows $0.00.

The plan below it has a monthly amount (it starts at your average over the
last 6 complete months — fewer if the account is newer; type another figure
to override it, or choose "Reset to average"), an assumed annual return %, and
a withdraw month. Vault Spend keeps investing that flat amount, compounding
monthly, and shows what the account would be worth at the withdraw month as a
dashed line on the chart. Fill in "Spread over" a number of years to see the
yearly withdrawals instead of one lump (each year takes the balance divided by
the years left). Turn on "Show projected figures in today's dollars" to
discount the projection by the inflation % — one setting shared by every
account, 3% to start.

The Worth line on the chart only starts the first day Vault Spend recorded the
account's value (it records it each day you open the app), so earlier months
aren't drawn and nothing is estimated. The projection is an estimate from the
numbers you give it, not a promise; try a lower return to see how much it
moves.
**Where can I see and change the auto-categorization rules?**
Settings → Categorization rules lists every rule (the built-in starters and
the ones learned from your corrections), with how many transactions each
touches. Add, edit, or delete them there; before a rule is saved you'll see
how many existing transactions it would change and can apply it to them in
the same step. A rule never overrides a category you set yourself.

**Can I exclude a debt from the payoff planner?**
Yes — uncheck "Include" on that debt's row. It's meant for something like
a credit card you pay off in full every month, which isn't really debt to
pay down and would otherwise distort the plan.

**Does net worth include my property and valuables?**
Yes — whatever you've entered under Property & Valuables (Accounts tab) is
included in the current net worth figure everywhere it's shown. One
caveat on the Dashboard's net worth *trend* chart specifically: since a
manual asset only carries a value as of today, past points on that chart
apply today's value throughout rather than tracking what it was actually
worth back then.

**How do automatic backups work, and can I restore one?**
Vault Spend backs up your data file automatically once a day when you
open it, keeping the most recent 15 (Settings tab — also has a manual
"Back up now"). Restoring one first backs up your current data (so
restoring is itself reversible), then loads the restored data immediately
— no restart needed. Under Settings → Data → Backups you can also choose a **second
folder** — one that syncs to OneDrive or Dropbox, or a USB drive, and
that already exists (Vault Spend won't create one from a typed path) — and
every backup is copied there too, so one failed disk can't take your data
and its backups together. If that folder isn't reachable, the main backup
still happens and you're told the copy didn't.

**Can I change how Vault Spend looks?**
Yes — the Settings tab has an Appearance section with a Light/Dark/System
toggle (in the header) plus two visual styles: **Slate** (the default
look) and **Futuristic** (a neon style with its own type and sidebar
icons). Both follow the Light/Dark/System toggle. Switching is instant
and purely visual — nothing about your data changes.

**Can I move my data file to a different folder?**
Yes — "Move data file…" on the Settings tab copies your live database to
a new folder you pick and starts using it right away. The old file is
left behind untouched, in case you want it back.

**Where's my data if I want to back it up myself?**
`%APPDATA%\com.joeyf.vaultspend\vaultspend.db` is the entire ledger — copy
that one file to back it up or move it to another computer.

**Can Vault Spend track spending for multiple people?**
Two different ways, depending on what you actually want:

- **Family members** — tag any account, transaction, goal, asset, or
  recurring item with who it belongs to, then filter down to just one
  person wherever a member filter appears. Everyone still shares the same
  file and sees the same data; it's attribution, not separation. Manage
  them from the Ledger tab's "Manage family members…" button.
- **Profiles** — completely separate, independent data files, one per
  person, with nothing shared between them. Switch profiles from the
  indicator in the sidebar, or manage them fully (create, rename, delete)
  from the Settings tab.

Use family members for one combined household view with who-spent-what
attribution. Use profiles for genuinely separate finances under one
install — roommates, or keeping a side business apart from personal
spending, for example.

**Can holding prices update automatically?**
Optionally — off by default, so nothing changes unless you turn it on. In
Settings, pick a provider (Alpha Vantage, Finnhub, or Twelve Data) and add
its free API key to enable it: new holdings can auto-fill their price by
symbol, and existing ones refresh automatically when the app opens and
every 2 hours it stays open (one request per distinct symbol you hold,
not per holding). Turn it off any time and prices go back to fully
manual. Alpha Vantage's free tier is capped at 25 requests/day, which
comfortably covers casual use; Twelve Data's free tier raises that to 800
requests/day for a larger portfolio; Finnhub's free tier allows 60
requests/minute instead, so there's no daily limit to track at all.

**Can I ask questions about my spending in plain English?**
Yes — the "Ask the Vault" box at the top of the Dashboard answers
questions like "how much did I spend on dining out in July" or "what's my
net worth" directly from your own data, with no internet connection or
account required. It matches a set of question shapes rather than truly
understanding free-form English, so it works best one question at a time,
using the exact category, account, goal, or merchant names you use
elsewhere in the app. Click "Tips & examples" on the box itself for
phrasing guidance and the full list of what it understands.
