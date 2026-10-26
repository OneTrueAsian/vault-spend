# Shared credential attempt accounting

All renderer-supplied passwords/recovery keys enter `Sessions::check_password` or `check_recovery`:
unlock, verify-current-password, password rotation, recovery regeneration initiation, protection
removal, recovery verification/initiation/commit, existing encrypted-file/package import, and
protected backup restore. Setup completion's stored password and known newly-created passwords
are internal rechecks, not new guesses. Journaled lifecycle functions still verify their proof
again before writing, so callers cannot replace authorization with a renderer boolean.

Accounting is keyed on the validated key file's random `protection_id`. It remains stable across
copies, re-imports, backups and recovery-key regeneration, closing the old path-based import
escape. Independently protected profiles get independent identities. Password rotation creates
a new identity after a successful proof; prior credential checks have already reset the count.

The first three failed credentials have no delay; failure four imposes 2 seconds, failure five
5 seconds, and later failures 15 seconds. Counters saturate and remain in memory only. A correct
password or recovery key must wait for the same deadline; successful credential verification
resets failures. Malformed recovery keys count as failed credentials. File/schema/registry I/O
errors and rejected cooldown/concurrent requests do not count as additional failed guesses.

An RAII reservation prevents concurrent credential checks for the same identity from passing
the cooldown check together. It releases on completion, early return and panic; the bookkeeping
mutex is not held during Argon2. Other profiles remain available. Commands reject attempts with
an actionable retry message rather than sleeping or holding runtime/database locks during delay.
Protected restore also releases its runtime lock during credential verification and rechecks the
generation after acquiring the write lock. Rotation/removal likewise authenticate outside the
runtime lock, then recheck their captured generation before changing the live profile.

Multi-step flows count each supplied **incorrect** proof once. A successful preliminary proof
resets the count; a later correct internal recheck is not counted as another guess. Setup tokens
remain one-use, and the existing recovery challenge and generation checks still apply. This is
application endpoint hardening; it does not change the password KDF or offline-file threat model.
