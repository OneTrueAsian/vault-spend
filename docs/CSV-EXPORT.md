# CSV export contract

Owner decision, October 9, 2026: retain the existing CSV format, explicitly type
export columns and document spreadsheet safeguards that change text. No new
export mode or automatic removal of apostrophes on import is introduced.

`toCsv` treats every header and undeclared column as text. Transaction Amount,
Reports balances/budget values, and setup-template balances/amounts/shares/prices
are declared decimal columns. Only empty or plain signed decimal strings are
accepted there; values never pass through JavaScript Number. Invalid decimal
data or mismatched rows fail before a file is written. Dates remain ISO strings.

Text beginning with a formula prefix (`=`, `+`, `-`, `@`, including full-width
forms), after leading whitespace/control characters, receives an apostrophe.
Leading control characters also receive an apostrophe. Characters are preserved,
not trimmed or normalized. Numeric-looking descriptions such as `-50.00` are
text and receive this safeguard; a declared amount of `-50.00` stays numeric
looking. Ordinary apostrophes are untouched. Commas, quotes, CR and LF receive
normal CSV quoting independently of text safeguards.

The apostrophe is literal CSV data. It may be visible in a spreadsheet and
survives Vault Spend reimport. Automatically stripping it would corrupt genuine
apostrophes. Account/category names and tags beginning with a risky character
may therefore change on reimport or require matching them to an existing entity.
Existing import rules still trim optional cells, split tags on semicolons and
clean bank descriptions; CSV is not an exact profile backup. Ordinary supported
account/category/tag/notes fields retain their existing import behavior.

The supported spreadsheet check is the installed Windows Excel 16.0 under the
machine's current locale: ordinary CSV open and CSV UTF-8 save/reopen, using
inert arithmetic text only. The external J/K1/L3
checkpoint records observed formula counts, dimensions, numeric values and
limitations. No universal Excel/Sheets/LibreOffice guarantee is made. Other
locales, consumers, edited files, repeated saves and downstream conversions
remain unverified. An exploratory Excel OpenText UTF-8/comma import preserved
zero formulas but expanded 23 records into 28 rows for this corpus; that path
is not accepted for interchange. CSV has no persistent cell types; spreadsheet automatic date
conversion, encoding detection and number rounding can change data. In
particular, Excel numeric cells cannot preserve arbitrary decimal precision even
though exported amount bytes remain exact. Use database/package backups for
exact preservation; do not use spreadsheet resaves as precision-preserving backups.

CSV is plaintext and carries no profile encryption. The protected-profile
warning still precedes each Transactions/Reports picker, and Cancel performs no
export. Help describes both the plaintext and text-prefix policies.
