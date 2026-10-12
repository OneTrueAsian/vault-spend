# Reconcile by uploading a statement — design

Date: 2026-10-11. Status: approved in brainstorming (revised the same day for learned layouts and for
investment statements), awaiting written-spec review.

## Goal

Let a user reconcile an account either by hand (as today) or by uploading the bank's monthly statement.
The user enters the period the statement covers; the app reads the statement, checks each statement
transaction against the account's transactions, offers to add anything missing, and finishes the
reconciliation under the same exact-to-the-cent rule as manual reconciling.

The reader must **adapt to banks the owner has never seen**. When a user uploads a statement from an
unrecognised bank, the app learns how to read it and supports that bank's statements from then on.

**Success:**
- On the owner's real statements (Capital One, Amex, Chase, a credit union, a mortgage, an LPL investment
  portfolio), every statement
  transaction is either matched automatically or clearly surfaced for review, and nothing is ever marked
  as matched by mistake.
- A statement from an unknown layout is either read correctly by the general rules or can be taught in a
  few clicks. Either way the layout is learned, and the next statement from that bank reads without help.
- A statement is never silently misread: a failed read is always detected and shown.

## Decisions (from the owner)

- The primary input is the **PDF statement**. A **CSV/OFX/QFX/QIF download** for the same period is
  accepted as a second way in, using the same review screen.
- A statement transaction missing from the app is **offered for one-click add**, prefilled from the statement.
- Works for **all account types** (checking, savings, credit, loan, investment cash side).
- Finishing uses the **same rule as manual**: exact $0.00 difference; both paths save the same record.
- Pure-Rust direct PDF reading plus a review screen. Any bank-specific behaviour is **data (a statement
  layout), not code**.
- **The app learns.** Every successfully read statement from an unrecognised bank produces a saved layout,
  either automatically or by the user teaching it.
- Learned layouts stay **on the user's computer**. No sharing, export or import of layouts.
- Balance rule: **pick up from last time** (see "Balance rule"), shared by manual and upload.
- **Investment accounts** reconcile **activity plus share counts**: cash activity is matched like any
  account and checked against the statement's activity totals, and each holding's share count must match the
  app exactly. Market value is shown but not required to match (see "Investment accounts").

## Assumptions

- Everything runs locally. The statement file is read once and never uploaded, copied, cached or logged.
- Scanned/photographed PDFs (no text layer) are unsupported, with a plain explanation and the fallbacks.
- A PDF may hold several accounts (the credit union's does); the user picks the section that matches.

## What the real statements showed (16 PDFs, 6 institutions)

- All are text-based. No OCR needed.
- **Content (stream) order is the right reading order.** Visual layout order scrambles Amex and credit-union
  rows (amounts land beside the wrong dates); content order gives date → description → amount for every bank.
- Date forms: `08/05/26`, `08/05/26*`, `04/30` (no year), `Jul 31 Jul 31` (transaction + post date),
  `Aug 06 Aug 06`, `09/01/26`.
- Amount forms: `-$43.08`, `- $3,975.23` (spaced minus), `($10.84)` (parenthesised negative), `.99`
  (no leading zero), `33.91` (no `$`). Chase adds a rewards-points integer after the amount (`8.64 864`):
  a money amount always has exactly two decimal places, which separates them.
- Descriptions wrap across several lines; credit-union rows also print a running balance.
- Balance labels: `Previous Balance` / `New Balance`, `Beginning Balance` / `Ending Balance`,
  `Outstanding Principal` (mortgage, with a principal/interest/escrow/total payment table).
- Some rows are dated a little outside the printed period (transaction date versus posting date).
- **Investment (LPL) statements:**
  - The ending value includes "Change in Market Value", so start + activity ≠ end. Each account instead has
    an Activity Summary whose "Total Additions" and "Total Subtractions" equal the sum of its rows.
  - One PDF holds a portfolio summary page plus one section per account ("Account Ending in …"); the
    portfolio summary is not an account.
  - Rows carry prices before the amount (`Bought 10.000 at $43.62 ($436.15)`): the transaction amount is the
    **last** money amount on the row, not the first. Rows wrap; "AS OF" lines carry share counts but no amount.
  - Summary tables have several columns (current month, quarter to date, year to date).
  - The quarter-end statement repeats every row of the quarter, so rows well outside the entered period must
    be dropped quietly.
  - A "Cash Sweep Activity" section restates internal movements and is excluded from the activity totals by
    the statement itself; reading it would double-count.
  - Holdings list symbol and name, share quantity (e.g. `252.523`), price (`$9.4700`) and market value.

## User flow (Account Detail → "Reconcile with a statement")

1. Choose **Upload a statement** (beside the existing manual option, now offered for every account type).
2. Enter the statement's **start and end dates**, then pick the file in the native file dialog
   (`.pdf`, `.csv`, `.ofx`, `.qfx`, `.qif`).
3. If the PDF holds several account sections, pick the one for this account.
4. If a PDF **doesn't add up** (start + rows ≠ end, or lines it couldn't read), the app offers:
   - **Teach the app how to read this statement** (see "Teaching");
   - **Use your bank's CSV or OFX download instead**;
   - **Reconcile by hand**;
   - or continue to the review screen anyway.
