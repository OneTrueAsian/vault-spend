# Reconcile by uploading a statement PDF — design

Date: 2026-10-11. Status: approved in brainstorming, awaiting written-spec review.

## Goal

Let a user reconcile an account either by hand (as today) or by uploading the bank's monthly statement PDF.
The user enters the period the statement covers; the app reads the statement, checks each statement
transaction against the account's transactions, offers to add anything missing, and finishes the
reconciliation under the same exact-to-the-cent rule as manual reconciling.

**Success:** on the owner's real statements (Capital One, Amex, Chase, a credit union, a mortgage), every
statement transaction is either matched automatically or clearly surfaced for review, and nothing is ever
marked as matched by mistake.

## Decisions (from the owner)

- Input is the **PDF statement** (not CSV/OFX downloads).
- A statement transaction missing from the app is **offered for one-click add**, prefilled from the statement.
- Works for **all account types** (checking, savings, credit, loan, investment cash side).
- Finishing uses the **same rule as manual**: exact $0.00 difference; both paths save the same record.
- Approach 1: **pure-Rust direct PDF reading + review screen**. No bank templates and no "teach it once" in v1.
- Balance rule: **pick up from last time** (see "Balance rule"), shared by manual and upload.

## Assumptions

- Everything runs locally. The PDF is read once and never uploaded, copied, cached or logged.
- Scanned/photographed PDFs (no text layer) are unsupported in v1, with a plain explanation.
- A PDF may hold several accounts (the credit union's does); the user picks the section that matches.

## What the real statements showed (13 PDFs, 5 institutions)

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

## User flow (Account Detail → "Reconcile with a statement")

1. Choose **Upload statement PDF** (beside the existing manual option, now offered for every account type).
2. Enter the statement's **start and end dates**, then pick the PDF in the native file dialog (`.pdf` only).
3. If the PDF holds several account sections, pick the one for this account.
4. Review screen:
   - **Starting and ending balance** read from the statement (editable), and whether the statement adds up
     (start + rows = end).
   - **Matched**: ticked automatically; the user can untick.
   - **Possible match**: the user confirms or rejects.
   - **On your statement, not in the app**: Add (prefilled) or Skip.
   - **In the app, not on your statement**: left unticked, with a note that it may appear next month or be a
     duplicate.
   - **Couldn't read**: text that looked like a transaction but didn't parse; fix or ignore.
   - Optional **"The signs look reversed. Flip them?"** prompt (see "Signs").
5. **Finish reconciliation** is enabled only when the difference is exactly $0.00.

All copy follows the plain-language rule (no "unmatched ledger entry", "cleared", "tracked").

## Statement reader — `core/src/statement/`

Small units, each testable alone:

1. **`pdf_text`**: extracts text lines in content order with a pure-Rust library. First candidate:
   `pdf_oxide` (MIT); the choice is confirmed by reproducing all 13 real statements before it is adopted.
   Returns a distinct error for no text layer, encrypted, and unreadable files.
2. **`tokens`**: date recognition for the forms above, inferring a missing year from the entered period
   (including December→January periods); amount recognition for the forms above (two decimals required).
3. **`rows`**: a row starts at a line beginning with a date and ends at the first money amount. Lines in
   between are the description. A second amount on the closing line is the running balance. A dated line
   with no amount before the next date goes to "Couldn't read" and is never guessed.
4. **`sections`**: splits on starting/ending-balance label pairs; each section has a name, a starting
   balance, an ending balance and its rows.
5. **`checks`**: start + rows = end per section, and running-balance continuity per row. Failures are shown
   as warnings and never block on their own.

Out of scope: per-bank templates, OCR, keeping the PDF.

## Signs (statement amount → app amount)

App conventions (`core/src/store.rs`, `StoredAccount` docs): cash accounts store money in as positive;
a credit charge is negative and a payment positive; a loan payment is positive and reduces what is owed.

| Account type | Conversion |
|---|---|
| Checking, savings, investment (cash side) | As printed; parentheses or minus = money out |
| Credit | Negated: printed charge `$7.40` → `-7.40`; printed payment `-$43.08` → `+43.08` |
| Loan | Printed payment total → positive payment |

If negating every converted amount would give clearly more matches (strictly more matched rows, and at
least half of all rows), the review screen suggests flipping. The user decides; the app never flips on its own.

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

## Balance rule (manual and upload)

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
  (`manual` | `statement`), all nullable for existing rows. No PDF content is stored.

## Data flow and commands

1. `read_statement(path, accountId, periodStart, periodEnd)`:
   - refuses files over 20 MB or 200 pages;
   - parses the sections; with several sections, returns them for selection, and the follow-up call carries
     the chosen section index;
   - matches the chosen section and returns the review result: rows by group, checks, the sign-flip
     suggestion, and a **review token**.
   - The token follows the existing import-review-token pattern: it is bound to the profile identity and
     generation, the account, the parsed rows and the account's current transaction revision, and expires after
     10 minutes.
2. `finish_statement_reconciliation(token, decisions)`, in **one database transaction**:
   - applies the user's choices (confirmed matches, unticks, rows to add with any edits, sign flip,
     edited balances);
   - checks the exact $0.00 rule;
   - creates the added transactions, ticks the matched and added ones, records the reconciliation and links
     the settled transactions.
   - Any failure saves nothing.
