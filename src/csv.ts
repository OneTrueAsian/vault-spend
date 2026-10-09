export type CsvColumnType = "text" | "decimal";

/** Conservative text prefixing for spreadsheet consumption, not a universal
 * consumer guarantee. The apostrophe is real CSV data and may remain visible
 * or survive reimport. Never trim/normalize user text or guess its column type. */
export function sanitizeCsvText(value: string): string {
  // These ranges intentionally detect leading CSV control characters.
  // eslint-disable-next-line no-control-regex
  const formula = /^[\s\u0000-\u001f\u007f-\u009f]*[=+\-@＝＋－＠]/;
  // eslint-disable-next-line no-control-regex
  const leadingControl = /^\s*[\u0000-\u001f\u007f-\u009f]/;
  return formula.test(value) || leadingControl.test(value) ? `'${value}` : value;
}

/** Quotes a single CSV field only when it needs it (contains a comma,
 * quote, or newline) — doubling any internal quotes, standard CSV escaping.
 * Checks for a bare `\r` as well as `\n`: a field can contain either on its
 * own (not just the `\r\n` pair this module itself joins rows with), and
 * leaving one unquoted lets it read as an extra row break to any other CSV
 * reader, silently splitting one field into two "records". */
function csvField(value: string): string {
  if (/["\r\n,]/.test(value)) {
    return `"${value.replace(/"/g, '""')}"`;
  }
  return value;
}

/** Decimal strings remain byte-exact (no floating-point conversion). All
 * undeclared columns are text; headers always receive text safeguards.
 * CSV is plaintext, with no encryption or reliable spreadsheet cell types. */
export function toCsv(headers: string[], rows: string[][], types: CsvColumnType[] = headers.map(() => "text")): string {
  if (types.length !== headers.length) throw new Error("CSV column type count does not match headers");
  const lines = [headers.map(value => csvField(sanitizeCsvText(value))).join(",")];
  for (const row of rows) {
    if (row.length !== headers.length) throw new Error("CSV row width does not match headers");
    lines.push(row.map((value, column) => {
      if (types[column] === "decimal") {
        if (value !== "" && !/^-?\d+(\.\d+)?$/.test(value)) throw new Error("CSV decimal column contains a non-decimal value");
        return csvField(value);
      }
      return csvField(sanitizeCsvText(value));
    }).join(","));
  }
  return lines.join("\r\n") + "\r\n";
}