5. Review screen:
   - **"Read using: {layout name}"** and whether the statement adds up.
   - **Starting and ending balance** read from the statement (editable; typed in for CSV/OFX files, which
     usually lack them).
   - **Matched**: ticked automatically; the user can untick.
   - **Possible match**: the user confirms or rejects.
   - **On your statement, not in the app**: Add (prefilled) or Skip.
   - **In the app, not on your statement**: left unticked, with a note that it may appear next month or be a
     duplicate.
   - **Couldn't read**: text that looked like a transaction but didn't parse; fix (by marking its parts,
     which also teaches the layout) or ignore.
   - Optional **"The signs look reversed. Flip them?"** prompt (see "Signs").
6. **Finish reconciliation** is enabled only when the difference is exactly $0.00.
7. If the statement came from an unrecognised bank and was read successfully, finishing also **saves its
   layout** with a suggested name the user can change ("We'll recognise {name} statements next time").

All copy follows the plain-language rule (no "layout", "parse", "unmatched ledger entry", "cleared" or
"tracked" on screen; say "how to read this bank's statements").

## Statement reader — `core/src/statement/`

Small units, each testable alone. Every bank-specific choice comes from a `StatementLayout`; the units
contain no bank names.

1. **`pdf_text`**: extracts text lines in content order with a pure-Rust library. First candidate:
   `pdf_oxide` (MIT); the choice is confirmed by reproducing all 16 real statements before it is adopted.
   Returns a distinct error for no text layer, encrypted, and unreadable files.
2. **`layout`**: the `StatementLayout` model (below), its strict validation, and its JSON form.
3. **`tokens`**: date and amount recognition driven by the layout's options; infers a missing year from the
   entered period (including December→January periods).
4. **`rows`**: groups lines into rows using the layout's row rules. Rows dated more than the matching
   leeway (7 days) outside the entered period are dropped quietly, not shown as "Couldn't read", because
   quarterly statements repeat earlier months. By default a row starts at a line
   beginning with a date and ends at the first money amount; lines in between are the description; a
   following amount is the running balance when the layout says so. A dated line with no amount before the
   next date goes to "Couldn't read" and is never guessed.
5. **`sections`**: splits on the layout's starting/ending-balance label pairs; each section has a name, a
   starting balance, an ending balance and its rows.
6. **`checks`**: per section, whichever the layout provides: start + rows = end, or rows = the statement's
   activity totals (additions and subtractions) for investment-style statements; plus running-balance
   continuity per row. Failures are shown and never block on their own.
7. **`select`**: chooses the layout for a statement (see "Choosing a layout").
8. **`learn`**: derives a layout from a successful general read or from the user's marked examples
   (see "Learning").

### `StatementLayout` (data, not code)

A versioned JSON document built only from a **closed set of options**: no free-form regular expressions or
executable content, a size limit, and strict validation on every load. Fields:

- **Identity:** id, display name, schema version, and **recognition phrases** (text that appears on page 1 of
  every statement from that bank). Phrases may not contain runs of four or more digits, email addresses or
  phone numbers, so account numbers and personal details never end up in a layout.
- **Dates:** the accepted formats from a fixed list (`MM/DD/YY`, `MM/DD/YYYY`, `MM/DD`, `Mon DD`,
  `Mon DD, YYYY`, `YYYY-MM-DD`, `DD/MM/YY`, `DD/MM/YYYY`), whether rows carry a second (posting) date, and
  marker characters to ignore (e.g. `*`).
- **Amounts:** negative styles from a fixed list (leading `-`, spaced `- `, parentheses, trailing `-`,
  `CR`/`DR` suffix); currency symbol optional or required; thousands and decimal separators.
