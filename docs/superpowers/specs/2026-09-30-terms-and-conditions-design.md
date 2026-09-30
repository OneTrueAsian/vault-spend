# Legal notice: design

Status: built on branch `terms-and-conditions` (cut from `release-1.2.9`). The text is in [`docs/LEGAL-NOTICE.md`](../../LEGAL-NOTICE.md) and is the source of truth for wording. It replaces the earlier draft `docs/TERMS.txt`, which was an accept/decline click-through.

This is not legal advice. A lawyer should review `docs/LEGAL-NOTICE.md` before anyone relies on it.

## Goal

Show Vault Spend users a legal notice the first time the app opens (and again once per new version), remember on this computer that they have seen it, and let them re-read it from Help. The notice must describe what the app really does.

## Decisions

| Topic | Decision |
|---|---|
| Form | A notice, not a contract. One "OK, I've read this" button. No accept/decline, no installer page. (Section 19 of the notice says it is not a click-through contract; the earlier accept/decline gate contradicted that.) |
| Provider named | "The Vault Spend project", its maintainers, contributors and copyright holders. MIT line reads OneTrueAsian, as in `LICENSE`. |
| Governing law | Michigan, with no forum-selection clause and an explicit carve-out for rights that cannot be waived (section 20). |
| Re-show | Once per new notice version, with a "What changed" line for anyone who acknowledged an older version. Users upgrading from 1.2.8 see it once. |
| Contact | GitHub Issues. |

## Findings that shape the notice

The app is not fully offline. `index.html` loads typefaces from Google Fonts on every start; `src/UpdateBanner.tsx` checks `api.github.com` once per start; live prices (opt-in) call Alpha Vantage, Finnhub, StockData.org or Twelve Data. Three texts understated this and were corrected with the feature: the Help FAQ "Is my data private?", `README.md`, and `docs/READ BEFORE INSTALLING.txt`.

## Design

1. **Document.** `docs/LEGAL-NOTICE.md`, bundled with Vite's `?raw`. `src/legalNotice.ts` parses its small Markdown subset: `**Version:**` and `**What changed:**` header lines, the `## SUMMARY` section, and everything after `# FULL NOTICE`. A missing header or section throws, so a malformed file fails a test. `bundledLegalNotice` is parsed once at load. The version is a date string compared for equality.
2. **Remembering.** `DeviceSettings` (`device-settings.json`, per computer, readable before any profile opens) gains `legal_notice_version` and `legal_notice_acknowledged_at`, both `#[serde(default)]`, so older files load unchanged. Two commands: `get_legal_notice_acknowledgement` and `acknowledge_legal_notice(version)`; the backend stamps the time.
3. **Gate.** `LegalNoticeGate` wraps `StartupGate` in `main.tsx`, so it appears before the profile picker and any lock screen. It renders nothing while the read is pending, the app untouched when the version matches, and otherwise the notice: summary, a collapsed full text, and one button. If the read fails it lets the app through; if the save fails it shows the reason and the button becomes "Continue anyway". Nothing can keep someone out of the app.
4. **Help.** `LegalNoticeHelp` adds a searchable entry ("Where can I read the legal notice?") with the version, "Acknowledged on <date>" (or which older version was acknowledged), and the full text.
5. **Test harness.** The harness sets `VAULTSPEND_SKIP_LEGAL_NOTICE=1` for every launch; `launchApp({ showLegalNotice: true })` opts back in. The backend honours it only when `VAULTSPEND_DB_DIR` is also set, which a real install never sets (`legal_notice_skipped`).

## Tests

- Rust: settings round trip and older-file defaults, replacement by a newer acknowledgement, the skip applying only with `VAULTSPEND_DB_DIR`.
- Vitest: `legalNotice` (parsing, each failure, CRLF, the real file, the three network hosts named), `LegalNoticeGate` (all states above), `LegalNoticeHelp`, and two `HelpView` tests.
- E2E `feature139_legal_notice.mjs`: first launch, acknowledge, relaunch skips it, Help shows the date, an older acknowledged version shows it again with "What changed".

## Out of scope

Lawyer review, translations, per-profile acknowledgement, attaching the notice to each GitHub release, version bump and changelog (done when a release is requested), self-hosting the fonts (would let a later notice version drop section 2a).

## Open questions

None blocking. The notice refers to a `CONTRIBUTING.md` that does not exist yet ("may be provided"), which is accurate as written.
