# Building Vault Spend from source

Vault Spend is a Tauri v2 app: a React + TypeScript frontend (Vite) and a Rust backend. Its database engine is SQLCipher, which is compiled from source together with OpenSSL, so the first build takes several minutes (about 7 on a current Windows PC). After that it is cached in the build folder.

## What you need

- Node.js 20 or newer
- Rust (stable), through [rustup](https://rustup.rs)

**Windows**
- Visual Studio Build Tools with the "Desktop development with C++" workload, and the WebView2 runtime (already part of Windows 11).
- **Strawberry Perl**: `winget install StrawberryPerl.StrawberryPerl`. OpenSSL's build scripts need a real Windows Perl. Git's bundled Perl does not work, and neither does having no Perl. NASM is not needed.
- **Keep the build folder path short.** OpenSSL's Perl scripts cannot open files whose full path is over 260 characters, and fail with `Can't locate Text/Template.pm` even though the file exists. The repository itself is fine; a very deep worktree folder, or a deep `CARGO_TARGET_DIR`, is not.

**macOS**
- Xcode Command Line Tools: `xcode-select --install`. macOS's own `perl` and `make` are enough.
- For the universal (Intel + Apple Silicon) build: `rustup target add aarch64-apple-darwin x86_64-apple-darwin`.

## Build and test

```bash
npm install
npx tauri build --debug --no-bundle   # use this, not `cargo build`: the frontend is embedded by tauri
npm test                              # frontend unit tests
cargo test --workspace                # Rust tests
```

See `AGENTS.md` for which checks to run for which kind of change, and `e2e/README.md` before touching the end-to-end suite. A release build is `npx tauri build`.
