# Dependency security gates

Development and CI require Node **22.19 or later**. WebDriverIO 9.32.0 preserves the suite's executeAsync API. Its browser-download dependency is explicitly overridden to maintained
@puppeteer/browsers 3.2.4, which requires Node 22 and removes extract-zip/basic-ftp. The used public
install/resolve/path/platform APIs are checked with a disposable download/extraction fixture and
the full compiled suite. WebDriverIO 10 was evaluated and excluded because it removes executeAsync. The system
Node installation is not changed by the implementation session: local validation used isolated
Node 22.20.0. Run `npm ci` under a supported runtime.

Install `cargo-audit` with `cargo install cargo-audit --version 0.23.0 --locked`, then run:

```text
node --test tools/dependency-security-policy.test.mjs
node --test tools/browser-download-contract.test.mjs
node tools/audit-dependencies.mjs x86_64-pc-windows-msvc
node tools/audit-dependencies.mjs aarch64-apple-darwin
node tools/audit-dependencies.mjs x86_64-apple-darwin
```

The tool writes JSON scan results, scanner versions, advisory database revision, the resolved
target tree and the policy decision under `dependency-audit` (override with
`VAULTSPEND_AUDIT_OUTPUT`). npm production **and development** findings block the gate. Rust
vulnerabilities and reachable unsoundness block it. Missing scanner, failed database refresh,
invalid JSON or failed target inventory also block it. Maintenance notices remain visible in the
artifact and console. Windows publication, macOS publication and macOS validation run the same
gate before building/publishing; they retain audit artifacts even after failure.

The browser contract downloads only an inert ZIP from a disposable loopback HTTP fixture, checks
the pinned version/path/cache APIs, and explicitly exercises the optional yauzl parser's rejection
of an escaping symlink. The downloader normally tries the platform archive utility first; the
fallback parser test does not assert equivalent rejection behavior for every native utility. No
fixture executable is launched. Node 22 and the explicit yauzl development dependency support the
maintained fallback. Production application HTTPS checks remain separate compiled tests.

`RUSTSEC-2026-0235` (`rkyv 0.7.46`, an optional resolution through rust_decimal) was waived by a dated
exception until `rust_decimal` 1.43.0 removed it from Cargo.lock on 2026-10-12. No advisory is waived
now. An exception in `tools/dependency-security-policy.mjs` must name the exact advisory, package,
version and target, carry an owner, rationale and expiry, and can never permit a reachable dependency
or a later scan after expiry. glib's unsoundness notice
is retained as a non-reachable platform finding; any reachable use blocks the gate. This does not
extend support or acceptance to Linux.

glib 0.18.5 (RUSTSEC-2024-0429, GHSA-wrw7-89jp-8q8g, fixed in 0.20.0) comes only from Tauri's Linux GTK
stack. On 2026-11-21 no upgrade was available: the newest tauri 2.12.7, wry 0.57.3, tao 0.37.3 and muda
0.21.2 all still require gtk 0.18, and wry pins webkit2gtk =2.0.2 (webkit2gtk 3.0.0 is on glib 0.22). With
the owner's approval, Dependabot alert #1 was dismissed as "vulnerable code is not actually used" on that
date (VS-69). Revisit it if Linux support is added or a Tauri release moves to glib 0.20 or later.

The direct rustls-pemfile dependency was removed. Certificate/key PEM parsing now uses
`rustls::pki_types::pem::PemObject` with the existing certificate integrity, key-match, bootstrap and
HTTPS tests. Transitive maintenance findings are recorded separately rather than silently ignored.

The statement reader reads PDF text with `pdf_oxide` (MIT OR Apache-2.0, default features, which add its
`image`, layout and XML helper crates; none of its OCR or machine-learning features are enabled). Its
`office_oxide` dependency is pinned to `=0.1.11` in `core/Cargo.toml` because `pdf_oxide` 0.3.78 does not
compile against 0.1.12 or later; remove the pin once `pdf_oxide` catches up. The one maintenance notice it
added is `ttf-parser` (RUSTSEC-2026-0192, unmaintained), reached through font handling; it stays visible in
the audit output like the other maintenance notices and is not an exception.

Sources verified on 2026-10-09:

- [RustSec TLS advisory and patched version](https://rustsec.org/advisories/RUSTSEC-2026-0285.html)
- [WebDriverIO releases](https://github.com/webdriverio/webdriverio/releases)
- [Maintained PEM API](https://docs.rs/rustls-pki-types/latest/rustls_pki_types/pem/trait.PemObject.html)
