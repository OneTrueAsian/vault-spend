/** A field that's nothing but a plain decimal number (optionally negative)
 * — the shape every amount column in this app's exports actually uses.
 * Recognizing this lets `sanitizeCsvText` defuse formula-shaped text
 * everywhere without also mangling a legitimate negative amount, whose
 * leading `-` would otherwise look identical to a formula's. */
function isPlainNumber(value: string): boolean {
  return /^-?\d+(\.\d+)?$/.test(value);
}

/** Neutralizes "CSV injection": a field whose text starts with `=`, `+`,
 * `-`, or `@` opens as a live formula in Excel/Sheets/LibreOffice instead
 * of literal text — e.g. a transaction description of `=1+1`, or worse, a
 * formula that shells out or pulls from a remote URL. A leading `'` is the
 * standard mitigation (widely used by financial exports): every mainstream
 * spreadsheet app treats it as "force this cell to text" and doesn't
 * display the quote itself, so the visible content is unchanged for a
 * normal description while a formula-shaped one is defused.
 *
 * Skips anything that's already a plain number (see `isPlainNumber`) —
 * this is what lets `toCsv` apply it to *every* field unconditionally
 * (including a numeric amount column) without turning `-50.00` into text
 * and breaking the exact column an export is often opened in a
 * spreadsheet to total up. */
export function sanitizeCsvText(value: string): string {
  if (isPlainNumber(value)) return value;
  return /^[=+\-@]/.test(value) ? `'${value}` : value;
}

/** Quotes a single CSV field only when it needs it (contains a comma,
 * quote, or newline) — doubling any internal quotes, standard CSV escaping.
 * Checks for a bare `\r` as well as `\n`: a field can contain either on its
 * own (not just the `\r\n` pair this module itself joins rows with), and
 * leaving one unquoted lets it read as an extra row break to any other CSV
 * reader, silently splitting one field into two "records". Also runs every
 * field through `sanitizeCsvText` first — applied here, not left to
 * individual callers, so no export (present or future) can forget it. */
function csvField(value: string): string {
  const safe = sanitizeCsvText(value);
  if (/["\r\n,]/.test(safe)) {
    return `"${safe.replace(/"/g, '""')}"`;
  }
  return safe;
}

/** Builds CSV text (with a header row) from a table of plain string cells —
 * callers format each value (dates, money, etc.) before passing it in. */
export function toCsv(headers: string[], rows: string[][]): string {
  const lines = [headers, ...rows].map((row) => row.map(csvField).join(","));
  return lines.join("\r\n") + "\r\n";
}
