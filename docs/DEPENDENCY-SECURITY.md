# Dependency security gates

Development and CI require Node **22.19 or later**. WebDriverIO 9.32.0 preserves the suite's executeAsync API. Its browser-download dependency is explicitly overridden to maintained
@puppeteer/browsers 3.2.4, which requires Node 22 and removes extract-zip/basic-ftp. The used public
install/resolve/path/platform APIs are checked with a disposable download/extraction fixture and
the full compiled suite. WebDriverIO 10 was evaluated and excluded because it removes executeAsync. The system
Node installation is not changed by the implementation session: local validation used isolated
Node 22.20.0. Run `npm ci` under a supported runtime.

Install `cargo-audit` with `cargo install cargo-audit --locked`, then run:

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

`RUSTSEC-2026-0235` remains an optional `rkyv 0.7.46` resolution in Cargo.lock through rust_decimal.
It is not enabled in any supported target tree. The exact advisory/package/version/target exception
in `tools/dependency-security-policy.mjs` expires **2026-11-08**, owned by Vault Spend maintainers.
It cannot permit a reachable dependency, a new advisory/version, or a later scan after expiry.
Remove it when the parent resolution is fixed; reassess it before expiry. glib's unsoundness notice
is retained as a non-reachable platform finding; any reachable use blocks the gate. This does not
extend support or acceptance to Linux.

The direct rustls-pemfile dependency was removed. Certificate/key PEM parsing now uses
`rustls::pki_types::pem::PemObject` with the existing certificate integrity, key-match, bootstrap and
HTTPS tests. Transitive maintenance findings are recorded separately rather than silently ignored.

Sources verified on 2026-10-09:

- [RustSec TLS advisory and patched version](https://rustsec.org/advisories/RUSTSEC-2026-0285.html)
- [WebDriverIO releases](https://github.com/webdriverio/webdriverio/releases)
- [Maintained PEM API](https://docs.rs/rustls-pki-types/latest/rustls_pki_types/pem/trait.PemObject.html)
