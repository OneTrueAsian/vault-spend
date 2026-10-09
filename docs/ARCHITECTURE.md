# Architecture and invariants

Developer entry point for the current `release-1.3.1` source. This describes
implemented contracts; it does not certify a release or finish the broader
IPC/freshness migration. Update the relevant section and linked contract when
changing its owner, inclusion rule or lifecycle boundary.

## Owners and boundaries

| Layer | Owner and responsibility |
|---|---|
| Financial model | [core Store](../core/src/store.rs), split into feature modules: SQLite/SQLCipher data, exact arithmetic, inclusion rules and mutations; no Tauri dependency |
| Desktop service | [command worker](../src-tauri/src/command_thread.rs), [runtime](../src-tauri/src/runtime.rs) and [commands](../src-tauri/src/commands.rs): IPC dispatch, open-session access and profile lifecycle |
| Desktop UI | [App](../src/App.tsx): composition, navigation and shared consumers; transaction feature owners are mapped in [Transactions ownership](TRANSACTIONS-OWNERSHIP.md) |
| Mobile | [HTTPS service](../src-tauri/src/mobile_server.rs), [connection](../src/mobileConnection.ts), [repository](../src/mobileRepository.ts) and [offline UI](../src/MobileOfflineApp.tsx): approved read-only projections and separately saved copies |

Commands use glob re-exports: Tauri's generated command macros must remain
available. A Rust function being exported does not itself grant renderer
permission; registration, capabilities, validation and runtime checks are
separate boundaries.

## Money, balances and inclusion

