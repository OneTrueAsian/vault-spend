# Vault Spend

*Own your Data, Own your Money!*

A local, private budgeting and transaction ledger for Windows and macOS.
There's no service account, no cloud synchronization, and no subscription —
your main data lives in files on your own computer, in independent profiles you
can each password-protect. Vault Spend reaches out to the internet for a check
on GitHub for a newer version and live investment prices if you set up a price
provider. Its typefaces are bundled locally. Neither service receives your
financial ledger. The full
[legal notice](docs/LEGAL-NOTICE.md) covers these, estimates, backups and
recovery codes.

Vault Spend is an independent open-source project and is not affiliated
with, endorsed by, or partnered with any external financial services or
wallet providers.

## Installing

1. Run the installer you were given (`Vault Spend_x.x.x_x64-setup.exe`, or
   the `.msi` if you were sent that instead).
2. Windows may show a **"Windows protected your PC"** SmartScreen warning —
   that's because the installer isn't signed with a certificate Microsoft
   already recognizes, not a sign anything is wrong. Click **"More info"**,
   then **"Run anyway."**
3. Launch Vault Spend from the Start Menu. It starts completely empty — no
   sample data, nothing pre-loaded — ready for your own accounts and
   transactions.

On macOS, open the `.dmg` and drag Vault Spend into Applications. The build
isn't signed, so macOS asks you to approve the first launch (System Settings →
Privacy & Security → **Open Anyway**).

**Upgrading?** Your existing data opens exactly as before, unprotected, and
nothing is protected unless you turn it on.

## Features

- **Dashboard** — net worth, cash, debt, and investments at a glance, then a
  To do list of what needs you, an insights feed, a layout you can customize
  from its Layout menu, and a natural-language "Ask the Vault" query box.
- **Accounts** — checking, savings, credit card, loan, investment, and
  other account types, plus property & valuables, each with balance
  history and statement reconciliation.
- **Transactions** — every transaction, with categorization, tagging,
  splitting, notes and transfers from each row's ⋯ menu, bulk editing, and
  family-member attribution. Adding one by hand uses a Money out / Money in
  switch (Charge / Payment on cards and loans) instead of a minus sign.
- **Budget** — monthly budgets per category, typed straight into each row,
  with rollover, a month-end review, and suggested amounts from your recent
  spending.
- **Goals** — savings goals with target dates, optional auto-contributions,
  and progress tracking.
- **Cash Flow** — income/expense trends, a 30/60/90-day balance forecast,
  and a debt payoff planner.
- **Recurring** — your regular bills and income, with automatic
  missed/price-change detection and auto-suggested new items.
- **Investments** — holdings with gain/loss, optional live pricing, and
  accumulation/withdrawal projections.
- **Household** — spending and net worth broken down by family member.
- **Reports** — customizable date-range reports with charts, exportable
  to CSV or PDF.
- **Password protection & automatic locking** — optional, per profile:
  encrypted data, backups, and exports, with a required recovery key and
  automatic locking on idle, tray-hide, or system lock/sleep.
- **Backups & profiles** — automatic daily backups (with an optional
  second backup location) and multiple independent, switchable profiles.
- **Import & export** — CSV/OFX/QIF import with duplicate detection, plus
  bulk setup-data import/export for getting started quickly.
- **Appearance** — Light, Dark or System (at the bottom of the sidebar or in
  Settings → Appearance) and three styles, Default, Futuristic and Retro,
  each shown as a picture. Below 1000 pixels wide the sidebar shows icons,
  with a Show names button.

## Mobile snapshots

On the computer, open **Settings → Mobile snapshots → Set up a phone**. The guide explains the local QR connection, one-time certificate installation and trust, and desktop approval of the phone's profiles. Keep both devices on the same private home network. No online account, domain service, financial cloud storage or relay is used.

The phone browser shows a read-only saved copy: Overview, Accounts, Budget, Reports and Calculators, without a full transaction list or individual holdings. Wait for **Ready offline**, then check reopening in the same browser or home-screen shortcut without Wi-Fi. The saved timestamp tells you how current the copy is. Refresh requires Vault Spend running with that profile active and unlocked; the phone cannot switch or unlock desktop profiles. Away from the desktop, it shows its last saved copy.

The public certificate must be verified against the computer before trusting it. If actual-file fingerprint inspection is unavailable on the phone, use the guide's public-certificate export and a trusted direct transfer. A name or fingerprint shown by the untrusted download page is not proof. Never bypass a certificate warning. The temporary HTTP setup page serves only a public certificate and instructions, not finances or pairing credentials. Initial certificate trust remains a manual phone Settings action.

Guided setup uses an installation-specific `.local` name and a fixed port. A private address change on the same selected interface can retain the browser origin; local discovery still depends on the network. Changing the name/port or migrating an old IP URL creates a separate browser location, requiring pairing and another download. Home-screen storage can also be separate from a browser tab. No DHCP reservation is needed for the guided path on a compatible network; the advanced IP path requires a stable address.

Access is remembered. An unlocked phone can read saved copies. Browser storage cleanup/private browsing can lose copies, so reconnect and save again when needed. **Disable mobile access** stops connections; **Revoke phone** or **Remove profile access** blocks future downloads. They cannot erase existing offline data. **Forget this phone** removes the phone's saved data/keys and remembered intent; while offline, also revoke it on the desktop. Remove this installation's certificate separately in phone Settings when finished. Desktop locking or a password change does not erase approved saved copies.

Support evidence is version-specific. The owner confirmed pairing and functionality on an iPhone 16 Pro using Google Chrome, including all saved data loading in airplane mode with Wi-Fi off. OS/browser versions, tab versus home-screen mode, Android and wider router/macOS acceptance remain separate checks. Do not treat automated desktop browser tests as all-phone support. See Help for the on-screen instructions and `mobile/README.md` for the implementation/testing boundaries.

## Learn more

For source development, start with the [architecture and invariants guide](docs/ARCHITECTURE.md)
and [build instructions](docs/BUILDING.md).

Open the **Help** tab inside the app for full guidance on every feature
above, a searchable FAQ, and troubleshooting. The **?** beside any page's
title opens Help at that page's own section.
