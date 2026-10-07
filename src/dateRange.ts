/** The dates the app accepts anywhere a date is entered. The backend refuses the same range
 * (`parse_date` in src-tauri/src/commands.rs), so a typo like year 9643 is caught before saving. */
export const EARLIEST_DATE = "1900-01-01";
export const LATEST_DATE = "2100-12-31";
export const DATE_RANGE_PROBLEM = "Choose a date between 1900 and 2100.";

/** True for a filled-in "YYYY-MM-DD" date outside the accepted years. Compares the year as a number,
 * so a five-digit year counts as too late rather than sorting before "2100" as text. */
export function dateOutOfRange(iso: string): boolean {
  const year = Number(iso.slice(0, iso.indexOf("-")));
  if (!iso || !Number.isFinite(year)) return false;
  return year < Number(EARLIEST_DATE.slice(0, 4)) || year > Number(LATEST_DATE.slice(0, 4));
}
