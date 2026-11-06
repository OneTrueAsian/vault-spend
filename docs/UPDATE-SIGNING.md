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
owner approval for the prepared release before publishing it. The Windows release workflow builds a draft and signs it without publishing; the macOS workflow adds
its files to that same draft and never publishes (see "macOS joins the Windows draft" below). The owner publishes the finished draft by hand.
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

## Windows releases are drafts (serial and sharded gate)

`release-windows.yml` never publishes. Whatever gate it uses, it builds the installers into a **draft** release for the tag, signs
that draft's exact bytes, and stops. The owner reviews the draft and publishes it by hand; nothing in this workflow does.
(`build-macos.yml` adds the macOS files to this same draft and never publishes either; see "macOS joins the Windows draft" below.)

**Choosing the gate.** `sharded` selects the gate and nothing else. Off (the default) is the serial gate in the `release` job. On, the
`sharded-gate` job runs preparation, six parallel shards and an aggregate, and `sharded-package` then `sharded-sign-updates` follow.
`test_release` is separate: it only turns on the restricted test behaviour below and needs `sharded`.

**Request shapes.** `sharded-request` accepts exactly three shapes and refuses everything else before any build starts:

1. A recovery diagnostic (`recovery` and `diagnostic_only`, from a workflow branch). It stops after the gate and never packages or signs.
2. A sharded release: a normal stable tag, dispatched **on that tag**, with `source_sha` equal to the tag commit, and no recovery,
   diagnostic or fault. Reserved test tags are refused.
3. A draft test release: `sharded` and `test_release` on a reserved test tag (v1.3.90 to v1.3.99), dispatched on that tag, with the
   same tag-commit rule. `fault` (`prepare` or `1` to `6`) exists only here and can only make the gate fail.

**What must happen before anything is packaged or signed.**

- `release-baseline` reads `releases/latest` once, before anything is built, and checks it with `tools/assert-draft-release.mjs`: the
  newest published release must be that tag, the new tag must be newer than it (unless recovering an older tag), no reserved test
  tag may be published, and the new tag must have no release yet or only an empty draft. Its result, `previous`, is passed to every
  later check, so a release published by someone else mid-run is noticed. Nothing is hard-coded to a version.
- The serial path: the baseline job must succeed, then the serial gate, then the same before/after draft checks around packaging.
  Diagnostics publish nothing and skip the baseline.
- The sharded path: preparation, all six shards and the aggregate must succeed. `sharded-package` then verifies the aggregate's
  summary with `tools/verify-sharded-gate-summary.mjs` (every spec ran once and passed, six shards, retries inside the gate-wide
  budget of 3, same source commit and run attempt) before it builds. A job status alone is not accepted. There is no `always()`,
  `cancelled()` or `failure()` on the packaging or signing jobs, so a failed, cancelled or skipped need stops them.
- Both signing jobs use the protected `release-signing` environment, so the owner's review is still required.

**Draft policy.** `releaseDraft` is always true; `prerelease` is true only for the test route. After every step that changes the release,
`assert-draft-release.mjs` requires exactly one release for the tag, still a draft, with `previous` still the newest published release,
so the stable updater (`releases/latest`) never sees it. A real release is not a prerelease; a test release is.

**No overwriting, and reruns.** No upload uses `--clobber`. Before packaging, the tag must have no release or only a draft with **no
files**; a draft that already holds files from an earlier attempt is refused, and signing's `gh release upload` fails on any existing
asset. To rerun after a failed attempt, the owner deletes the unpublished draft (the tag stays; tags are never moved) and dispatches
again on the same tag. A partially uploaded set of manifests is inspected by the owner and resumed only with matching bytes. Recovery
(an existing older tag) builds the same kind of draft and never signs.

**Test route notes.** Installation and update checks are not part of it, and Windows does not run macOS packaging; macOS can be added to the test draft by
a separate `build-macos.yml` run (below). Delete the draft and the test tag after review. `prepare-signed-installers.yml` is not migrated: it keeps its
serial path and a sharded diagnostic that cannot package or sign (it is also pinned to 1.3.1). Its later migration needs are in the backlog.

## macOS joins the Windows draft (`build-macos.yml`)

**Who owns what.** `release-windows.yml` owns the shared release: it validates the tag, reads the newest published release, creates the
draft and signs the Windows files. `build-macos.yml` only **joins** that draft. Neither workflow publishes; the owner reviews the whole draft
(Windows and macOS files together) and publishes it by hand. No workflow creates a public release, un-drafts one, or deletes anything.

**Order for one tag.** Windows draft complete (both installers, manifests and signatures, after the `release-signing` approval) -> run
`build-macos.yml` for the same tag -> macOS signing approval -> owner review -> owner publishes. The order is enforced, not just advised:
the first macOS step that touches the release (`tools/assert-macos-release.mjs --stage before`, before the long macOS build) refuses unless
exactly one release exists for the tag and, when it is a draft, it already holds the complete signed Windows set and no macOS file. With no
release macOS stops and creates nothing, so it cannot race the Windows workflow into a second release. Windows' own check
(`assert-draft-release.mjs --stage before`) refuses a draft that already holds files, so the reverse order is refused there as well.

**What the action does.** The packaging step is `tauri-apps/tauri-action` pinned to the commit `v0` pointed at (v0.6.2,
`84b9d35b5fc46c1e45415bdb6144030364f7ebc5`), whose source was read for this policy: with `releaseDraft: false` it looks the release up with
`getReleaseByTag`, which cannot see a draft, so it would have created a **second, public** release for a tag whose Windows draft existed
(and `releases/latest` would have pointed at it). With `releaseId` set it uploads straight to that release and does not look up, create,
publish or change draft/prerelease flags; it replaces a same-named file, which the check above rules out for a draft. The workflow passes
the id found by the check, keeps `releaseDraft: true`, and gives no `releaseName`, so the action could not create a release even with an empty id.

**Checks around every change.** After packaging and around the signing upload, `assert-macos-release.mjs --stage packaged|signed` requires
the same release id in the same state (still a draft), exactly Windows' files plus the expected macOS files (the DMG, its manifest and signature,
and the unversioned `Vault.Spend_universal.app.tar.gz` archive that tauri-action also uploads, as it did for v1.3.1 and v1.3.2; any other file is
refused), and that the newest published release is still the one read at the start. Before the build, a draft must also have been created
from the same commit this macOS run checked out (the release's recorded target), so one release cannot mix sources. That archive has no
manifest or signature of its own (unchanged from earlier releases). The signing job keeps the protected `release-signing`
environment and signs the exact bytes whose digests the build recorded; manifests are uploaded without `--clobber`. The tag, the checked-out
commit and the version in `package.json`, `tauri.conf.json` and `Cargo.toml` are checked before anything is built.

**Routes.** A normal stable tag joins a draft that is **not** a prerelease. A reserved test tag (v1.3.90 to v1.3.99) joins only a draft that **is** a
prerelease (the sharded test release); a published reserved-tag release is always refused. Before this change macOS refused reserved tags
outright; it is now allowed there only so the macOS path can be proven against a test draft without a real release.

**Reruns.** A release that was already published when the run starts (the local Release Tool publishes first, then dispatches macOS) still
receives the macOS files it lacks; nothing is created or hidden. Owner decision (6 November 2026): a macOS file that is already there is never
replaced, in a draft or in a published release (tauri-action would silently replace a same-named file, and the manifest upload already fails on an
existing one). A failed macOS attempt that left a file in the draft is rerun by deleting that unpublished macOS file by hand; the Windows files
are never touched.
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
