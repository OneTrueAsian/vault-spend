// @vitest-environment jsdom
import { afterEach, describe, expect, it } from "vitest";
import { chooseProfileFromMenu } from "./profileMenu.mjs";

// A fake page over the jsdom document: the toggle is a real button, and the profile options only appear on its `opensOnClick`-th click
// (Infinity = never). `present: false` leaves the toggle out of the page.
function fakeBrowser({ opensOnClick, present = true }) {
  document.body.innerHTML = "";
  const state = { toggleClicks: 0, chosen: [] };
  if (present) {
    const toggle = document.createElement("button");
    toggle.className = "profile-switcher-toggle";
    toggle.addEventListener("click", () => {
      state.toggleClicks++;
      if (state.toggleClicks === opensOnClick) {
        for (const name of ["Household", "Work"]) {
          const option = document.createElement("button");
          option.className = "profile-switcher-option";
          option.textContent = name;
          option.addEventListener("click", () => state.chosen.push(name));
          document.body.append(option);
        }
      }
    });
    document.body.append(toggle);
  }
  const browser = {
    state,
    $: selector => ({
      element: document.querySelector(selector),
      isExisting: async () => document.querySelector(selector) !== null,
      waitForExist: async ({ timeoutMsg }) => { if (!document.querySelector(selector)) throw new Error(timeoutMsg); },
    }),
    // Like WebDriver, hand the page the element a $() result stands for.
    execute: async (fn, ...args) => fn(...args.map(arg => arg?.element ?? arg)),
    waitUntil: async (condition, { timeoutMsg }) => {
      for (let i = 0; i < 20; i++) if (await condition()) return true;
      throw new Error(timeoutMsg);
    },
  };
  return browser;
}

afterEach(() => { document.body.innerHTML = ""; });

describe("chooseProfileFromMenu", () => {
  it("opens the list with one click and chooses the named profile once", async () => {
    const b = fakeBrowser({ opensOnClick: 1 });
    await chooseProfileFromMenu(b, "Work");
    expect(b.state.toggleClicks).toBe(1);
    expect(b.state.chosen).toEqual(["Work"]);
  });

  it("clicks again after a missed click until the list is open", async () => {
    const b = fakeBrowser({ opensOnClick: 3 });
    await chooseProfileFromMenu(b, "Household");
    expect(b.state.toggleClicks).toBe(3);
    expect(b.state.chosen).toEqual(["Household"]);
  });

  it("does not click the toggle when the list is already open, so an open menu is never closed", async () => {
    const b = fakeBrowser({ opensOnClick: 1 });
    document.querySelector(".profile-switcher-toggle").click();
    b.state.toggleClicks = 0;
    await chooseProfileFromMenu(b, "Work");
    expect(b.state.toggleClicks).toBe(0);
    expect(b.state.chosen).toEqual(["Work"]);
  });

  it("fails with the list message when the list never opens", async () => {
    const b = fakeBrowser({ opensOnClick: Infinity });
    await expect(chooseProfileFromMenu(b, "Work")).rejects.toThrow("the profile list should open before an option is chosen");
    expect(b.state.chosen).toEqual([]);
  });

  it("fails with the button message, without clicking, when the toggle is not on the page", async () => {
    const b = fakeBrowser({ opensOnClick: 1, present: false });
    await expect(chooseProfileFromMenu(b, "Work")).rejects.toThrow("the profile menu button should be on the page");
    expect(b.state.toggleClicks).toBe(0);
  });
});