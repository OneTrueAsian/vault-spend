# Ledger: "Load more" and Select all in batches of 250

Date: 2026-10-04
Status: design agreed with the owner in conversation (2026-10-04); built on branch `1.3.0`
Owner answers: "Load more" button (not endless scrolling); Select all capped at 250 selected
transactions "so changes stay fast"; when more match, select the first 250 and say so; totals
and filters cover every matching row.

## Why

The Transactions tab shows its rows in pages of 10/25/50 with Previous/Next buttons, and the
header checkbox selects only the page on screen. Bulk changes on thousands of rows are slow and
easy to start by accident.

## Scope decision

Every view (Dashboard, Reports, Budget, the ledger) works from the one in-memory transaction
list, and since 1.2.9 a one-row edit re-reads only that row (QA M1). Reading the ledger from the
backend page by page would mean reworking every view's data for little gain, so the list stays
loaded in full; this change is to what the ledger shows and selects.

## Design

### Load more (`src/ledgerPaging.ts`)

- The ledger shows the first N matching rows (N = the "at a time" choice: 25, 50 or 100;
  default 50). Below the table: "Showing 50 of 1,200 transactions" and a **Show 50 more**
  button (the last step says "Show 37 more"); once everything shows, "Showing all 1,200
  transactions" and no button.
- Changing a filter, the search, the sort or the "at a time" choice goes back to the first N.
- "View payment" (jump to a row) shows enough rows to include that row instead of turning pages.
- Counts always cover every matching row, never only the ones shown.

### Select all in batches (`src/ledgerSelection.ts`)

- The header checkbox selects **every matching row**, not just those shown, up to **250
  transactions** (a merged transfer row counts as its two transactions).
- When more match, it selects the first 250 in the ledger's order and a note says: "Selected
  250 of the 1,200 matching transactions. A change can apply to at most 250 at a time: apply
  your change, then press Select all again for the next 250."
- After a change is applied (the selection clears), Select all picks the next 250 that weren't
  in an earlier batch, so batches work whether or not the changed rows still match the filter.
  Unticking the header checkbox (no change applied) does not count as done.
- Changing a filter, the search or the sort starts batches over.
- Ticking rows one by one also stops at 250, with the status "A change can apply to at most 250
  transactions at a time."
- Amended during UAT prep (2026-10-04): a later batch's note says so, so the person can tell the
  press moved on: "Selected the next 250 of the 958 matching transactions (250 done in earlier
  batches). Apply your change, then press Select all again for the next 250.", and the last one
  "Selected the last 208 of the 958 matching transactions (750 done in earlier batches). Apply
  your change to finish." Earlier batches that no longer match the filter don't count.
- Also amended: "Showing 50 of N transactions" counts transactions, like the note and the
  selection. It used to count rows, so with transfers (one row, two transactions) the pager and
  the note gave different totals for the same ledger (869 vs 958 on the household demo).

## Testing

- Vitest: `ledgerPaging` (counts, step label, reset, jump-to-row) and `ledgerSelection` (cap,
  transfer pairs never split, next batch after a change, untick doesn't count, filter reset).
- E2E: a new spec seeds 600 rows: Load more grows the table; Select all selects 250 and shows
  the note; a bulk category change, then Select all picks the next 250; the last batch has
  100. feature138 (jump to a payment) updated for Load more.
