# Plaintext cleanup after protection

Protecting a profile encrypts its active database. It does not erase retained
originals, old backups, exports, external copies or cloud history. Setup and
Settings disclose this distinction. Cleanup is explicit and user controlled;
there is no secure-erasure or all-copy-detection guarantee.

## Inventory and UI

The warning depends on all discovered copies, independently of which copies
are selected for deletion. Mirror copies remain disclosed when the mirror
checkbox is unchecked and after local copies are removed. Keep for now hides
the current mounted view only; returning to Settings or restarting checks
again.

Missing local originals or a local backup directory are normal. A configured
mirror that cannot be inspected is an unknown state, not an empty inventory.
Inspection failures display an error and Retry, and disable deletion. Partial
deletion failures remain visible even if a subsequent inventory check fails.
Previously known counts are labelled as such.

Discovery and deletion capture the active profile ID and runtime generation.
The renderer ignores late results after profile replacement or generation
change and reserves deletion synchronously against duplicate submissions.
The backend requires both origin values and holds the open runtime guard
through validation and file operations. Strict registry lookup refuses stale
profile/path identity and unreadable registry state.

## Deletion boundary

The backend derives a fresh inventory before deleting anything. Candidates
must be recognized retained originals or strictly named app backups, regular
non-symlink files with a plaintext SQLite header and no protection key file.
The live database and its canonical aliases are excluded. Every requested
path must still belong to this inventory, and each candidate is reinspected
immediately before a single-file unlink. Files that gained a key, changed
content, disappeared or are no longer recognized are refused or reported as
failures. There is no recursive directory deletion.

This bounds app-driven cleanup; it does not promise atomic filesystem
protection against a separate malicious process rewriting paths between
inspection and unlink. Unrecognized, encrypted or non-SQLite files are
preserved rather than assumed safe to delete.

## Coverage

ProtectionLeftovers tests cover mirror-only disclosure, local deletion,
discovery/retry, partial failures, duplicate clicks and stale profile or
generation results. Rust tests cover unavailable mirrors, strict registry
identity, paired keys, changed candidates and active database aliases.
Compiled feature289 covers real protection, mirror-only cleanup, error/retry,
remount/restart, stale request refusal and preservation of the encrypted
database/key pair. Its geometry checks span three palettes, light/dark and
two widths for warning and error states. Feature105 retains the original
cleanup behavior regression.
