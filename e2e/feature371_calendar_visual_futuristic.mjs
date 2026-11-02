// The app-drawn date and month calendars in the futuristic style, light and dark, at 1280x800 and the 720x520
// minimum window: placement, no native control, distinct selected/today/unavailable looks, Axe, Escape.
// The engine and the full list of checks are in lib/calendarVisualMatrix.mjs.
//
// Run with: node e2e/feature371_calendar_visual_futuristic.mjs

import { runCalendarMatrix } from "./lib/calendarVisualMatrix.mjs";

await runCalendarMatrix("futuristic");
