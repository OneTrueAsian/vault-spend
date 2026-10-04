// For specs that call the import commands directly, because the native file dialog is out of
// WebDriver's reach. The review screen refuses to import while a checked row the app can't place
// has no choice (src/importResolution.ts); `commitReviewedImport` does what a person pressing
// "Leave the rest uncategorized" would, so a spec about something else (notes, signs) can import.

const key = (name) => name.trim().toLowerCase();

function isSure(suggestion, choiceBelow) {
  if (!suggestion) return false;
  const c = suggestion.confidence;
  if (c === null) return suggestion.source === "rule";
  return Number.isFinite(c) && c >= choiceBelow && c <= 1;
}

/** The row choices for `included` rows the app can't place: `null` ("Leave uncategorized") for
 * each, keeping any choice already in `rowChoices`. */
export function leaveUnsureRowsUncategorized(preview, included, categoryChoices = {}, rowChoices = {}) {
  const panel = new Map(Object.entries(categoryChoices).map(([name, choice]) => [key(name), choice]));
  const out = { ...rowChoices };
  for (const row of preview.rows) {
    if (!included.includes(row.index) || row.index in out || row.matched_category) continue;
    const choice = row.category && row.category.trim() ? panel.get(key(row.category)) : undefined;
    if (choice && choice.action !== "skip") continue;
    if (!isSure(row.suggestion, preview.choice_below)) out[row.index] = null;
  }
  return out;
}

async function invoke(browser, command, args) {
  return browser.executeAsync(
    (cmd, a, done) => window.__TAURI_INTERNALS__.invoke(cmd, a).then((ok) => done({ ok }), (e) => done({ error: String(e) })),
    command,
    args,
  );
}

/** Previews `path`, then commits it the way the review screen would: with the preview's review
 * token, and every unsure checked row left uncategorized unless `rowChoices` says otherwise.
 * Resolves to `{ ok }` or `{ error }`, like a direct invoke. */
export async function commitReviewedImport(browser, { path, invertAmounts = false, defaultAccountId, includedIndices, accountOverrides = {}, categoryChoices, rowChoices = {} }) {
  const preview = await invoke(browser, "preview_import", { path, invertAmounts, accountId: defaultAccountId });
  if (preview.error !== undefined) return preview;
  return invoke(browser, "commit_import", {
    path,
    invertAmounts,
    defaultAccountId,
    reviewToken: preview.ok.review_token,
    includedIndices,
    accountOverrides,
    categoryChoices,
    rowChoices: leaveUnsureRowsUncategorized(preview.ok, includedIndices, categoryChoices ?? {}, rowChoices),
  });
}
