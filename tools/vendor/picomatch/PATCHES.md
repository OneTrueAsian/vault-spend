# Local picomatch security patch

Base: npm `picomatch@4.0.7`, MIT, https://github.com/micromatch/picomatch/tree/4.0.7.
Only `lib/parse.js` differs from the upstream executable sources. The local package
has a distinct name/version so its provenance is explicit, rather than pretending
to be an unpublished upstream release. Every consumer resolves through the root
`picomatch` file override; no install-time source rewriting is used.

Advisory: https://github.com/advisories/GHSA-fc5q-39xc-vjpf
(CVE-2026-112366). No patched npm release exists as of 17 November 2026.

The repeated-extglob analyzer missed single alternatives with an unbounded `*`,
such as `+(*)` and `+(*a)`. Those compile to ambiguous nested repetitions and can
stall the Node event loop on nonmatching strings. The patch detects unescaped
wildcards outside quoted strings/character classes, including inside nested
groups, and uses upstream's existing literal fallback for risky repeated
extglobs. Known safe character sequences retain upstream's flat character-class
rewrite. The recursion-depth option cannot disable the new wildcard guard.

Compatibility boundary: ambiguous repeated wildcard extglobs are treated as
literal text, just like upstream already treats other risky extglobs. Ordinary
globstars, braces, suffix globs, negated extglobs and literal alternatives retain
their behavior. Tests in `tools/picomatch-security.test.mjs` include bounded
subprocess exploit checks and representative Vite/Vitest/ESLint globs. Full
frontend tests/lint/build validate the actual consumers. This is a code fix,
not an audit exception; local packages are not registry-scanned, so the behavior
tests and reviewable upstream diff are required evidence. Replace this fork with
a verified patched upstream release when available.
