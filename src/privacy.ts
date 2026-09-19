/** Privacy mode: hides every dollar amount on screen.
 *
 * Done at the DOM's text level rather than inside each formatter on purpose:
 * amounts reach the screen through `formatAmount`, the chart labels'
 * abbreviated formatter, hand-built `$${x}` strings, and sentences the Rust
 * side composes ("Groceries is $120 over"). One text-level pass covers all of
 * them, including ones added later. It hides figures, not shapes — a bar's
 * length still hints at its size — and it leaves tooltips (`title`) alone. */

/** What an amount is replaced with. */
export const PRIVACY_MASK = "••••";

// An optional sign, "$", digits with optional thousands commas and decimals,
// and an optional k/M/B suffix ("$1.2k", "$3.4M"). Requires a digit after the
// "$" so a stray "$" in prose survives.
const AMOUNT_PATTERN = /[-−–]?\$\s?\d[\d,]*(?:\.\d+)?(?:\s?[kKmMbB]\b)?/g;

export function maskAmounts(text: string): string {
  return text.replace(AMOUNT_PATTERN, PRIVACY_MASK);
}

/** Never touch what a person is typing, code, or anything opted out. */
const SKIPPED_PARENTS = "textarea, input, script, style, [data-privacy-ignore]";

function isSkipped(node: Text): boolean {
  return node.parentElement?.closest(SKIPPED_PARENTS) != null;
}

/** Masks every dollar amount under `root` — now and as the page changes —
 * until the returned function is called, which puts the real text back. */
export function startPrivacyMask(root: Node): () => void {
  const originals = new Map<Text, string>();

  function maskNode(node: Text) {
    if (isSkipped(node)) return;
    const value = node.nodeValue ?? "";
    const masked = maskAmounts(value);
    if (masked === value) return;
    originals.set(node, value);
    node.nodeValue = masked;
  }

  function maskTree(start: Node) {
    if (start.nodeType === Node.TEXT_NODE) {
      maskNode(start as Text);
      return;
    }
    const walker = document.createTreeWalker(start, NodeFilter.SHOW_TEXT);
    for (let n = walker.nextNode(); n; n = walker.nextNode()) maskNode(n as Text);
  }

  // Text nodes that left the page can't be restored, only forgotten — done
  // occasionally so a long session's churn doesn't pile up.
  function prune() {
    if (originals.size < 2000) return;
    for (const node of originals.keys()) if (!node.isConnected) originals.delete(node);
  }

  const observer = new MutationObserver((records) => {
    for (const record of records) {
      if (record.type === "characterData") maskNode(record.target as Text);
      else record.addedNodes.forEach(maskTree);
    }
    prune();
  });

  maskTree(root);
  observer.observe(root, { childList: true, subtree: true, characterData: true });

  return () => {
    observer.disconnect();
    for (const [node, original] of originals) {
      // Only put back nodes still showing our mask — one React has since
      // rewritten already holds newer real text.
      if (node.isConnected && node.nodeValue === maskAmounts(original)) node.nodeValue = original;
    }
    originals.clear();
  };
}

const HIDDEN_KEY = "vaultspend-privacy-hidden";
const AUTO_HIDE_KEY = "vaultspend-privacy-autohide";

export type PrivacyPrefs = { hidden: boolean; autoHide: boolean };

/** Per-viewer preferences (same localStorage tier as theme and density). */
export function loadPrivacyPrefs(): PrivacyPrefs {
  try {
    return {
      hidden: localStorage.getItem(HIDDEN_KEY) === "1",
      autoHide: localStorage.getItem(AUTO_HIDE_KEY) === "1",
    };
  } catch {
    return { hidden: false, autoHide: false };
  }
}

export function savePrivacyPrefs(prefs: PrivacyPrefs) {
  try {
    localStorage.setItem(HIDDEN_KEY, prefs.hidden ? "1" : "0");
    localStorage.setItem(AUTO_HIDE_KEY, prefs.autoHide ? "1" : "0");
  } catch {
    // per-viewer preference only — fine to skip if storage is unavailable
  }
}
