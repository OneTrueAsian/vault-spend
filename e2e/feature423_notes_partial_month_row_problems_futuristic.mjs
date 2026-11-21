// 1.3.5 screens in the Futuristic style, light and dark (VS-49, VS-52, VS-64). The engine is lib/notesPartialMonthRowProblems.mjs.
// Run with: node e2e/feature423_notes_partial_month_row_problems_futuristic.mjs

import { runScreens } from "./lib/notesPartialMonthRowProblems.mjs";

await runScreens({ style: "Futuristic", palette: "futuristic", number: 423 });
