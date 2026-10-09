# Update trust contract — first checkpoint

The desktop app checks release metadata in the backend and offers a fixed official
release-page link. It does not download or open installers. The legacy download
command and renderer permission to open temporary files have been removed.
Production signing keys and release publication are deferred by the owner.

## Backend transport and staging checkpoint

The live notification request uses a dedicated HTTPS-only client with a 10-second
connect timeout, 20-second total timeout, no proxy, no redirects, and a 256 KiB
actual metadata body limit. Its DNS resolver accepts only the exact GitHub hosts
and rejects private, loopback, link-local and selected special-purpose addresses
before connection. Proxy-only environments use the manual release page fallback.

The backend library also provides signed selection and staging primitives. They
are not registered as renderer commands or connected to an install button. An
authenticated manifest must match the release tag, unique exact asset name and
byte size. Its source must equal the fixed repository download URL. Asset redirects
accept only HTTPS port 443, no credentials/fragments, and the exact observed host
`release-assets.githubusercontent.com` under this repository's asset prefix
`/github-production-release-asset/1351742903/`. Three redirects and a 120-second
total timeout are the maximum; host changes fail closed and need a policy review.

October 8, 2026 HEAD-only checks of official v1.3.0 assets observed this redirect
and sizes of 8,938,636 bytes (NSIS), 14,688,256 bytes (MSI), and 26,326,075 bytes
(DMG). The streaming ceiling is 128 MiB, about five times the largest current
installer; signed byte size is enforced more tightly. The core format's 512 MiB
absolute ceiling remains, but this transport rejects manifests above 128 MiB.
Official API contract: [GitHub release assets](https://docs.github.com/en/rest/releases/assets).

Staging receives a backend-selected per-user app cache parent. Every session has
a cryptographically random directory; files use create-new semantics and opaque
256-bit tokens. Unix directories are restricted to 0700; Windows inherits the
per-user parent's ACL. Directory and file links/reparse points are rejected.
Mutable ownership serializes manager operations, and repeated staging of the same
version/target is rejected. Downloads enforce signed size while streaming and
hash files after completion. Cancellation and failures remove partial files.

Tokens are session-bound, expire after ten minutes, and are consumed once. The
library rehashes staged bytes immediately before its synchronous callback. This
callback is a verification/testing boundary, **not an implemented installer
launcher**: production integration must define installer handoff and file
retention before wiring an OS opener. Callback completion currently removes the
file. Local tampering by a compromised OS account, including races between
verification and a future opener, remains outside the protection guarantee.

Normal teardown removes known files. Restart cleanup only removes recognizable
staging directories older than 24 hours, uses non-recursive deletion, and retains
recent sessions, unknown entries and links. Startup cleanup, app-owned manager
storage, cancellation IPC and UI download/verification/install states remain to
be integrated. A hard crash can leave files until a later cleanup; tokens never
survive restart. Unit tests use inert loopback HTTP responses with no production
transport bypass, download command or opener permission.

## Verification foundation

`budget_core::update_manifest` verifies Ed25519 signatures using ring 0.17, already
present in the dependency graph. The backend supplies trusted public keys and key
IDs; a release response must never supply its own trusted key. Exactly one trusted
key must match the supplied ID. The app does not yet embed a production key or
connect this verifier to a downloader.

A detached signature authenticates the exact original UTF-8 JSON bytes, before
parsing. Publishers must retain those bytes without reserialization. Manifest
bytes are bounded to 16 KiB. Format 1 accepts only these fields:

| Field | Contract |
|---|---|
| `format` | Integer `1` |
| `repository` | `OneTrueAsian/vault-spend` |
| `version` | Three decimal components, no leading zeros or prerelease suffix; strictly newer than the installed version |
| `target` | Backend-selected `windows-x86_64` or `macos-universal` |
| `filename` | Exact version-bound packaging filename below |
| `size` | Positive installer byte count, at most 512 MiB |
| `sha256` | 64 lowercase hexadecimal characters |

Unknown and duplicate JSON fields are rejected. Accepted packaging names are
`Vault.Spend_{version}_x64-setup.exe`, `Vault.Spend_{version}_x64_en-US.msi`, and
`Vault.Spend_{version}_universal.dmg`, for their corresponding targets. No paths or
arbitrary filenames are accepted. The initial 512 MiB policy must be checked
against actual packaged artifacts before production integration. Version binds
the expected release tag `v{version}`; future transport must enforce that mapping.

Installer verification checks byte count and SHA-256. It must run on staged bytes
again immediately before any future open action. The current primitive takes
bounded bytes in memory; a future downloader needs streaming size enforcement and
staged-file hashing. `verify_installer` assumes its manifest came from
`verify_manifest`; never accept renderer-supplied manifest fields as trusted.

Tests sign inert fixtures with a disposable, public test seed. That seed is not a
production credential and must never become an embedded production trust anchor.
Compiled desktop regression checks reject the removed download command and the
renderer opener command without downloading or executing an installer.

## Remaining D/E sequence

1. Implement backend-selected HTTPS release transport, host/redirect validation,
   bounded streaming, private staging, cancellation, cleanup, and opaque tokens.
   Reject renderer-supplied URLs/paths and stale tokens. Keep installer opening
   disabled until the remaining authenticity requirements are ready.
2. Define the detached-signature envelope, embedded production key IDs, rotation
   and revocation policy, protected signing environment, access, backups, and
   compromise recovery. Private keys must stay outside source, arguments, and logs.
3. Sign final Windows and macOS artifacts after packaging/platform signing; publish
   their exact manifests and signatures. Test partial publication across separate
   workflows. Update signatures do not establish Authenticode or notarization.
4. Integrate verified staging and explicit install confirmation; revalidate staged
   content immediately before opening. Test replacement, retry, cancellation,
   restart, locked profiles, duplicate clicks, and token expiry in the compiled app.
5. Document manual bootstrap for older clients: removing the unsafe path protects
   only users who install this corrected build. This checkpoint has not been
   released and does not complete production signed-update support.
