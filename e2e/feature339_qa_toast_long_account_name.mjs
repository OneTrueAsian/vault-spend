// QA-UI-008: the message "Rolled forward this month's starting balance for N accounts: <names>." must stay on screen when an account has a very long, unbroken name.
// Found by looking at a retained screenshot, not by an earlier geometry check. Checked at 1280/960/720.
import assert from "node:assert/strict";
import { launchApp, waitUntilOrDiagnose } from "./harness.mjs";
import { seedFixture } from "./lib/seed.mjs";

const TOKEN = "QA" + "Unbroken".repeat(10);
const dbDir = await seedFixture(`
cur.execute("INSERT INTO accounts(name,account_type,starting_balance) VALUES('${TOKEN}','checking','10.00')")
`);
const app = await launchApp({ dbDir });
const b = app.browser;
const read = () => b.execute(() => {
  const p = [...document.querySelectorAll('.toast-stack .status')].find(x => x.textContent.includes('Rolled forward'));
  if (!p) return null;
  const box = p.getBoundingClientRect(), lines = [];
  const r = document.createRange(); r.selectNodeContents(p.querySelector('.status-text'));
  for (const x of r.getClientRects()) lines.push({ left: x.left, right: x.right });
  return { box: { left: box.left, right: box.right }, lines, viewport: document.documentElement.clientWidth };
});
try {
  for (const width of [1280, 960, 720]) {
    await b.setWindowSize(width, 900);
    await waitUntilOrDiagnose(b, async () => !!(await read()), { timeout: 10000, timeoutMsg: `${width}px: the roll-forward message is showing` });
    const { box, lines, viewport } = await read();
    assert.ok(lines.length > 0);
    for (const line of lines) assert.ok(line.left >= box.left - 1 && line.right <= box.right + 1 && line.right <= viewport, `${width}px: the long name stays inside the message ${JSON.stringify({ line, box, viewport })}`);
  }
  console.log('FEATURE 339 PASSED: the roll-forward message keeps a long unbroken account name inside itself at 1280/960/720.');
} finally { await app.close(); }
