---
name: release
description: Run full regression and publish a Vault Spend release
---

1. Confirm the branch is release-X.Y.Z and the tree is clean (stage only own files).
2. Run the unit, Rust (cargo test) and full E2E suites. Stop and report on any failure.
3. Build the pre-work tag if needed to prove whether failures pre-date this work.
4. Approve the Windows/macOS signing jobs, verify installer hashes, and draft the release notes and changelog.
5. Publish as Latest, merge the release branch into main, and push.
6. Transition the related Jira tickets to Done and list exactly what was verified.
