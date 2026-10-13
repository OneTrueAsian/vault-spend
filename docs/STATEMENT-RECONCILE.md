# Statement reconciling

How Vault Spend checks an account against a statement. Change this file in the same commit as any change to
the behavior it describes.

## Purpose

A person reconciles an account by hand (tick each transaction on the statement until the difference is
$0.00) or by uploading the statement: a PDF, or the bank's CSV, OFX, QFX or QIF download. The app reads the
file on this computer, pairs each line with the account's transactions, offers one-click adding for anything
missing, and finishes only when the figures agree exactly. Investment accounts reconcile their cash activity
and their share counts.

## The shared balance rule

Manual and statement reconciling use one rule (`core/src/store/reconcile.rs`).

- The statement date the person reconciles to is the as-of date. Everything before it counts; later
  reconciliations never change an earlier month's starting point.
- A statement starts from the ending balance of the latest earlier reconciliation that has a balance. The first
  reconciliation of an account asks for the starting balance.
- Which reconciliation settled a transaction is stored on the transaction (`reconciliation_id`). Rows already
  settled are not offered again.
- The difference is `ending balance - (starting balance + the change of every settled row)`. The change of a
  row is its amount for cash and investment accounts, minus its amount for cards, and minus its principal part
  for loans (`balance_change`). Anything but exactly `0.00` blocks Finish.
- An investment statement's record (`holdings_checked` is set) keeps the statement's total value for display,
  is never a cash starting point, and the cash it settled is carried into the next starting point.
- All arithmetic is exact decimal in Rust and exact integer units (`src/reconcileMath.ts`) on screen; no
  floating point.

## The reader

`core/src/statement/`: `pdf_text` -> `sections` / `rows` / `holdings` -> `checks` -> `select`.

- `pdf_text` extracts text lines in the order the PDF draws them (content order), never by position on the
  page, using the pure-Rust `pdf_oxide` crate (see `THIRD-PARTY-NOTICES.txt`). Limits: 20 MiB, 200 pages, 30
  seconds. A PDF with no text (a picture) is refused with a plain message; there is no OCR.
- `sections` splits the statement into accounts and reads each one's balances, totals, rows and holdings.
  `rows` groups lines into transactions (a line starting with a date, ending at the line that carries money).
  `holdings` reads symbol, name, quantity, price and value; a holding stays open until its price is read and
  takes the amount that equals shares x price.
- `checks` decides whether the reading adds up: activity (the statement's printed totals, else start + rows =
  end, using a loan payment's principal part), holdings (values plus cash = the printed total) and running
  balances.
- `select` chooses the reading: a learned layout first, then a built-in one it recognizes, when it adds up.
  Otherwise the best of every layout, each also tried with money in and out reversed. Readings are compared by
  checks passed, then sections with balances found, then fewer failures, more rows and fewer unread lines (a
  reading that finds nothing must not beat one that can see the figures don't add up).

## The layout format

Everything bank-specific is data (`StatementLayout`, schema 1), built from a closed set of options: date
formats, negative styles, which amount on a line is the transaction, balance label pairs, section starts,
skipped sections, ignored lines, holdings columns, sign flips, period totals and a few flags
(`amount_before_label`, `exact_period`, `principal_column`). There are no patterns, expressions or code.

Safety limits, checked on every load (`validate`): at most 16 KiB; at most 32 entries per list; labels at most
80 characters with `is_safe_phrase` (no run of four digits, no `@`, fewer than seven digits in all), so a
layout cannot carry an account number, email address or phone number. Built-in layouts live in
`core/data/statement_layouts/` and are covered by tests.

## Learning

- Automatic: a statement read successfully by the general layout can be remembered on finish ("Remember this
  statement"), with a name and the phrases that recognize it.
- Teaching: when a reading doesn't add up the person clicks one example (a transaction's date and amount, the
  balances or totals, one holding's symbol, shares, price and value, the total). The app derives a layout from
  the clicked positions and checks it; up to three tries, then it points to the bank's download or reconciling
  by hand.
- Learned layouts are stored per profile in `statement_layouts` (inside the profile database, so they are
  encrypted with it). Settings lists, renames and removes them. They are never shared or exported.

## Matching

One statement line pairs with one unsettled transaction. The amount must match exactly (in the app's sign for
the account kind). A date within 3 days of the line pairs automatically; 4-10 days, or a tie between two
different candidates, is only a possible match the person confirms. Pairing is symmetric and does not depend on
input order. If most lines only match with reversed signs the screen offers "Flip them". A matched loan
payment can take its principal part from the statement.

## Investments

The cash activity is matched like any account, checked against the statement's totals or its cash balances.
Share counts are compared per symbol (lots added together): the person updates, adds (with what was paid) or
removes holdings, and the finish refuses unless every share count agrees. If the holdings can't be read or
checked the person must tick "Finish without checking holdings" and update share counts in Investments.

## The review session

`src-tauri/src/statement_review.rs`, commands in `src-tauri/src/commands/statements.rs`.

- Reading a statement opens one in-memory session holding the statement's text lines, tied to the profile
  generation and the account. Every command takes `generation`; a different profile is refused.
- Every review and teaching step returns a new token and restarts a 10-minute lifetime. An old token is
  refused. Locking the app, switching profile, finishing or cancelling ends the session.
- Finishing is one database transaction: matches, added transactions, holding changes, the reconciliation
  record and the learned layout all save together or not at all. The account's signature is checked first, so a
  change made elsewhere in the meantime asks the person to read the statement again.

## Privacy

Statements are read on this computer and never uploaded. The app keeps no copy of the file and writes no
statement text to logs, errors or the database: only the transactions the person accepted, the reconciliation
record, and (if remembered) the layout, which holds only the generic labels that recognize the bank. Real
statements are never committed; tests use fictional fixtures (`core/src/statement/fixture_pdf.rs`,
`e2e/lib/statementPdf.mjs`).

## Tests

- Rust unit tests for every module, the store rules and the commands; frontend contract, arithmetic, hook and
  dialog tests; compiled-app specs 300 (upload, learning, Settings), 301 (teaching an unknown bank) and 302
  (investment share counts).
- Local only, never in CI: the `real_statement_check` example reads the owner's real statements and prints
  counts, never text or amounts.

  ```
  cargo run -p budget_core --release --example real_statement_check -- "<folder>" [--no-builtins] [--only LAYOUT_ID]
  ```

  `<folder>\periods.txt` has one line per PDF: `file name|YYYY-MM-DD|YYYY-MM-DD|kind` (start date, end date,
  and kind: cash, credit, loan or investment). Diagnostic flags (`--window`, `--shape`, `--rows`, `--holdings`)
  print structure with generic words only and digits as 9. Keep `periods.txt` next to the statements, outside
  the repository.
