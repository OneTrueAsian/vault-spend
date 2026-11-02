# Update trust contract

The desktop app checks release metadata in the backend and offers a fixed official
release-page link. Its native signed-update service can verify, download and open
an installer after explicit confirmation. The legacy arbitrary download command
and renderer permission to open temporary files remain removed. The public trust
registry embeds the `release-2026` public key. Its presence alone does not certify
key custody, successful release publication or real installation acceptance. See
[key custody, CI setup and activation](UPDATE-SIGNING.md).

## Backend transport and staging checkpoint

The live notification request uses a dedicated HTTPS-only client with a 10-second
connect timeout, 20-second total timeout, no proxy, no redirects, and a 256 KiB
actual metadata body limit. Its DNS resolver accepts only the exact GitHub hosts
and rejects private, loopback, link-local and selected special-purpose addresses
before connection. Proxy-only environments use the manual release page fallback.

The backend provides signed selection and staging behind opaque-handle commands. An
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
library rehashes staged bytes immediately before native installer handoff. Failed
handoff removes the file; successful handoff retains it for the OS process. The
older synchronous testing callback still removes its file on completion. Local
tampering by a compromised OS account, including races between verification and
process launch, remains outside the protection guarantee.

Normal teardown removes known files. Restart cleanup only removes recognizable
staging directories older than 24 hours, uses non-recursive deletion, and retains
recent sessions, unknown entries and links. Startup cleanup, app-owned manager
storage, cancellation IPC and UI download/verification/confirmation states are
integrated. A hard crash can leave files until a later cleanup; tokens never
survive restart. Unit tests use inert loopback HTTP responses with no production
transport bypass or renderer path-opener permission.

## Verification foundation

`budget_core::update_manifest` verifies Ed25519 signatures using ring 0.17, already
present in the dependency graph. The backend supplies trusted public keys and key
IDs; a release response must never supply its own trusted key. Exactly one trusted
key must match the supplied ID. The app embeds `src-tauri/update-keys.json` and
connects the verifier to its downloader, while an empty key list disables offers.

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
arbitrary filenames are accepted. The stricter transport/signer limit is 128 MiB.
Version binds the expected release tag `v{version}` and transport enforces it.

Installer verification checks byte count and SHA-256. It must run on staged bytes
again immediately before opening. The downloader enforces signed size while
streaming and hashes staged files. `verify_installer` assumes its manifest came from
`verify_manifest`; never accept renderer-supplied manifest fields as trusted.

Tests sign inert fixtures with a disposable, public test seed. That seed is not a
production credential and must never become an embedded production trust anchor.
Compiled desktop regression checks reject the removed download command and the
renderer opener command without downloading or executing an installer.

## Production activation remaining

1. Verify custody of the production key matching the embedded public registry and
   the protected signing environment using UPDATE-SIGNING.md. Keep private key
   material outside source; public-key presence does not establish those controls.
2. Publish a new approved release with complete metadata for both platforms. Check
   real final-byte signatures and partial-publication recovery. Update signatures
   do not establish Authenticode or notarization.
3. Accept a real newer signed download and installation on disposable Windows and
   macOS systems. Automated fixtures exercise verification without launching real
   installers; these checks cannot establish OS installer success.
4. Bootstrap older clients manually with the corrected, public-key-bearing build.
   Existing clients cannot obtain new trust safely from untrusted release metadata.
