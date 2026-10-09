# Budget and Reports aggregate reads

`get_budget_snapshot` and `get_report_range_snapshot` are version-1 desktop
contracts. `financial_snapshot.rs` holds the runtime guard, checks the requested
generation/session and reads each aggregate set in one Store read transaction.
The envelope carries the period and local/external SQLite revision. Money stays
an exact decimal string; nullable member fields must be explicitly present.

Budget returns category actuals, alerts, monthly cash flow and member attribution.
Reports Overview returns category/month cells, range cash flow and daily spending.
Existing Store inclusion rules remain authoritative. A cash-flow total need not
equal budgeted-category actuals: unbudgeted categories and income have different
roles. Split lines replace their parent for category attribution. Live transfers,
deleted rows and generated debt-payment twins retain the aggregate's exclusions.
Balance checkpoints alter balances without inventing spending.

`financialContracts.ts` validates the envelope and every nested row before
publication, including calendar dates, decimal strings, explicit nulls, matching
flow months and report bounds. Supported ranges are ordered and at most 1,200
months. Invalid payloads produce `invalid_response`; malformed backend ranges
produce `invalid_argument`. The profile-bound client preserves stable error
codes and refuses replies for a different origin. Disposal rejects in-flight
replies. Backend authorization is independent of these frontend checks.

`useFinancialRead` owns loading, error, prior data and an increasing request
sequence. Only the latest live request can publish. UI callers match the data
key to the current month/range. Initial or different-period failures hide totals;
same-period refresh failures retain last loaded figures with a persistent warning
and Retry. Range/month controls remain usable. Reads and writes are not
automatically retried. Accepted transaction revisions refresh active Budget,
Household budget attribution and Reports Overview consumers.

Household hides its budget section before a valid snapshot rather than implying
no budgeted spending. Budget suggestions have a separate read lifecycle: their
dialog remains usable independently of aggregate readiness, and late replies
after changing month or unmounting are discarded.

This is an incremental migration. Household's other models, Dashboard's other
widgets, Comparisons, async operations and legacy `get_report` (including the
CSV summary/export path) retain separate owners and contracts. Asset, holding
and other non-transaction invalidation is not a unified app-wide revision model.
Do not infer that every financial view is a single atomic snapshot.

The Budget envelope also fetches member attribution even when Budget is the
visible tab. That adds a member query compared with the former Budget-only
request set. This slice establishes coherent ownership; it does not claim a
Budget/Household latency improvement. Profile the new path before choosing
narrower projections or changing its shared-consumer contract.

## Verification boundaries

- Shared Rust/frontend fixture proves exact budget-line serialization beyond
  JavaScript's safe integer range, including explicit nullable member fields.
- Rust snapshot tests cover split attribution, delete/restore, linked transfer
  deletion/restore, generated payment exclusion and checkpoint invariants.
- Frontend contract/client/owner tests cover malformed replies, wrong period or
  profile, disposal, out-of-order requests, error retention and explicit Retry.
- Compiled feature 291 covers real IPC, query failure/recovery in a disposable
  database, hidden wrong-period totals, six palette/mode error-bar geometries,
  and profile switching with old-origin refusal. Owner concurrency is tested
  with controlled unit promises; this spec does not simulate every native race.

Validator schema entries are compiled once, avoiding per-row `Object.entries`
allocation. Targeted transaction reconciliation uses `transactionMerge.ts`,
preserves row order/references and signals a full-read fallback for new rows.
Synthetic timings isolate these stages and cannot certify end-to-end startup,
IPC responsiveness, memory consumption or the overall F performance target.
