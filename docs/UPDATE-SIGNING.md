# Production update signing and activation

The signed-update flow embeds the production public key `release-2026` in
`src-tauri/update-keys.json`. The encrypted private key and its passphrase are
configured as secrets in the protected GitHub `release-signing` environment.
Publication and real installation acceptance must still complete before production
activation is considered finished. Older builds without this public key continue
to use the official release page for manual installation.

The implementation and production public key apply to version **1.3.1** on
`release-1.3.1` and subsequent releases. Pipeline validation, key setup, signing,
and release preparation do not authorize public publication. Obtain separate
owner approval for the prepared release before publishing it. The current manual
release workflows publish installers during packaging, before the signing review;
dispatch those publishing workflows only for an explicitly approved publication.
Use the Windows non-publishing diagnostic mode for pipeline validation.

## Prepare installers without publishing

Dispatch the existing `build-macos-check.yml` on `release-1.3.1` with
`prepare_signed=true` and the exact current commit as `source_sha`. It calls
`prepare-signed-installers.yml` from the same commit, allowing preparation without
adding a new dispatch workflow to `main`. The ordinary macOS check remains the
default when `prepare_signed` is false. Preparation rejects a different dispatch ref, moved branch commit,
or version mismatch. This separate workflow has only `contents: read`, creates no
tag or release, and omits all Tauri release inputs. Windows retains the complete
frontend, Rust, audit, smoke and full compiled desktop gates. macOS builds the
universal DMG after its unit, Rust and dependency gates.

The protected `release-signing` environment must allow the exact preparation
branch in addition to approved release tags. Preserve reviewer requirements and
disabled administrator bypass; remove a temporary branch allowance after the
preparation run finishes. Review both successful packaging jobs and their recorded
source SHA before approving signing. Environment review authorizes signing only;
this workflow has no publication step.

The signing jobs download same-run artifacts, compare installer hashes to packaging
outputs, check out the exact common build commit, sign the final bytes, and verify
with the embedded public key. The `signed-1.3.1-windows-x86_64` and
`signed-1.3.1-macos-universal` Actions artifacts retain installers, manifests,
signatures and verification provenance for 14 days. Download them to the external
QA evidence folder for durable review and isolated installation checks. Actions
artifacts require authenticated download; workflow logs in this public repository
are public, so no private credentials or financial data may appear in them.
These artifacts do not enable live update discovery until a separately approved
release is published.

The reusable caller explicitly passes the two signing secret names and the called
workflow declares them required. The protected environment supplies their values;
omitting that caller wiring causes GitHub to provide empty strings.

If packaging passes but signing fails, dispatch `build-macos-check.yml` with
`sign_prepared_run=<original run ID>`, `source_sha=<original build commit>`, and
`prepare_signed=false`. This read-only recovery verifies both original packaging
jobs, their required successful gates, the actual full Windows log, and the
packaging digests recorded in the original signing logs. The build commit must be
an ancestor of the current workflow commit; application or E2E changes require a
fresh build. Only the explicitly allowed preparation workflow/tooling/docs fixes
may differ. The protected top-level signing matrix then checks out the original
build SHA, downloads those exact run artifacts and verifies their recorded bytes
before signing. Signing recovery creates neither tags nor releases. Keep build
and signing-run provenance separately in the QA receipt.

## Generate and protect the key

Use Node 22 and PowerShell 7 on a trusted machine. Choose a **new directory outside
this repository**, under a location restricted to your Windows account. Its parent
must already exist. For example, using your own restricted custody directory:

```powershell
pwsh -File tools/New-UpdateSigningKey.ps1 -CustodyDirectory 'D:\PrivateKeys\vaultspend-release-2026' -KeyId 'release-2026'
```

The helper asks for and confirms a passphrase of at least 20 characters. It passes
the passphrase over stdin, never a process argument. The Node tool generates a new
Ed25519 key, stores it as encrypted PKCS#8 PEM using AES-256-CBC, and writes a public
registry alongside it. Existing directories/files are never overwritten. Windows
inherits the parent ACL; Node's Unix mode flags do not restrict Windows ACLs.
Keep the encrypted private PEM and its passphrase in separately controlled secure
storage with an offline recovery copy. Do not put either in source, issues, chat,
logs, shell history, or build artifacts. SecureString disposal reduces exposure but
does not promise that all managed/runtime memory copies are erased.

Review `update-public-keys.json` and promote **only that public file** to
`src-tauri/update-keys.json`. Commit the public registry with the updater code before
tagging a release. Keep package.json, src-tauri/Cargo.toml and tauri.conf.json
versions consistent with that new stable tag; branch names do not change versions.
A rebuilt app embeds that registry; a running old app cannot
learn new trust from release metadata. Never promote the disposable test seed/key.

## Configure GitHub before a production release

In `OneTrueAsian/vault-spend`, create/configure the **release-signing** environment:

- Restrict deployment tags to approved stable release tags and require an owner
  reviewer where the repository's GitHub plan supports it. Disable self approval
  when a second reviewer is available, and disable administrator bypass. The
  current sole-owner configuration allows owner self approval, requires review,
  disables administrator bypass, and permits only `v*` tags. Merely naming an environment in YAML
  does not establish these protections.
