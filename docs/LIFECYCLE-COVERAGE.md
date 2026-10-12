# Lifecycle and cross-view coverage map (tasks O and R)

Which test layer covers each important transition. A row names files that exist; it does not claim
the case list in them is complete. "Not mapped" means nobody has checked it yet, not that it is untested.

## Freshness of views after a write (O)

`src/mutationFreshness.test.ts` scans every command the app calls. Each write command must be in exactly
one group: a financial mutation that advances the freshness epoch (`financialMutations`), a write whose
caller refreshes the shared snapshot, a presentation-only setting, or a change that remounts the profile.
A new write command fails that test until its group is chosen. The same test fails on a recorded command
the backend no longer has. The behaviour of each group is described in `TRANSACTION-DATA-CONTRACT.md`.

## Transitions (R)

| Transition | Rust | Unit (vitest) | Compiled (e2e) |
| --- | --- | --- | --- |
| Partial plaintext cleanup, leftovers | `protection_leftovers.rs` | `ProtectionLeftovers.test.tsx` | `feature105` |
| Mirror folder unreachable | `protection_leftovers.rs` (`unavailable_configured_mirror_fails_closed_before_any_deletion`) | — | `feature131`, `feature289` |
| Interrupted protection change or publication | `protection_transition` tests | — | `feature106`, `feature130`, `feature293` (unreadable journal) |
| Lock or switch while work is in flight | `OpenSession::replace` tests | `useTransactionData`, `useApplicationCalls` | `feature133`, `feature283`, `feature292` |
| Duplicate submission | — | `ProtectionLeftovers.test.tsx`, `ImportInboxDialog.test.tsx`, `TransferReviewDialog.test.tsx` | not mapped |
| Stale import preview | review token check in `commands/import.rs` | `importResolution.test.ts`, `ImportReviewDialog.test.tsx` | `feature162` |
| Refused profile switch or add | `profiles.rs` refusal codes | `profileIpc.test.ts` | `feature294` |
| Phone viewer removed while a snapshot refreshes | not mapped | not mapped | `feature172` (not checked for this case) |

## Cross-view money rules (R)

`core/src/store/tests/cross_view.rs` builds one August with payroll, purchases on the first and last day,
purchases on each neighbouring month's boundary day, a linked transfer pair, a split purchase, a loan payment
applied to a debt, and a deleted purchase. It requires the same expense total from the monthly totals, the
ranged totals, Reports' category breakdown, category-by-month table, daily heatmap and top merchants,
Comparisons' spending rows, and the Budget lines (with the drill-down list matching each line).
Not covered: the phone viewer's projection and income-side totals other than the monthly total.
