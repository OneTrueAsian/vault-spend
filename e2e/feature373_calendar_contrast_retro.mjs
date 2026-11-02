// The app-drawn date and month calendars: measured text contrast (retro style), light and dark, at rest and in each hover and
// keyboard-focus state. The engine, procedure and limits are in lib/calendarContrast.mjs and lib/calendarContrastMatrix.mjs.
//
// Run with: node e2e/feature373_calendar_contrast_retro.mjs

import { runCalendarContrast } from "./lib/calendarContrastMatrix.mjs";

await runCalendarContrast("retro");
