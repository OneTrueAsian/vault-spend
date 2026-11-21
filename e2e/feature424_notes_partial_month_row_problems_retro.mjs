// 1.3.5 screens in the Retro style, light and dark (VS-49, VS-52, VS-64). The engine is lib/notesPartialMonthRowProblems.mjs.
// Run with: node e2e/feature424_notes_partial_month_row_problems_retro.mjs

import { runScreens } from "./lib/notesPartialMonthRowProblems.mjs";

await runScreens({ style: "Retro", palette: "retro", number: 424 });
