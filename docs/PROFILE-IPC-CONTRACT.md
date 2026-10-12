# Startup and protection IPC contract

Startup, protection, profile CRUD and profile UI-state code route 44 desktop commands through `profileIpc.ts`.
Command names, camelCase arguments and inferred return types have one feature
boundary. `profileContracts.ts` validates unknown native responses before callers
use them. These adapters do not replace backend authorization or lifecycle guards.

## Wire compatibility

The existing startup wire is discriminated by `status`: `open`, `selector`,
`locked`, `empty_registry`, or `error`. Required nested fields are checked;
additive fields are compatible and unknown variants are refused. Selector entries
require unique nonempty IDs, names, nullable icon keys and protection booleans.
`last_used_id` remains nullable. No new envelope/version or persisted schema is
introduced in this slice.

All five Rust launch refusal kinds are covered, including
`protection_journal_unreadable`. The frontend-only `startup_failed` kind handles
bridge/validation failures. An unreadable protection journal shows a named error
heading, Retry and Quit; unrelated locate/new-file/new-list actions are not offered.
Existing registry-recovery actions remain tied to their original kind and flag.

Protection challenges require a nonempty token, seven groups of four recovery
symbols, and two distinct integer group indices from 0 through 6. Returned recovery
keys use the same display-shape check. This is shape validation: recovery checksums,
password proofs, attempt accounting, setup-token consumption and encryption remain
backend responsibilities. No production keys are used in contract fixtures.

Cleanup inventory validates nonempty paths, the three known leftover kinds and
nonnegative safe-integer byte counts. Refused deletion paths remain a string array;
partial refusal is not rewritten as complete success. Void replies accept native
`null` and bridge/test `undefined`; other values are refused. An invalid reply to a
write does not prove the write failed or rolled back, so writes are never retried
automatically.

## Errors and state events

`ProfileIpcError.code` is separate from its display message. Malformed responses
use `invalid_response` with a fixed message; rejected payloads, passwords, recovery
keys and tokens are not interpolated into that error. Structured native error
objects preserve their machine code independently of wording. Existing profile
commands still return legacy human-readable strings; they are explicitly classified
as `legacy_error`, not guessed into domain codes from prose. Migrating their native
domain refusals to structured DTOs remains separate task N work.

`StartupGate` validates `profile-lock-state-changed` event payloads too. A malformed
event unmounts the financial UI and shows the startup failure screen. It counts as
a newer broadcast, so an older in-flight initial/open result cannot override it.
A later valid event can recover the gate. Invalid command rechecks also fail closed;
an ordinary transport failure keeps the existing open-result behavior. This UI
validation neither locks the native session nor makes a renderer event authoritative
authorization. Native financial commands still enforce the runtime's actual state.

## Evidence and remaining boundaries

`core/tests/fixtures/profile_ipc.json` is shared by actual Rust serialization and
frontend validators. It covers every native startup status/refusal, nullable paths,
selector icons/protection flags, challenge indices and all cleanup kinds. Values
are inert test fixtures. Controlled frontend tests cover malformed/nested replies,
write nonretry, stable structured error identity and event/fetch races.

Compiled feature293 uses the actual adapters for native startup/challenge/cancel
replies, real Tauri delivery of crafted malformed events, recovery from valid
events, and a truly malformed on-disk conversion journal. Existing full desktop
protection/recovery/cleanup specs cover ordinary user paths.

Eight more commands use the same adapter: `create_profile`, `rename_profile`,
`delete_profile` (selector, empty-registry and locked-profile screens),
`get_current_generation`, `get_profile_ui_state`, `set_profile_ui_state`,
`mark_ui_state_migrated` and `is_ui_state_migrated` (`profileUiState.ts`). Replies
are runtime-validated (non-empty confirmation text, non-negative integer generation,
text-or-null state, boolean flag, unit). Their native refusals are still plain
strings, so they surface as `legacy_error` rather than a guessed domain code.

Auto-lock settings (`get_auto_lock_settings`, `set_auto_lock_settings`,
`record_trusted_activity`) use the adapter too; the settings reply must hold one of
the allowed minute values and four booleans.

`create_profile`, `rename_profile`, `delete_profile`, `switch_profile` and
`add_existing_profile` refuse with a structured `{ code, message }` (Rust
`ProfileRefusal`). Codes: `duplicate_profile_name`, `profile_in_use`,
`profile_already_registered`, `profile_not_found`, `data_file_missing`,
`profile_changed` (the active profile moved on before an add finished), `file_not_found`,
`wrong_password` (matched against the shared `WRONG_PASSWORD` constant, never against copied
wording), `stale_profile` (only from the runtime's `STALE_PROFILE:` marker), and the generic
`profile_operation_failed` for any other failure, which keeps its text and is never
classified from its wording. Callers branch on `ProfileIpcError.code`; the message may be
reworded.

`switch_profile`, `add_existing_profile`, `set_profile_icon`, `path_looks_password_protected`,
`list_profiles` (unique ids, five-field entries), `get_background_settings`,
`set_tray_enabled` and `set_autostart_enabled` all run through the adapter with runtime
validation of their replies.

Other legacy feature commands (transactions, accounts, budgets, reports and so on) are
outside this migration. The prior App/transaction/financial contracts remain separate
owners.
