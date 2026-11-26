// Choosing Light or Dark in the sidebar. A single click on the mode button can be missed on a hosted runner, which left spec 266 waiting for a theme
// that never changed. This clicks once, always, then again only while the page has not taken the theme.
import { waitUntilOrDiagnose } from "../harness.mjs";
import { actUntil } from "./actUntil.mjs";

export async function chooseModeUntil(browser, chooseMode, label, theme) {
  await actUntil(browser, {
    label: `choose ${label} in the sidebar`,
    actFirst: true,
    done: async () => (await browser.execute(() => document.documentElement.dataset.theme)) === theme,
    act: () => chooseMode(label),
    timeout: 20000,
    timeoutMsg: `${label} should apply from the sidebar`,
    wait: (condition, opts) => waitUntilOrDiagnose(browser, condition, opts),
  });
}
