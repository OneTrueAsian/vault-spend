// E2E test: dialogs and toasts stay inside the window under every visual
// style, however far the page is scrolled.
//
// The Transparent style gave `.page` a `backdrop-filter`, and a filtered
// ancestor becomes the containing block of its `position: fixed` descendants —
// so a dialog or toast rendered inside `.page` was laid out against the whole
// (tall) page instead of the window: the Ctrl+K palette showed only its top
// quarter at the bottom edge of the screen, and "Saved …" toasts landed
// off-screen. Dialogs and the toast stack are now rendered at the body level.
//
// Run with: node e2e/feature83_overlays_stay_in_view.mjs

import { launchApp } from "./harness.mjs";
import { seedFixture } from "./lib/seed.mjs";

const dbDir = await seedFixture(`
import datetime
today = datetime.date.today()
cur.execute("INSERT INTO accounts (name, account_type, starting_balance) VALUES ('Everyday Checking', 'checking', '5000.00')")
acct = cur.lastrowid
for i in range(70):
    d = (today - datetime.timedelta(days=i % 28)).isoformat()
    desc = f"Store {i}"
    cur.execute("INSERT INTO transactions (account_id, date, description, amount, category, category_source, fingerprint) VALUES (?,?,?,?,?,?,?)",
                (acct, d, desc, f"-{10 + i}.00", "Groceries", "user", f"{acct}|{d}|{desc.lower()}|{i}"))
`);

const app = await launchApp({ dbDir });
const { browser } = app;

async function selectTheme(label) {
  await browser.execute((text) => {
    const row = Array.from(document.querySelectorAll(".feature-toggle-row")).find((r) => r.textContent.includes(text));
    if (!row) throw new Error(`no .feature-toggle-row containing "${text}"`);
    row.querySelector("input").click();
  }, label);
}
async function goTo(label) {
  // (`nav button*=text` is unreliable in wdio — see explore.mjs — so match the label ourselves.)
  for (const b of await browser.$$("nav button")) {
    if ((await b.getText()).trim() === label) {
      await b.click();
      await browser.pause(700);
      return;
    }
  }
  throw new Error(`no nav button "${label}"`);
}
async function scrollMain(y) {
  await browser.execute((top) => {
    const m = document.querySelector(".main");
    if (m) m.scrollTop = top;
  }, y);
  await browser.pause(250);
}
/** Where the topmost dialog panel / the toast stack sit, in window coordinates. */
async function boxes() {
  return browser.execute(() => {
    const rect = (el) => {
      if (!el) return null;
      const r = el.getBoundingClientRect();
      return { top: Math.round(r.top), bottom: Math.round(r.bottom), height: Math.round(r.height) };
    };
    return {
      vh: window.innerHeight,
      overlay: rect(document.querySelector(".modal-overlay")),
      panel: rect(document.querySelector(".modal-panel")),
      toast: rect(document.querySelector(".toast-stack .status")),
    };
  });
}
function assertOnScreen(where, what, box, vh) {
  if (!box) throw new Error(`${where}: no ${what} found`);
  if (box.top < 0 || box.bottom > vh) {
    throw new Error(`${where}: the ${what} sits at ${box.top}–${box.bottom}px in a ${vh}px-tall window`);
  }
}

try {
  await browser.setWindowSize(1280, 720);
  await browser.pause(1000);

  for (const style of ["Slate", "Futuristic", "Transparent"]) {
    await goTo("Settings");
    await selectTheme(style);
    await browser.pause(400);

    // ---- a dialog, opened from a long, scrolled page ----------------------
    await goTo("Transactions");
    await scrollMain(900);
    await browser.execute(() => document.activeElement instanceof HTMLElement && document.activeElement.blur());
    await browser.keys(["Control", "k"]);
    await (await browser.$(".modal-panel")).waitForExist({ timeout: 5000 });
    await browser.pause(500);
    const palette = await boxes();
    assertOnScreen(`${style}: Ctrl+K palette`, "palette", palette.panel, palette.vh);
    if (Math.abs(palette.overlay.height - palette.vh) > 2) {
      throw new Error(`${style}: the dialog backdrop is ${palette.overlay.height}px tall in a ${palette.vh}px window — it should cover exactly the window`);
    }
    const middle = (palette.panel.top + palette.panel.bottom) / 2;
    if (Math.abs(middle - palette.vh / 2) > 60) {
      throw new Error(`${style}: the palette is centred at ${Math.round(middle)}px, not near the window's middle (${palette.vh / 2}px)`);
    }
    await browser.keys("Escape");
    await browser.pause(300);

    // ---- a form dialog from a button ---------------------------------------
    await (await browser.$("button*=Add transaction")).click();
    await (await browser.$(".modal-panel")).waitForExist({ timeout: 5000 });
    await browser.pause(500);
    const add = await boxes();
    assertOnScreen(`${style}: Add transaction`, "dialog", add.panel, add.vh);
    await browser.keys("Escape");
    await browser.pause(300);

    // ---- a toast, from the tall Settings page ------------------------------
    await goTo("Settings");
    const backUp = await browser.$("button=Back up now");
    await backUp.scrollIntoView({ block: "center" });
    await backUp.click();
    await (await browser.$(".toast-stack .status")).waitForExist({ timeout: 10000 });
    await browser.pause(300);
    const toast = await boxes();
    assertOnScreen(`${style}: "Back up now" toast`, "toast", toast.toast, toast.vh);
    console.log(`${style}: palette ${palette.panel.top}–${palette.panel.bottom}, dialog ${add.panel.top}–${add.panel.bottom}, toast ${toast.toast.top}–${toast.toast.bottom} of ${toast.vh}px — OK`);
  }

  console.log("FEATURE 83 E2E TEST PASSED");
} finally {
  await app.close?.();
}