- **Rows:** which money amount on the row is the transaction amount (first or last); whether a running
  balance follows it; whether integer columns after the amount are ignored (points); whether description
  lines may follow the amount.
- **Balances and sections:** starting/ending label pairs; a section-start label; which column of a
  multi-column summary to read (by position, default the first, "current month"); and, for
  investment-style statements, the activity-total labels (e.g. "Total Additions" / "Total Subtractions")
  used by the check instead of start + rows = end.
- **Sections to skip:** headings whose content is ignored up to the next heading (e.g. "Cash Sweep
  Activity", a portfolio-wide summary page).
- **Holdings table (investment layouts):** the heading that starts it and the order of symbol, quantity,
  price and market value within an entry.
- **Lines to ignore:** literal phrases (e.g. "Order Number", "Continued on").
- **Signs:** as printed or reversed, per account group (cash, credit, loan).

**Built-in layouts** for the six owner institutions and a **general default layout** ship in
`core/data/statement_layouts/` (embedded at build time), each covered by a synthetic fixture test.
Learned layouts are stored in a new `statement_layouts` table in the profile's own database (encrypted with a
protected profile), additive `CREATE TABLE IF NOT EXISTS`.

### Choosing a layout

1. **Recognised:** if a learned or built-in layout's recognition phrases all appear on page 1, use it
   (learned layouts win over built-ins).
2. **Not recognised, or the recognised layout doesn't add up:** read with the general default layout and
   every built-in layout, and keep the best: adds up first, then most rows, then fewest "Couldn't read" lines.
3. The review screen names the layout used. A recognised layout that has stopped adding up (the bank changed
   its statement) leads to the same "Teach the app" offer, and teaching updates that layout.

### Learning

- **Automatic:** when a statement from an unrecognised bank is read successfully (it adds up, and nothing
  is left in "Couldn't read" or the user has ignored those lines) and the reconciliation finishes, the app
  saves a layout. It narrows the general options to the ones actually seen on that statement, and suggests
  recognition phrases from page-1 text found on the statement (checked against the identity rules above).
