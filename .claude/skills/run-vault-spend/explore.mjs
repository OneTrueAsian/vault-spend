// Ad-hoc driver for poking at the real compiled Vault Spend app from the
// command line, on top of e2e/harness.mjs (the same launcher the 30+
// e2e/feature*.mjs specs use). Use this for one-off exploration/screenshots
// without writing a throwaway spec file; use e2e/harness.mjs directly (see
// an existing e2e/feature*.mjs for the pattern) for anything that grows past
// a few steps or needs assertions.
//
// Usage:
//   node .claude/skills/run-vault-spend/explore.mjs [--db <dir>] <command> [<args...>] [<command> [<args...>] ...]
//
// Commands (each consumes the next N argv entries as its args):
//   nav <label>              click the sidebar nav button with this exact text
//   click <css>              click the first element matching a plain CSS selector
//   fill <css> <value>       setValue on the first element matching a CSS selector
//   text <css>               print that element's trimmed text
//   html <css>               print that element's outerHTML (first 2000 chars)
//   eval <js>                run `js` in the webview via execute(), print the JSON result
//   wait <ms>                pause
//   screenshot <path>        save a PNG to `path` (relative to cwd, or absolute)
//
// --db <dir>: reuse a specific SQLite dir across invocations instead of a
// fresh throwaway one each time (e.g. one seeded via e2e/lib/seed.mjs) so
// state persists between separate `node explore.mjs ...` calls. Without it,
// every invocation starts from a brand-new empty database — real, but empty
// (see e2e/lib/seed.mjs to seed one first).
//
// Example:
//   node .claude/skills/run-vault-spend/explore.mjs nav Budget screenshot out.png
//
// Gotcha this script exists partly to paper over: webdriverio's `tag*=text`
// / `tag=text` shorthand selectors only match a BARE "tag*=text" pattern —
// combined with a descendant combinator ("nav button*=Budget") they fall
// through and get sent to tauri-driver as literal (invalid) CSS, which
// errors as "invalid selector". `nav <label>` below works around this by
// listing all `nav button`s and filtering by exact text instead.

import { launchApp } from "../../../e2e/harness.mjs";

function parseCommands(argv) {
  const ARITY = { nav: 1, click: 1, fill: 2, text: 1, html: 1, eval: 1, wait: 1, screenshot: 1 };
  const commands = [];
  for (let i = 0; i < argv.length; i++) {
    const verb = argv[i];
    const arity = ARITY[verb];
    if (arity === undefined) throw new Error(`Unknown command "${verb}". Known: ${Object.keys(ARITY).join(", ")}`);
    const args = argv.slice(i + 1, i + 1 + arity);
    if (args.length < arity) throw new Error(`"${verb}" needs ${arity} arg(s), got ${args.length}`);
    commands.push([verb, args]);
    i += arity;
  }
  return commands;
}

async function run() {
  const argv = process.argv.slice(2);
  let dbDir;
  let rest = argv;
  if (argv[0] === "--db") {
    dbDir = argv[1];
    rest = argv.slice(2);
  }
  const commands = parseCommands(rest);
  if (commands.length === 0) {
    console.error("No commands given. See the header comment in this file for usage.");
    process.exit(1);
  }

  const app = await launchApp(dbDir ? { dbDir } : {});
  const { browser } = app;
  try {
    for (const [verb, args] of commands) {
      switch (verb) {
        case "nav": {
          const [label] = args;
          const navButtons = await browser.$$("nav button");
          let match;
          for (const b of navButtons) {
            if ((await b.getText()).trim() === label) { match = b; break; }
          }
          if (!match) {
            const labels = [];
            for (const b of navButtons) labels.push((await b.getText()).trim());
            throw new Error(`No nav button labeled "${label}". Available: ${labels.join(", ")}`);
          }
          await match.click();
          console.log(`nav -> ${label}`);
          break;
        }
        case "click": {
          const [css] = args;
          await browser.$(css).click();
          console.log(`click ${css}`);
          break;
        }
        case "fill": {
          const [css, value] = args;
          await browser.$(css).setValue(value);
          console.log(`fill ${css} = ${JSON.stringify(value)}`);
          break;
        }
        case "text": {
          const [css] = args;
          console.log(await browser.$(css).getText());
          break;
        }
        case "html": {
          const [css] = args;
          const html = await browser.$(css).getHTML();
          console.log(html.slice(0, 2000));
          break;
        }
        case "eval": {
          const [js] = args;
          const result = await browser.execute(new Function(`return (${js});`));
          console.log(JSON.stringify(result, null, 2));
          break;
        }
        case "wait": {
          const [ms] = args;
          await browser.pause(Number(ms));
          break;
        }
        case "screenshot": {
          const [outPath] = args;
          await browser.saveScreenshot(outPath);
          console.log(`screenshot -> ${outPath}`);
          break;
        }
      }
    }
  } finally {
    await app.close();
  }
}

run().catch((e) => {
  console.error(e.stack || e);
  process.exit(1);
});
