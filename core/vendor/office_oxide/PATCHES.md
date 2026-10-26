# Maintained compatibility patch

Upstream: office_oxide 0.1.11, crates.io checksum 25caa1da7142070699529cfc8f276a739101c22ffccc572644d3c59278f19b56. Original license notices are retained.

Owner approved 24 October 2026 for release1.3.1: change only the normalized Cargo manifest ZIP requirement from8.6 to9.0, addressing RUSTSEC-2026-0367,0368 and0369. The initial manifest-only trial preserved all93 source files; see the required filename API adaptations below. No advisory exception is added.

Why: latest pdf_oxide0.3.78 does not compile against office_oxide0.1.12+ (DocumentIR gained defined_names). Office0.1.15 has ZIP9 but the incompatible API. Retain the PDF-compatible0.1.11 API while taking the maintained ZIP9 fixes.

Remove this patch and the direct compatibility pin when a published PDF release supports the maintained Office API. Validate PDF statement reading, full native regressions and target-specific security audits before removal. This local path is under core/ so its bytes are covered by the existing application build key.

The manifest-only trial failed to compile because ZIP9 name()/file_names() now return fallible Cow strings. The minimal compatibility patch also adapts five call sites in src/core/opc.rs and src/xlsx/mod.rs: skip invalid names in optional listing/presence scans; propagate filename errors during reads; take owned names for chart/font scans. No unwrap/panic is added.91of93 source files remain byte-identical to upstream. Normal Cargo integration tests in core/src/store/tests/office_zip_compatibility.rs cover exact/case/backslash/Unicode names, missing and malformed archives, chart/font scans and legacy CP437 filename fallback. The initial RED is a compile failure, not a failed behavior assertion.