- **Teaching** (when it doesn't add up, or on request):
  1. The app shows the statement's lines in order.
  2. The user clicks one transaction and marks its date, description and amount, then marks the starting
     and ending balance.
  3. The app derives the date format, negative style, row rules and balance labels from those marks,
     re-reads the whole statement and checks it adds up. If it still doesn't, it asks for one more example
     row (up to three); after that it offers the CSV/OFX and by-hand fallbacks.
  4. On success the user confirms the name and recognition phrases, and the layout is saved.
- **Corrections improve the layout:** fixing a "Couldn't read" line by marking its parts, or correcting a
  balance label, updates the layout in use (a learned one directly; a built-in one via a learned copy that
  then takes priority).
- Learned layouts can be renamed or removed in Settings ("Statements the app knows how to read").

### CSV/OFX/QFX/QIF uploads

- Read with the existing `importer::load_transactions`, filtered to the period (with the same date leeway).
- Signs follow the account's remembered import direction (`sign_flip`).
- The user types the starting and ending balance; everything after that is the same review and finish.
- No layout is learned from these files.

Out of scope: OCR; sharing, exporting or importing layouts; keeping the statement file.

## Investment accounts

The statement's account value moves with the market, so the cash-balance rule cannot apply. An investment
reconciliation instead has two parts, both on the same review screen:

1. **Activity.** Every activity row (dividends, interest, buys, sells, reinvestments, deposits, withdrawals,
   fees) is matched to the account's transactions exactly as for other accounts, with the same Add / Skip /
   possible-match handling. The self-check is rows = the statement's activity totals for the period.
2. **Share counts.** The holdings table is read into (symbol, name, shares, price, market value) and compared
   with the app's holdings for the account by symbol:
   - **Same shares:** shown as matching.
   - **Different shares:** "Update the app to {n} shares" or leave it.
   - **On the statement, not in the app:** "Add this holding" with symbol, name, shares and price from the
     statement; the user must enter what they paid (cost basis), since the statement's market value is not
     what they paid.
   - **In the app, not on the statement:** shown with "Remove from the app" or leave it.
   - Market value is displayed for reference only.

**Finishing an investment reconciliation** is allowed when every activity row is resolved (matched, added,
or explicitly skipped) and every share count matches exactly after the user's choices. The record stores the
period, the statement's total ending value for reference, and `source`; there is no exact-balance rule.
Holding updates are applied in the same database transaction as the rest of the finish, through the existing
holdings store functions.

## Signs (statement amount → app amount)

App conventions (`core/src/store.rs`, `StoredAccount` docs): cash accounts store money in as positive;
a credit charge is negative and a payment positive; a loan payment is positive and reduces what is owed.

| Account type | Default conversion |
|---|---|
| Checking, savings, investment (cash side) | As printed; parentheses or minus = money out |
| Credit | Negated: printed charge `$7.40` → `-7.40`; printed payment `-$43.08` → `+43.08` |
| Loan | Printed payment total → positive payment |

A layout may reverse the default for its account group. If negating every converted amount would give
clearly more matches (strictly more matched rows, and at least half of all rows), the review screen suggests
flipping. The user decides; the app never flips on its own. An accepted flip is remembered in that layout.

## Matching

One-to-one between statement rows and app transactions.

- **Candidates:** this account's non-deleted transactions not yet settled by a finished reconciliation,
  dated from 7 days before the period start to 7 days after the period end.
- **Matched:** converted amount exactly equal and date within 3 days. Ties go to the closest date, then the
  most similar description.
- **Possible match:** exact amount with a date 4–10 days off, or two or more equally good candidates.
- An amount that differs at all, even by a cent, is never matched.
- **Add from statement:** creates a transaction on the account with the statement date, description and
  converted amount. It is categorised the way imports are (categorizer and import category memory) and
  ticked as part of the finish.

## Balance rule (manual and upload; all accounts except investments)

- **Starting point:** the ending balance of the account's last finished reconciliation; on the first
  reconciliation, the statement's starting balance (manual reconciling asks for it the first time only).
- **Rule:** starting point + the change from every ticked transaction not yet settled by a finished
  reconciliation must equal the statement ending balance exactly. Balances are in statement terms: the cash
  balance, the amount owed on a card, or the outstanding principal on a loan. Each app transaction changes
  that balance by: cash `+amount`; credit `-amount` (a charge, stored negative, raises what is owed); loan
  `-COALESCE(principal_amount, amount)` (matching `account_balance_as_of`).
- **Which reconciliation settled a transaction** is stored on the transaction (new nullable
  `reconciliation_id` column, added with the existing additive `migrate_*_if_missing` pattern). This is
  needed because late items can be dated before the previous statement's end, so dates alone can't decide it.
- **Existing data:** for each existing reconciliation record, in date order, ticked transactions on that
  account dated on or before its `statement_date` and not yet linked are linked to it.
- The `reconciliations` table gains `period_start`, `starting_balance` and `source`
  (`manual` | `statement_pdf` | `statement_download`), all nullable for existing rows. No statement content
  is stored.

## Data flow and commands

1. `read_statement(path, accountId, periodStart, periodEnd, sectionIndex?)`:
   - refuses files over 20 MB or PDFs over 200 pages;
   - PDFs: chooses a layout, parses the sections; with several sections and no `sectionIndex`, returns them
     for selection;
   - downloads: loads and filters the rows;
   - matches the chosen section and returns the review result: rows by group, checks, the layout used,
     whether it is recognised, the sign-flip suggestion, and a **review token**.
   - The token follows the existing import-review-token pattern: it is bound to the profile identity and
     generation, the account, the parsed rows and the account's current transaction revision, and expires
     after 10 minutes.
2. `statement_lines(token)`: the statement's lines in order, for teaching.
   `teach_statement_layout(token, marks)`: derives a layout from the marks, re-reads, and returns a new review
   result and token (nothing is saved yet).
3. `finish_statement_reconciliation(token, decisions)`, in **one database transaction**:
   - applies the user's choices (confirmed matches, unticks, rows to add with any edits, sign flip,
     edited balances, corrected lines);
   - checks the exact $0.00 rule;
   - creates the added transactions, ticks the matched and added ones, records the reconciliation, links the
     settled transactions, and saves the new or updated layout when there is one.
   - Any failure saves nothing.
4. `list_statement_layouts`, `rename_statement_layout`, `delete_statement_layout` for Settings.
5. A stale or expired token, a profile switch or a lock refuses finishing with: "Your data changed while you
   were reviewing. Please read the statement again."