- Environment secret `UPDATE_SIGNING_PRIVATE_KEY`: the entire encrypted PEM.
- Environment secret `UPDATE_SIGNING_PASSWORD`: its passphrase.
- Environment variable `UPDATE_SIGNING_KEY_ID`: the ID in the embedded public file.

Use the GitHub settings UI or a trusted secret-entry workflow; do not paste values
into command arguments. Restrict repository/workflow write access and review any
change to signing code before allowing the environment. A malicious approved
workflow can read both secrets; encryption does not protect against compromised
signing-job execution. Account configuration requires the repository owner's access.

Both release workflows add a separate Linux signing job after platform packaging.
That job checks out the packaging job's exact commit SHA, downloads the final
published NSIS/MSI or DMG bytes, checks them against hashes recorded from Tauri's
local final artifacts in the packaging job, checks the private key against the
app's public registry, and signs exact
manifest bytes. Key/password environment variables exist only in the signing step;
the GitHub publication token is supplied in separate download/upload steps.
Private credentials are not passed in arguments or uploaded as artifacts. A moved
tag cannot select different signing code after packaging, and replaced release
assets fail the recorded size/hash comparison before signature creation.
Windows recovery mode skips this new signing job for old tags.

Outputs for each installer `NAME` are:

```text
NAME.manifest.json
NAME.signature.json
```

The envelope is `{ "format": 1, "keyId": "release-2026", "signature": "BASE64" }`.
The signature authenticates the exact original UTF-8 manifest bytes; whitespace
changes invalidate it. The workflow uploads metadata without `--clobber`. If
publication partially fails, inspect existing assets and resume only missing,
matching bytes; do not replace existing installers or signatures. A corrected build
should use a new version/tag. The local signer refuses output-directory reuse.

Platform jobs publish separately. A release can be visible before both platform
signing jobs finish, or remain visible after one fails. The client requires its
platform's complete, authentic metadata and installer; incomplete or mismatched
metadata fails closed and preserves the manual release link. Missing key/password,
wrong key, missing Windows installer, changed bytes or invalid filenames fail the
signing job. Build provenance comes from the same approved workflow, not an
independent reproducible-build authority.
This does not add Windows Authenticode, Apple code signing, or notarization; arrange
those before packaging if required, then sign the final installer bytes.

## User flow and acceptance

Native code owns the installed version, platform, trusted keys, exact repository
URLs, private staging paths and one-use installer tokens. The renderer supplies
only opaque operation handles/tokens. A newer signed offer enables download;
bounded streaming reports progress, then verifies size/SHA-256. Cancellation removes
partial/staged files. Explicit confirmation rehashes the file and consumes the token
before a native launcher opens it. The app remains open so the person can save work
and follow the installer instructions.

Windows launches the verified NSIS executable; the native launcher also supports
MSI. macOS opens the verified DMG in Finder, where the person completes installation.
There is no unattended replacement/restart or installer-completion guarantee.
Successful handoff retains the file because an OS process may still need it. Later
startup conservatively removes recognized staging directories older than 24 hours;
tokens expire after ten minutes and never survive app restart. Profile locking does
not disclose financial data: updater metadata/cache contain no financial records.
This does not defend against a compromised same-user OS account or arbitrary local
code replacing a file between verification and process launch.

Before calling production activation complete:

1. Generate/custody the key, promote its public registry, and configure the protected
   GitHub environment. Review and publish a new approved stable tag.
2. Confirm both platform jobs publish the expected final installer + manifest +
   signature. Independently verify signatures/hashes against the public registry.
3. On disposable Windows and macOS installations, manually bootstrap a build with
   the embedded public key, then accept a strictly newer signed release. Verify
   download/cancel/retry, confirmation, installer handoff and persisted app data.
4. Check offline, missing/partial metadata, tampering, expired tokens and restart
   fallback. Record actual OS installation acceptance separately from unit/E2E
   tests that intentionally never execute an installer.

## Rotation and compromise recovery

For planned rotation, first ship a bridge build trusting the old and new public
keys (unique IDs, at most eight keys). Continue signing bridge releases with the old
key so existing clients can install them. Once clients trust the new key, sign with
it, then ship a later build removing the old public key. Retain old-key custody only
as long as migration requires; never reuse IDs for different keys.

On compromise, stop signing/publication, revoke environment access and credentials,
remove compromised trust in a clean build, and distribute a reviewed replacement
through a separately verified manual channel. Existing offline/old clients still
trust their embedded old key and cannot be remotely guaranteed to reject it. The
version check prevents replay of older versions; it is not a trusted clock,
freshness guarantee, or protection against an attacker signing a higher version.

References: [Node cryptography](https://nodejs.org/api/crypto.html),
[GitHub environment configuration](https://docs.github.com/en/actions/how-tos/deploy/configure-and-manage-deployments/manage-environments),
[GitHub environment protections](https://docs.github.com/en/actions/concepts/workflows-and-actions/deployment-environments).
