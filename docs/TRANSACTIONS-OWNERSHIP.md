# Transactions ownership — M/N/O continuation

This describes implemented ownership on release-1.3.1 and its remaining boundaries.
Profile selection, locking and data-file changes remount the app;
the ledger controller lives for that app/profile mount and remains mounted across
tab navigation.

| Owner | Current responsibility |
|---|---|
| `useTransactionsLedger` | Filter/saved-filter composition, sort, transfer collapse, visible row count, selection, batch history and selection-limit actions |
| `useLedgerFilters` | Filter fields, saved filter snapshots and existing profile UI-state persistence |
| `transactionReads` / `transactionContracts` | Versioned validated snapshot adapter, profile-bound calls, pending-call coalescing and stable error classification; compatibility list reads |
| `useTransactionData` | Atomic shared transactions/accounts/stats/categories/icons/tags/flags/members; full/targeted reads, fallback, loading/error/retry, optimistic reconciliation and session/request cancellation |
| `useTransactionRowActions` | Row-edit, delete, debt, principal, split, notes/tag state and actions; chooses complete versus targeted refresh |
| `useTransactionBulkActions` | Manual creation, categorization, similar-merchant decisions, bulk category/member/tags/delete/flip, undo and review state; explicit recurring refresh dependency |
| `useTransactionTransfers` | Transfer candidate/auto-link review, link/unlink, dismissal and undo state/actions |
| `transactionExport` | Full matching sorted ledger CSV flow, protection disclosure, native destination and bound file write |
| `useImportReview` | Existing transaction import preview/commit workflow, preview identity, selected rows and post-commit refresh contract |
| `App` | Composition, profile/navigation identity, shared account/category/member management, native import file/sign choices, inbox/month-review contexts and cross-view refresh wiring |
| `usePaymentSource` | Explicit applied-payment lookup, request sequence and profile-generation/unmount cancellation |
| `App` navigation | Tab selection, pending payment target, row expansion/focus/scroll and temporary highlight |

## Current data flow and invariants

`useTransactionData.refresh()` consumes one coherent backend snapshot under the
current generation/session contract. `refreshRows(ids)` uses the same contract for
selected rows and all metadata, replaces existing matching rows, removes missing
requested IDs, and falls back to a full snapshot when other inserted/deleted rows
prevent a complete model. Invalid, stale and superseded responses cannot publish.
Category correction retains its existing optimistic update and failure reload.

The shared transaction array also feeds Dashboard, account detail, Cash Flow,
Household, report/dialog contexts, import inbox, month review and command-palette
entries. These consumers receive the shared data, not a filtered/paged ledger
snapshot. Export continues to use all sorted matching transaction legs, while
display collapses linked pairs only after filtering/sorting and before paging.
A page of one merged transfer represents two transactions in the displayed count.
Account filtering includes an applied payment's debt account as well as its source.

Select all uses every matching display row, including rows below Show more, with
the existing 250-transaction cap. A merged pair is kept together. Clearing a batch
after a mutation lets the next batch advance; unticking the header does not mark
that batch done. Filter, sort or page-step changes reset paging and batch history
but retain selected IDs, matching the existing behavior. Explicit pending payment
navigation controls its own visible row count until the target has been revealed.

No backend paging, schema migration or persisted selection is introduced. Shared
unfiltered data remains available to other views; inactive ledger processing is
skipped while its query and selection remain mounted. Accepted read revisions now
drive transaction-dependent active-view refreshes. The backend anomaly cache and
deferred recurring suggestions are documented in `TRANSACTION-DATA-CONTRACT.md`.

## Remaining boundaries

1. Keep the feature-owned row, bulk, transfer, export, import and shared read units
   cohesive. A combined facade is optional if it simplifies composition; shared
   account/category/member management and cross-view navigation belong in the shell.
2. Extend stable typed argument/result adapters and freshness/error ownership to
   non-transaction features. Their legacy aggregate calls and async/profile commands
   do not inherit the synchronous runtime request scope automatically.
3. Keep the explicit mutation dependency table current and replace remaining
   legacy version bumps only with corresponding coverage. A scoped transaction
   revision is not an app-wide data revision.
4. Continue missing transition and cross-view metric fixtures as each fix lands.
   The external implementation report maps new versus existing coverage and gaps.
5. Use measured cold, warm and actual-edit costs to decide the next F optimization
   and conditional G paging. Cache-hit measurements are not mutation measurements.

Validation uses controller characterization tests plus a fresh compiled app, smoke,
affected ledger/profile/import/payment specs and full desktop regression. Unit
tests do not establish compiled geometry or all platform behavior.
