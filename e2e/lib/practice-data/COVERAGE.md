# Practice data coverage

The shared practice data (`buildPracticeData`, `npm run demo`) gives every feature something real to act on. One row per
feature, grouped by page as in Help. **Profile**: H = main household, S = Sam, F = Fresh start. **UI** means the feature
needs no seeded rows, or only works from the app itself; the reason is given.

`practiceData.test.mjs` checks every data-backed row. A new feature adds its rows to `mainHousehold.mjs` (or another
profile) and a line here, with its test.

| Page | Feature | Profile | Data that exercises it |
| --- | --- | --- | --- |
| Dashboard | Cards, net worth trend, spending this month, top merchants | H | 15 months of history; assets; investment value history |
| Dashboard | Safe to spend | H | Switch on; checking balance and upcoming bills (recurring) |
| Dashboard | To do: quiet account | H | "Old Checking" with one deposit 60 days ago |
| Dashboard | Insights: large expense, category jump, duplicate | H | Home Depot $412.30; duplicate Chipotle pair; UAT ER bill |
| Dashboard | Layout, hide amounts, sidebar, command palette | UI | Per-device view settings, nothing to seed |
| Accounts | Every account type with explained balances | H | Checking, savings, two cards, three loans, investments; balances = start + rows |
| Accounts | Reconcile against a statement balance | H | "Statement Checking": $2,896.60 covers its first four rows |
| Accounts | Check against a statement file | H | Practice Checking, Riverbend Checking, Harborview Brokerage + PDFs in `files/` |
| Accounts | Property and valuables | H | "Our House", "2022 Toyota RAV4" |
| Accounts | Exclude a debt from the payoff planner | UI | Three loans exist; the switch is per account in the app |
| Transactions | Fix a category, apply to similar | H | Ferrywood Coffee, Corner Cart and Lunch Truck trios (uncategorized) |
| Transactions | Uncategorized rows | H | SQ *MYSTERY VENDOR, PAYPAL *INST XFER |
| Transactions | Split, tag, note | H | A split Costco purchase; tagged and noted rows |
| Transactions | Exclude from budget | H | Switch on; ER bill, client dinner, employer reimbursement, last month's water heater marked |
| Transactions | Bulk changes, move to account | H | Any rows; the UAT rows are a ready selection |
| Transactions | Link a transfer by hand | H | Venmo to Sam / Zelle from Sam, 10 days apart |
| Transactions | Possible transfers to review | H | Unlinked Savings Goal pairs this month and last |
| Transactions | Auto-linking | H | Switch on; one auto-made link to review; an ambiguous Holiday Fund pair; a lone Car Fund transfer |
| Transactions | Review inbox | H | Low-confidence "Local Bakery Co"; "STARBUCKS #1042 SEATTLE" uncategorized |
| Transactions | Who a transaction belongs to | H | Alex and Jordan own rows |
| Transactions | Apply a payment to a debt | UI | Loan payments exist; applying one is the app's own action |
| Recurring | Bills and income, by date and cost | H | 10 monthly items plus the bills below |
| Recurring | Paid, late, missed and price-change bills | H | Hulu (price went up), Peak Climbing Gym (missed), CloudBox (due yesterday), Trash & Recycling (steady) |
| Recurring | Found for me (suggestions) | H | Regular merchants with no recurring item (Water Utility, Shell Oil) |
| Budget | Groups, Spent and Left, warnings | H | Budgets this month and last; over-budget categories |
| Budget | Rollover | H | Household line with rollover on |
| Budget | Envelope Caps (warn at 90%) | H | Switch on; Dining Out cap on this month |
| Budget | Suggested amounts | H | Pet Care spending with no budget line |
| Budget | Month-end review | H | Last month: overspent Shopping and Dining Out, two uncategorized rows |
| Goals | Goals on track, behind, following an account | H | Emergency Fund, Japan Trip, New Laptop, Holiday Gifts, Down Payment (follows Emergency Savings) |
| Goals | Save monthly for a yearly cost | H | "Car Registration" sinking goal |
| Cash Flow | Month view, forecast, compared with last year | H | 15 months; recurring bills |
| Cash Flow | Debt payoff | H | Visa Rewards, Target RedCard, Home Mortgage, Car Loan, Jordan's Student Loan |
| Investments | Holdings, mix and targets | H | Holdings in five accounts; allocation targets |
| Investments | Gains, value history | H | Portfolio and account value history |
| Investments | Accumulation and projection | H | Sample Roth IRA (missed month, withdrawal), Sam's 529 and Alex's 529 with plans; Fidelity Brokerage (no deposits) |
| Investments | Live prices | UI | Needs the owner's own API key |
| Household | By person, budget by person | H | Alex and Jordan, plus Shared rows |
| Household | Empty state | F | No people |
| Reports | Every tab, print and PDF | H | 15 months |
| Reports → Transactions and back | Categories by month row opens its transactions; Back restores range and tab | H | categorized spending in the last 12 months, plus one Uncategorized spending row |
| Reports | Comparisons with others your age | H + UI | 12+ completed months exist; the age setup is entered in the app |
| Settings | Feature toggles | H, F | H has the opt-in features on; F has every default |
| Settings | Profiles, switching | H, S, F | Three profiles in the registry |
| Settings | Password protection | S | Plaintext with two backups, to protect live |
| Settings | Backups, restore, move data | S | Sam's backups; the rest is the app's own action |
| Settings | Rules | H | A "Shell Oil" rule; Ferrywood Coffee is left uncategorized so a rule can be made from it |
| Settings | Bill reminders, tray, autostart, mobile, updates | UI | Device features, nothing to seed |
| Import | CSV import, match your columns | H | `files/` holds a normal bank CSV and one with unfamiliar headings |
| Ask the Vault | Questions about spending, cuts, retirement | H + UI | Reads the household's data; the retirement month is entered in the app |
| First run | Welcome, empty states | F | Empty profile |