3. A stale or expired token, a profile switch or a lock refuses finishing with: "Your data changed while you
   were reviewing. Please read the statement again."
4. Manual reconciling moves to the same core balance rule and record.
5. Frontend: a new owner hook `useStatementReconcile` and a `StatementReviewDialog`, so
   `AccountDetailView` grows only by the entry point. Response validation follows the existing runtime
   contract checks (`contractChecks`).

All commands run on the existing FIFO command worker. Commands are exported with a glob re-export
(`pub use self::x::*`), as the command modules require.

## Errors (plain language)

| Situation | Message |
|---|---|
| No text layer | "This PDF is a picture of the statement, so the app can't read its text. You can still reconcile by hand." |
| Encrypted or damaged | "This PDF can't be opened. If it has a password, save an unlocked copy from your bank's website." |
| Too large | "This file is too large to be a monthly statement." |
| No rows in the period | "No transactions were found between {start} and {end}. Check the dates, or make sure this is the statement for {account}." |
| Statement doesn't add up | Warning listing what couldn't be read; the user can continue. |

## Privacy

- The PDF is read locally and dropped after parsing; nothing is cached or copied.
- Statement text is never logged, and appears in errors only as the rows shown on screen.
- Reconciliation records follow the profile's normal encryption when it is password-protected.

## Testing (test-first)

- **Core units:** tokens (every date and amount form, year inference, December→January), rows (multi-line
  descriptions, running balances, points column), sections and checks, matching (exact-amount-only, date
  windows, tie-breaks, possible matches, sign-flip suggestion), balance rule (first and later
  reconciliations, late-dated items, migration of existing records), and the atomic finish (rollback on
  failure, stale tokens).
- **Synthetic PDF fixtures:** generated by a committed script that copies each of the five layouts with
  fictional names, numbers and amounts; committed under `core/tests/fixtures/statements/`.
- **Real-statement check (local only, never committed):** an ignored test or example reads PDFs from
  `E:\misc\Programming\Claude\Statements` and prints counts only.
  - Acceptance per statement: start + rows = end; zero false matches against a reviewed expectation; every
    non-parsed transaction-like line appears in "Couldn't read".
- **Frontend:** `StatementReviewDialog` and `useStatementReconcile` component tests (`createRoot` + `act`).
- **End to end:** a new compiled-app spec uploads a fixture PDF, adds a missing transaction, finishes, then
  reconciles the next fixture statement to confirm it picks up from the previous ending balance.
- **Full gate:** all frontend tests, lint/type, Rust workspace, strict Clippy/format, fresh Tauri build and
  the full parallel E2E suite (`node e2e/run-all.mjs`).

## Out of scope for v1

OCR for scanned PDFs; per-bank templates or "teach it once"; keeping or attaching the PDF; several accounts
reconciled from one upload in a single pass (the user repeats the upload per section); undoing a finished
reconciliation.
