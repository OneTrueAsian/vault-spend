# Terms and Conditions: design

Status: draft for owner review. Branch `terms-and-conditions` (cut from `release-1.2.9` at `180de16`). The terms text itself is in [`docs/TERMS.txt`](../../TERMS.txt) and is the source of truth for wording.

## Goal

Show Vault Spend users a set of terms and conditions the first time the app opens, let them accept or decline, remember the choice on this computer, and let them read the terms again from Help. The terms must describe what the app really does.

This is not legal advice. A lawyer should review `docs/TERMS.txt` before anyone relies on it.

## Decisions (from the owner's answers, 2026-09-30)

| Topic | Decision |
|---|---|
| Acceptance | First-launch screen, plus a Help page entry to re-read. No installer page. |
| Provider named | "The Vault Spend project and its contributors". No legal entity. MIT copyright line reads OneTrueAsian, as in `LICENSE`. |
| Pricing | Free and open source. |
| Governing law | State of Michigan, USA; state or federal courts located in Michigan. |
| Disputes | Courts only. No arbitration, no informal-resolution step. |
| Minimum age | Not stated. |
| Contact | GitHub Issues, `https://github.com/OneTrueAsian/vault-spend/issues`. |
| Disclaimers ("estimates, not advice") | Investment projections; debt payoff planning; balances, budgets and reports. Not auto-categorization. |
| Risk topics | Lost password means lost data; backups are the user's job; unsigned installer; third-party price providers. |
| Extra topics | Imported files and shared packages; no affiliation with banks or brokers; open-source license and contributions; changes and ending. |
| Style | Plain-English summary first, then the full terms. Privacy is a section inside the terms. |
| On decline | The user keeps using the app. The notice says they do so at their own risk, with no warranty and no responsibility for loss, and that the MIT License's no-warranty terms apply either way. |
| Re-ask | Once per new terms version, with a short "what changed" note. A decline is remembered and is not re-asked until the version changes. |
| Existing users | Users upgrading from 1.2.8 see the screen once. |

Wording note: the owner first asked for the text to say that declining "absolves me of any wrong doing". The agreed wording instead says the user proceeds at their own risk and the MIT no-warranty terms apply either way, because a refusal is not a legal waiver. The owner approved that wording. Lawyer review should confirm it.

## Findings that shape the terms

The app is not fully offline. Reading the code for the privacy section found:

