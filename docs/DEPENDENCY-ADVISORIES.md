# Dependency advisories

Status of `npm audit` findings, so a failing audit can be told apart from a new problem. Reviewed 2026-10-02.

## Shipped app

`npm audit --omit=dev` reports **0** advisories. Nothing below is part of the installed app.

## Development tools (accepted)

`npm audit` reports 10 high-severity entries. They all come from one chain in the desktop test tooling:

```
webdriverio 9 → @wdio/utils → @puppeteer/browsers → extract-zip
                                                  → proxy-agent → pac-proxy-agent → get-uri → basic-ftp
```

The 10 entries come from two underlying advisories:

| Package | Advisory | Why it does not reach this project |
|---|---|---|
| `extract-zip` | Path traversal and arbitrary file writes through crafted zip files | `@puppeteer/browsers` unzips browsers it downloads. The E2E suite never downloads a browser. It drives the installed WebView2 through `tauri-driver` and the local `msedgedriver` (see `e2e/README.md`). |
| `basic-ftp` | Slow (quadratic-time) parsing of crafted FTP server replies | It is only used for `ftp://` proxy auto-config URLs. The tests make no FTP or proxy connections. |

`npm audit fix` has applied every non-breaking update. The only remaining fix npm offers is a downgrade to WebdriverIO 8, which would be a step backwards. Revisit when WebdriverIO 9 ships a `@puppeteer/browsers` release without these packages. Rerun the full E2E suite after any WebdriverIO change.
