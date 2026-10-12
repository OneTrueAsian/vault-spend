# Desktop transaction data contract

`get_transaction_context` and `get_transaction_snapshot` are additive version 1 desktop IPC commands. Existing command names remain available for consumers that have not migrated. Money stays decimal strings, dates stay ISO calendar dates, and nullable fields must be present. Rust and TypeScript both consume `core/tests/fixtures/desktop_transaction.json`; runtime validators reject malformed or incomplete replies.

The context identifies both the profile generation and the runtime session revision. Session revision changes on closing/reopening even the same profile; it is **not** a financial data revision. Profile switch, restore, relocation and existing-profile activation replace the open state through `OpenSession::replace`, which advances session identity under the slot mutex before any path-generation update. Assigning an AppState through DerefMut bypasses this invariant and must not be used for replacement. The snapshot separately returns connection-local `total_changes` and SQLite `data_version`. This pair is comparable only within the same open session/connection. Full and targeted reads return transactions, counts, account balances, categories/icons, anomaly flags, tags and members under one runtime lock and one SQLite read transaction. Targeted requests accept 1–250 positive safe integer IDs. Missing/deleted/generated rows are omitted; the response echoes requested IDs. Full counts and rows must agree.

`createTransactionClient` binds once per mounted profile, sends the captured session with migrated synchronous commands, coalesces identical pending calls, classifies legacy refusals at the boundary, and never retries writes. Closing the client prevents a delayed context lookup from dispatching work. The command worker carries optional `expectedSessionRevision` through a scoped thread-local value; `AppRuntime::lock` rechecks it under its slot mutex before providing a database. This guard covers migrated **synchronous commands that acquire the runtime lock**. It does not propagate through asynchronous tasks, replace authorization, or retroactively protect callers that omit the session metadata. Profile transition commands retain their existing lifecycle contracts.

The shared renderer owner is `useTransactionData`. It publishes one validated model, discards older/superseded/session-mismatched replies, clears pending requests on unmount, and distinguishes first-load failure from a failed refresh of previously loaded data. Overlapping refreshes, external commits or a targeted patch revealing insertion/deletion outside requested IDs require a new full snapshot. The client does not share that new read with an older in-flight snapshot, including across an intervening command. This preserves changes from discarded partial replies. Equal data revisions preserve the existing model reference unless it contains an optimistic edit. Failures keep the previous model visible with an explicit stale-data message and Retry. Identical money, IDs and inclusion rules remain owned by the Store.

## Mutation dependencies

The shared owner now requests `get_transaction_snapshot_compact` (wire version 2).
Its envelope and metadata retain version-1 semantics; a string dictionary and
fixed 17-field transaction tuples reduce repeated field names and strings without
paging or dropping any rows. Debt payments use four-field nested tuples and flags
use three-field tuples. `compactTransactionContracts.ts` validates references,
tuple lengths and nested values, reconstructs the full model, then applies the
version-1 validator. Raw dictionary/tuple arrays are not retained by the owner.
Version 1 remains available and explicitly accepted for existing consumers;
unknown versions fail closed. Both wire formats share the same origin/read guards.
`core/tests/fixtures/compact_transaction.json` pins exact-decimal serialization.

| Mutation | Shared snapshot | Additional dependent consumers |
| --- | --- | --- |
| Amount/date/description/category/account/member/principal/notes/tags | Targeted rows plus all snapshot metadata | Relevant active Reports, Budget, Household, Cash Flow, Dashboard, recurring matches; account-tracked Goals |
| Insert/import/delete/restore | Full snapshot | Same consumers; selections and review/undo workflows retain existing semantics |
| Link/unlink transfer, splits, apply/unapply debt, flip signs, rule application | Full snapshot when related rows can change | Transfer suggestions/auto-linked review, split and generated-payment inclusion rules, all matching consumers |
| Anomaly/transfer dismissal | Their existing review refresh | Dismissal does not hide spending or change financial totals |
| Profile lock/switch/reopen | Discard owner and cache; establish a new context | Existing profile lifecycle clears financial UI and state |
| Registered Budget/Recurring/Goals/assets/holdings changes | Their feature reads, and shared snapshot where requested | Successful writes advance the app's explicit financial epoch for active aggregate consumers; failed writes and backup bookkeeping do not |

Accepted transaction revisions plus the registered successful-mutation epoch key
active-view refetches. The old Dashboard version counter and shared budget-alert
cache are retired. Known supplemental reads have runtime validation, per-command
sequence/error state and explicit Retry. This is not a repository-wide feature
cache; independent modules still require progressively defined contracts.

App calls use their mounted profile's bound client. `create_profile` keeps an
open caller's origin guard through replacement and startup maintenance while
preserving unbound creation from an empty registry. `write_text_file` acquires an
origin-checked runtime guard before publishing any CSV bytes.
Backup listing retains the runtime guard through directory reads; both setting
and clearing a backup mirror retain it through device-settings publication.
Async live-price commands explicitly validate optional generation/session inputs before accessing
credentials and captured generation/session after their network await. This is
explicit async propagation, not an extension of thread-local scope to async tasks.

## Performance boundaries

Anomaly computation has one in-memory cache per open Store, keyed by both revision values. Local SQL changes invalidate it conservatively, external commits invalidate it through `data_version`, and locking/reopening drops it. Failed, rolled-back or unwound read snapshots discard their cache because `total_changes` includes rolled-back writes. Results larger than an estimated 16 MiB are not retained. Cache keys and computations share a read snapshot. Dismissed flags are filtered separately. Nothing is persisted, exposed while locked, or added to the locked reminder projection. A warm unchanged read benefits; an actual mutation may require recomputation.

Inactive ledger filtering/sorting/collapsing receives no rows while preserving filter/selection state. Recurring suggestions load only on the Recurring screen; reminders, recurrence totals/matches and visible Dashboard dependencies remain supported. Full transaction loading remains necessary for shared consumers; backend paging is not implemented.

`tools/startup-perf.mjs` retains legacy batch measurements for comparison and separately measures coherent snapshots, actual note-edit refreshes, synthetic JSON encode/parse work, payload bytes, and opt-in renderer stage samples. `data-vault-transaction-perf` enables a bounded 256-entry timing buffer containing static stage names and durations only. App commit counts are not counts of every descendant React commit. JSON parse microbenchmarks are not isolated measurements of Tauri's native reply deserializer. The optional backend perf log records requested **row counts**, never transaction identifiers or contents.