Rust [Transaction](../core/src/models.rs#L4) uses `Decimal`: negative is money
out, positive is money in. Database/IPC money values are decimal strings;
calendar dates are ISO dates. Preserve these at the boundary. Display helpers
and chart calculations using JavaScript numbers are not authoritative financial
arithmetic or a guarantee of arbitrary decimal precision. CSV has its own
[typed-column and spreadsheet limitations](CSV-EXPORT.md).

Trace balances through [account_balance_as_of](../core/src/store/accounts.rs#L125),
not by summing the visible ledger. It uses the latest checkpoint at or before
the requested date, breaking equal-date ties by descending ID, then includes
live transactions **after** the checkpoint through that date. Without a
checkpoint, it starts at `starting_balance`. An explicit `principal_amount`
replaces the amount for balance calculations. Loans subtract the transaction
total from their amount owed; other types add it. Credit-card current balance
represents available credit, not amount owed.

[Manual balance correction](../core/src/store/accounts.rs#L718) writes a
checkpoint rather than rewriting transactions. It anchors before the correction
date and nets already-posted activity on that date so current balance equals
the requested correction without counting that activity twice. Backdated
transactions at/before a checkpoint may change reports without changing today's
balance. Reconciliation independently uses opening balance plus cleared live
transactions; it is not the same calculation as current balance.

| Calculation | Inclusion rule and source |
|---|---|
| Income/expense | [monthly_totals](../core/src/store/reports.rs#L60) excludes deleted rows, generated debt-payment twins, `Transfer` category and both live linked transfer legs. Positive credit/loan transactions are not income. Expenses are returned as positive spending amounts. |
| Linked transfers | [LIVE_TRANSFER_LEG_IDS_SQL](../core/src/store.rs#L150) excludes a pair only while **both legs are live**; an orphaned surviving leg counts again. Transfers still affect individual account balances. |
| Split category spending | [spending_by_category](../core/src/store/reports.rs#L161) substitutes split lines for the parent; do not count both. Preserve category/date and transfer/generated/deletion exclusions for the specific aggregate. Amount edits reconcile split totals. |
| Applied debt payment | [transactions](../core/src/store/transactions.rs) retains a source payment and creates a balance-side generated twin. Ledger reads omit the twin; account balance reads need its effect. Use apply/unapply and delete/restore owners to keep related rows consistent. |

Ledger transfer collapse and Show more are presentation operations after
filtering/sorting. Shared consumers and CSV export still receive the full
matching data; a collapsed pair represents two transaction legs. Never reuse
the displayed page as an aggregate's data source.

## Trace a transaction mutation

For notes, follow [handleSaveNotes](../src/useTransactionRowActions.ts#L236):
the feature owner calls the profile-bound transaction client, invokes
`update_transaction_notes`, then requests `refreshRows([id])`.
[transactionReads](../src/transactionReads.ts) captures generation/session
context; the synchronous worker's request scope is checked again by
`AppRuntime::lock` before backend access. The Store owns validation and writing.

[useTransactionData](../src/useTransactionData.ts) publishes one validated
snapshot containing rows and related metadata. A targeted refresh removes
missing requested rows; overlap, external commits or changes outside those IDs
can require a full read. Invalid, superseded or wrong-session results cannot
publish. Refresh failure preserves the prior model with a stale/error state and
Retry; it is not an empty successful result. Writes are never automatically retried.

Accepted transaction revisions trigger relevant active-view reads. Insert,
delete, import, split, transfer and generated-payment operations can affect more
than one row. Use the [mutation dependency table](TRANSACTION-DATA-CONTRACT.md#mutation-dependencies)
to choose full/targeted reads and additional consumers. Non-transaction features
retain their own legacy refresh policies; this is not an app-wide revision/cache.

Budget category/alert/flow/member reads and Reports Overview range reads now
use [coherent aggregate contracts](FINANCIAL-READ-CONTRACT.md). Their feature
owner validates one snapshot, rejects superseded requests and matches the
visible month/range before displaying totals. Same-period refresh failures keep
last loaded figures with a persistent warning and Retry. Legacy CSV summary,
other Household models and non-transaction freshness remain separate owners.

## Import commit boundary

[useImportReview](../src/useImportReview.ts) owns review/selection and the
profile-bound preview/commit calls. The backend
[commit_import_for](../src-tauri/src/commands/import.rs#L299) reloads the file,
checks its review token, validates row indices and resolves accounts/categories
before constructing a batch. The [review token](../core/src/import_resolution.rs#L167)
hashes parsed decision-relevant fields and row/error counts, not raw file bytes.
Changed reviewed data requires another preview; byte-only changes that parse
identically are not a signed-file authenticity boundary.
[commit_import_batch](../core/src/store/imports.rs#L106) atomically writes rows,
new accounts/categories, tags/notes, taught rules, category memory and sign
preference in one SQL transaction. Database failure rolls that batch back;
in-memory teaching follows the committed outcome. Do not generalize this guarantee
to every legacy multi-step mutation or other import format without checking its owner.

## Trace a lock or switch

The runtime slot is `NoProfileOpen`, `Locked { profile_id }` or `Open(AppState)`.
Only an open slot provides a usable Store. [lock_current_profile](../src-tauri/src/protection_commands.rs#L167)
passes the captured generation to [auto_lock](../src-tauri/src/auto_lock.rs),
which rechecks the intended profile and retires open state under the runtime
guard. Its lock path advances generation, closes access and broadcasts state.
Manual confirmation, timer, window and supported system events share this
lifecycle rather than hiding financial UI alone.

[StartupGate](../src/StartupGate.tsx#L11) installs its event listener before the
initial read; newer broadcasts win over stale reads. Locked/selector states
unmount the financial App. Selecting a protected profile requires unlock;
the [unlock command](../src-tauri/src/protection_commands.rs#L129) reads strict
registry/key state, applies shared proof-attempt accounting, opens with the key,
rechecks generation and activates/broadcasts. Open-to-open switching, restore
and relocation must retire old requests using the existing replacement path.
`OpenSession::replace` advances session identity under its mutex; do not assign
a replacement AppState through `DerefMut`.

| Identity | Meaning |
|---|---|
| Profile ID / path generation | Intended profile and lifecycle/path generation; captured operations must refuse a changed origin. |
| Runtime session revision | Changes on close/reopen/replacement, even for the same profile; not a financial revision. |
| SQLite `total_changes` / `data_version` | Local/external data-change signals, comparable only within the same session/connection. |
| Mobile revision / removal fence / epoch | Saved-copy compare-and-swap, forgetting/removal invalidation and authenticated desktop identity; separate from desktop counters. |

The synchronous request scope protects migrated commands that acquire the runtime
lock. It does not propagate automatically into async work, protect callers that
omit metadata, or replace authorization. See [transaction contract](TRANSACTION-DATA-CONTRACT.md),
[credential accounting](CREDENTIAL-ATTEMPTS.md) and [plaintext cleanup](PLAINTEXT-CLEANUP.md).
Protection covers the active database; retained exports/backups/external copies
require their own handling. Locking does not erase previously approved phone copies.

## Desktop and mobile trust

Desktop local runtime code uses Tauri IPC. Its CSP and source graph guard are
complementary; backend remote update/price requests have their own policies.
Fonts are bundled. [Network boundaries](RENDERER-NETWORK-BOUNDARIES.md) explain
what the guard covers and what it cannot prove. [Updater trust](UPDATE-TRUST.md)
distinguishes fixture-tested verification/staging from deferred production signing
and installer integration; manual release-page fallback remains the UI path.

Mobile requests intentionally use approved same-origin routes. Desktop service
authorization requires approved device/profile access and an active unlocked
requested profile; the phone cannot switch or unlock desktop profiles. HTTPS
certificate trust is a separate manual/device acceptance boundary. Saved browser
copies use authenticated encryption and non-extractable browser keys; this is
not a password lock against somebody with access to the unlocked browser.
Repository crypto preparation precedes atomic revision/fence commit; preserve
authenticated metadata order, epoch approval and removal guards. Revocation
blocks future downloads, not existing offline reads. See [mobile guide](../mobile/README.md).

## Migrations and shared UI

[schema initialization](../core/src/store/schema.rs) creates missing tables and
runs explicit idempotent column/data migrations, including historical sign/data
corrections with stored markers. There is no general numbered migration runner;
do not assume all changes are merely additive. Preserve old-profile fixtures.
[legacy migration](../src-tauri/src/legacy_migration.rs), journaled protection
conversion/rotation and [profile UI-state migration](../src/profileUiState.ts)
are distinct owners. Browser snapshot envelope/schema/viewer versions are checked
separately; an unsupported copy is not silently reinterpreted.

Use [Modal](../src/Modal.tsx), [MenuSelect](../src/MenuSelect.tsx),
[EditableCombobox](../src/EditableCombobox.tsx), [DateField](../src/DateField.tsx)
and [MonthField](../src/MonthField.tsx) with existing theme tokens. Default is
`transparent`; Futuristic/Retro are separate palettes, light/dark is independent.
Native calendar/file/print boundaries are documented in [native controls](NATIVE-CONTROLS.md).
Keep feature CSS scoped; verify real compiled geometry and keyboard/overlay behavior.

## Verification and maintenance

[BUILDING](BUILDING.md), [AGENTS](../AGENTS.md) and [E2E README](../e2e/README.md)
are the workflow entry points. Node logic/mocked contracts, jsdom component
lifecycle tests, Rust Store/runtime tests and compiled WebDriver UI/IPC tests
cover different layers. Use focused unit/lint, then a fresh Tauri CLI build,
smoke and affected specs for behavior changes. Run required full regression for
shared UI/persistence/harness or release scope. If Rust tests ran, build through
the Tauri CLI **afterward** before WebDriver; bare Cargo does not embed frontend
assets. On a fresh checkout, generate desktop/mobile assets with `npm run build`
before direct Rust checks. Mobile browser/HTTPS/platform acceptance is separate
from desktop E2E.

Keep transaction contracts and this guide synchronized as broader typed adapters,
freshness owners or performance work land. Backend ledger paging, repository-wide
contract adoption, production updater integration and final release acceptance
remain separate work; none is implied by this map.