1. `index.html` loads typefaces from `fonts.googleapis.com` / `fonts.gstatic.com` on every start.
2. `src/UpdateBanner.tsx` calls `api.github.com/repos/.../releases/latest` once per start, and downloads the installer from GitHub if the user clicks update.
3. Live prices (opt-in, user's own key) call Alpha Vantage, Finnhub, StockData.org or Twelve Data, sending the tracked symbols and the key. No transaction, balance or profile data is sent.

Three places currently understate this, so the terms would contradict them:

- `docs/READ BEFORE INSTALLING.txt` says "nothing is ever sent anywhere else".
- `README.md` says the app "only reaches out to the internet for two things" (update check, live prices).
- The Help FAQ "Is my data private?" in `src/HelpView.tsx` says "The only network requests Vault Spend makes are" the update check and live prices.

All three leave out the Google Fonts request. The terms describe all three requests truthfully, and these texts need matching edits (see "Follow-ups").

## Design

### 1. The document

- `docs/TERMS.txt`, plain text, bundled into the frontend with Vite's `?raw` import, the same way `docs/THIRD-PARTY-NOTICES.txt` already is in `HelpView.tsx`.
- Header lines, parsed by the frontend:
  - `Version: YYYY-MM-DD` is the terms version id, compared as a plain string.
  - `What changed: ...` is the one-line note shown when a returning user sees a new version.
- A `=== SUMMARY ===` line and a `=== FULL TERMS ===` line split the file into the plain-English summary and the full text. A small pure function `parseTerms(raw)` returns `{ version, whatChanged, summary, full }` and throws if a header or delimiter is missing, so a malformed file fails a test, not a user.
- The same file is shipped in the repo and attached to each GitHub release (release runbook gains one line).

### 2. Remembering the choice

`DeviceSettings` (`src-tauri/src/device_settings.rs`, stored in `device-settings.json`, per computer, readable before any profile opens or unlocks) gains three fields, each `#[serde(default)]`:

- `terms_version: Option<String>` is the version the user last decided on.
- `terms_decision: Option<TermsDecision>` where `TermsDecision` is `Accepted | Declined`.
- `terms_decided_at: Option<String>` is an RFC 3339 timestamp.

Older settings files without these fields load unchanged (the existing `deny_unknown_fields` only applies to the nested reminder structs, and the top-level struct already uses `#[serde(default)]`). Nothing about a profile is stored here.

Two Tauri commands, in `commands.rs`, both working through the existing `DeviceSettingsStore`:

- `get_terms_decision() -> { version: Option<String>, decision: Option<"accepted"|"declined">, decided_at: Option<String> }`
- `record_terms_decision(version: String, decision: "accepted"|"declined") -> ()`. It stamps the time itself, so the frontend cannot back-date a decision.

### 3. The first-launch screen

- New `src/TermsGate.tsx`, wrapped around `StartupGate` in `src/main.tsx`:
  `TermsGate > StartupGate > App`. It therefore appears before the profile picker and before any lock screen.
- On mount it calls `get_terms_decision`. While that call is pending it renders nothing (no flash of the app). If the call fails it lets the app through and does not block on a settings-read error.
- If the stored version equals the bundled version, it renders its children untouched.
- Otherwise it renders a full-window screen: summary on top, the full terms in a scrollable region below, and two buttons, "I agree" and "Decline".
  - If there is a stored version that differs, it also shows the `What changed` line.
  - **I agree** calls `record_terms_decision(version, "accepted")`, then renders the children.
  - **Decline** shows the at-your-own-risk notice (the wording in `TERMS.txt` section 9), calls `record_terms_decision(version, "declined")`, then renders the children after the user dismisses the notice with a "Continue" button.
  - If recording fails, it shows an inline error and still offers to continue for this session. It does not trap the user.
- Styling reuses the app's existing tokens (all three theme styles, light and dark), like `LaunchErrorScreen`.

### 4. Re-reading later

- A Help page entry, searchable, placed next to "Third-party notices" in `src/HelpView.tsx`. Tags include "terms", "conditions", "privacy", "legal", "license".
- It shows the version, the full text (summary included), and "On this computer: Accepted on <date>" or "Declined on <date>".
- A button, "Review and decide again", re-opens the same accept/decline flow from Help.

### 5. Test harness

The e2e suite launches the compiled app with `VAULTSPEND_DB_DIR` set to a throwaway directory. Every spec would now stop at the terms screen.

- The backend honours a new environment variable, `VAULTSPEND_SKIP_TERMS=1`, **only when `VAULTSPEND_DB_DIR` is also set** (the existing test-only switch). It makes `get_terms_decision` report the bundled version as accepted without writing anything.
- `e2e/harness.mjs` sets it by default. A new spec opts out to exercise the real screen.
- A real install never sets `VAULTSPEND_DB_DIR`, so the skip cannot apply to users.

### 6. Testing (test-first)

- **Rust:** `DeviceSettings` round trip with the new fields; a settings file with none of them loads with all `None`; `record_terms_decision` stamps a time and overwrites an earlier decision; the skip variable applies only with `VAULTSPEND_DB_DIR`.
- **Vitest:** `parseTerms` (good file, missing header, missing delimiter, real `docs/TERMS.txt` parses); `TermsGate` states: pending shows nothing, matching version shows children, first launch shows the screen, accept records and continues, decline shows the notice then continues, changed version shows the "what changed" line, a failing read lets the app through, a failing write does not trap the user.
- **E2E (new `feature139_terms_gate.mjs`):** fresh start shows the screen and not the app; Decline then Continue reaches the app; relaunch on the same data directory does not show it again; the Help entry shows "Declined"; "Review and decide again" then "I agree" shows "Accepted".
- Full gate before any release: `tsc`, `vitest`, `cargo test --workspace`, clippy, full e2e.

## Out of scope

- Lawyer review, translations, per-profile acceptance, age checks.
- Version bump, changelog entry, release notes (done when a release is requested).
- Self-hosting the typefaces (see follow-ups).

## Follow-ups to decide separately

1. **Correct the three statements above** (`READ BEFORE INSTALLING.txt`, `README.md`, the Help FAQ) to match the terms, with a pointer to the terms. The Help FAQ is user-visible app text, so this ships with the feature; the two docs are plain text edits. Doing this before the terms ship avoids the app contradicting itself.
2. **Self-host the fonts.** It would remove the Google Fonts request and make "no network on start except the update check" true, at the cost of shipping font files. Optional.
3. **Lawyer review** of `docs/TERMS.txt`, especially sections 9 (limit of liability, decline wording) and 11 (governing law).

## Open questions

None blocking. The terms text is a draft for the owner's review.
