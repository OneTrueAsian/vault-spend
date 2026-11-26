---
name: release
description: Run full regression and publish a Vault Spend release
---

1. Confirm the branch is release-X.Y.Z and the tree is clean (stage only own files).
2. Run the unit, Rust (cargo test) and full E2E suites. Stop and report on any failure.
3. Build the pre-work tag if needed to prove whether failures pre-date this work.
4. Before tagging, write the version's entry in `src/shared/lib/changelog.ts` (New features, Enhancements, Bug fixes; only what users notice). The pipeline puts that entry on the release page through `tools/release-notes.mjs` and refuses a release whose version has no entry (VS-135), so the page and the app's What's New always agree.
5. Approve the Windows/macOS signing jobs and verify installer hashes.
6. Publish as Latest, merge the release branch into main, and push.
7. Transition the related Jira tickets to Done and list exactly what was verified.