6. Manual reconciling moves to the same core balance rule and record.
7. Frontend: a new owner hook `useStatementReconcile`, a `StatementReviewDialog` and a `StatementTeachDialog`,
   so `AccountDetailView` grows only by the entry point; a Settings section for known statements. Response
   validation follows the existing runtime contract checks (`contractChecks`).

All commands run on the existing FIFO command worker. Commands are exported with a glob re-export
(`pub use self::x::*`), as the command modules require.

## Errors (plain language)

| Situation | Message |
|---|---|
| No text layer | "This PDF is a picture of the statement, so the app can't read its text. You can use your bank's CSV or OFX download, or reconcile by hand." |
| Encrypted or damaged | "This PDF can't be opened. If it has a password, save an unlocked copy from your bank's website." |
| Too large | "This file is too large to be a monthly statement." |
| No rows in the period | "No transactions were found between {start} and {end}. Check the dates, or make sure this is the statement for {account}." |
| Statement doesn't add up | "Some of this statement couldn't be read." with the Teach / download / by-hand / continue choices. |
| Teaching still doesn't add up after three examples | "The app still can't read this statement. You can use your bank's CSV or OFX download, or reconcile by hand." |

## Privacy

- The statement file is read locally and dropped after parsing; nothing is cached or copied.
- Statement text is never logged, and appears in errors only as the rows shown on screen.
- Layouts hold only formats, labels and recognition phrases; the identity rules keep account numbers, email
  addresses and phone numbers out of them. They stay in the profile's database and never leave the computer.
- Reconciliation records and layouts follow the profile's normal encryption when it is password-protected.

## Testing (test-first)

- **Investment units:** activity-total check, last-amount rows, multi-column summaries, skipped sections,
  quiet out-of-period drops, holdings parsing, share-count comparison and the investment finish rule
  (blocked until every row is resolved and every share count matches).
- **Core units:** tokens (every date and amount form, year inference, December→January), rows (multi-line
  descriptions, running balances, points column), sections and checks, layout validation (rejects unknown
  options, oversize documents and personal-looking recognition phrases), layout selection (recognised,
  best-of fallback, learned over built-in, a recognised layout that stopped adding up), learning (automatic
  from a general read; derived from marks; corrections update a learned copy), matching (exact-amount-only,
  date windows, tie-breaks, possible matches, sign-flip suggestion), balance rule (first and later
  reconciliations, late-dated items, migration of existing records), CSV/OFX path, and the atomic finish
  (rollback on failure, stale tokens, layout saved only on success).
- **Synthetic PDF fixtures:** generated by a committed script with fictional names, numbers and amounts,
  under `core/tests/fixtures/statements/`:
  - one per owner-institution layout (including the mortgage);
  - an **investment portfolio** fixture: two accounts plus a portfolio page, prices before amounts, a
    three-column summary, a skipped sweep section, a holdings table, and a quarterly variant repeating
    earlier months;
  - **"unknown bank" fixtures** in layouts that are none of the six (e.g. `DD/MM/YYYY` dates, `CR` suffixes,
    descriptions after the amount), used to prove the general read, teaching and next-time recognition.
- **Real-statement check (local only, never committed):** an ignored test or example reads PDFs from
  `E:\misc\Programming\Claude\Statements` and prints counts only.
  - Acceptance per statement: the layout's check passes (start + rows = end, or rows = activity totals);
    every holding read for investment statements; zero false matches against a reviewed expectation; every
    non-parsed transaction-like line appears in "Couldn't read".
  - Also run with the built-in layouts disabled, to measure how the general rules plus teaching cope with
    banks the app has never seen.
- **Frontend:** `StatementReviewDialog`, `StatementTeachDialog`, the Settings section and
  `useStatementReconcile` component tests (`createRoot` + `act`).
- **End to end:** compiled-app specs that
  - upload a known-bank fixture, add a missing transaction, finish, then reconcile the next fixture statement
    to confirm it picks up from the previous ending balance;
  - upload an unknown-bank fixture that doesn't add up, teach it, finish, then upload that bank's next
    statement and confirm it is recognised and read without teaching.
- **Full gate:** all frontend tests, lint/type, Rust workspace, strict Clippy/format, fresh Tauri build and
  the full parallel E2E suite (`node e2e/run-all.mjs`).

## Out of scope

OCR for scanned PDFs; sharing, exporting or importing layouts; keeping or attaching the statement file;
reconciling several accounts from one upload in a single pass (the user repeats the upload per section);
undoing a finished reconciliation.
