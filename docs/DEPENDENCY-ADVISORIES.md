# Dependency advisories

Use [Dependency security gates](DEPENDENCY-SECURITY.md) and
`tools/audit-dependencies.mjs` for the current policy and scan procedure.
Production and development npm findings block the gate; there is no standing
exception for desktop test tooling. A passing historical scan does not establish
the status of a later lockfile or advisory database.

The October 2, 2026 review recorded ten high-severity development entries through
WebDriverIO's browser-download dependency chain (`extract-zip` and `basic-ftp`).
That review is historical, not a current acceptance decision. The maintained
`@puppeteer/browsers` override in `package.json` subsequently removed that chain.
The browser-download contract and security policy have their own tests under
`tools/`; run the documented audits for each release target rather than relying
on the old count or downgrading WebDriverIO automatically.
