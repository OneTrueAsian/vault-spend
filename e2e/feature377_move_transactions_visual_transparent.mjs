// The Move to account review in the transparent style, light and dark, at 1280x800 and the 720x520 minimum window:
// placement, action buttons, Axe, keyboard and Escape. The engine and the full list of checks are in lib/moveVisualMatrix.mjs.
//
// Run with: node e2e/feature377_move_transactions_visual_transparent.mjs

import { runMoveMatrix } from "./lib/moveVisualMatrix.mjs";

await runMoveMatrix("transparent");
