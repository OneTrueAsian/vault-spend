// 1.3.5 screens in the Default style, light and dark (VS-49, VS-52, VS-64). The engine is lib/notesPartialMonthRowProblems.mjs.
// Run with: node e2e/feature422_notes_partial_month_row_problems_default.mjs

import { runScreens } from "./lib/notesPartialMonthRowProblems.mjs";

await runScreens({ style: "Default", palette: "transparent", number: 422 });
