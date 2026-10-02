// A long profile name must wrap inside its card on the profile selector — never spill into the
// neighbouring card or under its lock badge. Found by looking at the Phase D UAT screenshots: names
// like "D5 Forgot password (remove)" ran across the next card in every look, because the name sits
// inside a <button> and the global button rule is `white-space: nowrap`. No jsdom test can see this
// (no layout there), so this measures real geometry in the compiled app, in all three palettes since
// their fonts differ.
//
// The lock badge is display-only until a profile is opened, so one registry entry is marked protected
// directly in profiles.json; nothing here ever opens it.
// Run with: node e2e/run-all.mjs --spec=120

import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import { launchApp } from "./harness.mjs";
import { seedProfiles } from "./lib/protection.mjs";

const NAMES = ["Household Budget 2026", "Alexandria & Jordan Family Finances", "D5 Forgot password (remove)", "Short"];
const dbDir = await seedProfiles(NAMES.map((name) => ({ name })));
const registryPath = path.join(dbDir, "profiles.json");
const registry = JSON.parse(fs.readFileSync(registryPath, "utf8"));
registry.profiles[1].protection = { format: 1 };
registry.profiles[1].former_plaintext_path = null;
fs.writeFileSync(registryPath, JSON.stringify(registry));

const app = await launchApp({ dbDir, ready: "[data-profile-selector]" });
try {
  const { browser } = app;
  await browser.setWindowSize(1440, 1000);
  await browser.$("[data-profile-card]").waitForExist({ timeout: 10000 });

  for (const palette of ["transparent", "futuristic"]) {
    await browser.execute((p) => {
      document.documentElement.dataset.palette = p;
    }, palette);
    await browser.pause(300);
    const report = await browser.execute(() => {
      const box = (el) => {
        const r = el.getBoundingClientRect();
        return { left: r.left, right: r.right, top: r.top, bottom: r.bottom };
      };
      const cards = [...document.querySelectorAll("[data-profile-card]")].map((card) => {
        const cardBox = box(card);
        const name = card.querySelector(".profile-card-name");
        const parts = name ? [name, ...name.querySelectorAll("span")] : [];
        return {
          text: name?.textContent.trim(),
          card: cardBox,
          name: name ? box(name) : null,
          // Anything sticking out past the card's own edges, however small.
          spill: parts.map(box).filter((b) => b.left < cardBox.left - 0.5 || b.right > cardBox.right + 0.5).length,
        };
      });
      const overlaps = [];
      for (let i = 0; i < cards.length; i++) {
        for (let j = i + 1; j < cards.length; j++) {
          const a = cards[i].name;
          const b = cards[j].name;
          if (!a || !b) continue;
          if (a.left < b.right && b.left < a.right && a.top < b.bottom && b.top < a.bottom) overlaps.push([cards[i].text, cards[j].text]);
        }
      }
      return { cards: cards.map(({ text, spill }) => ({ text, spill })), overlaps };
    });

    assert.equal(report.cards.length, NAMES.length, `${palette}: expected every profile to be listed`);
    const spilling = report.cards.filter((c) => c.spill > 0).map((c) => c.text);
    assert.deepEqual(spilling, [], `${palette}: these names spill outside their card: ${JSON.stringify(spilling)}`);
    assert.deepEqual(report.overlaps, [], `${palette}: these names overlap a neighbour: ${JSON.stringify(report.overlaps)}`);
  }

  // The lock badge is still there and still beside the (now wrapped) name.
  const locked = await browser.$$('[data-profile-option] [aria-label="Password protected"]');
  assert.equal(locked.length, 1, "exactly the one profile marked protected should show a lock badge");
} finally {
  await app.close();
}

console.log("FEATURE 120 E2E TEST PASSED");
