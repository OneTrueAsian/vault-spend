// Fictional bank, bank-like and brokerage statements as real PDFs, for the statement-upload specs. The
// writer is a port of `build_pdf` in core/src/statement/fixture_pdf.rs (same objects, one text operation
// per line at its own height, so the PDF's text order is exactly the order given). No real names,
// institutions, account numbers or amounts appear here. Dates are passed in (use `isoDaysFromNow` or
// `dateInMonth`), never written as calendar dates, so the fixtures stay current.

/** Escapes a line for a PDF string and drops anything that isn't plain ASCII. */
function escapeLine(line) {
  let out = "";
  for (const ch of line) {
    const code = ch.codePointAt(0);
    if (code > 126 || code < 32) continue;
    if (ch === "(" || ch === ")" || ch === "\\") out += "\\";
    out += ch;
  }
  return out;
}

/** `pages` is a list of pages, each a list of text lines (at most 60 a page). */
export function buildPdf(pages) {
  const objects = [];
  const pageIds = pages.map((_, i) => 4 + i * 2);
  objects.push("<< /Type /Catalog /Pages 2 0 R >>");
  objects.push(`<< /Type /Pages /Kids [${pageIds.map((id) => `${id} 0 R`).join(" ")}] /Count ${pages.length} >>`);
  objects.push("<< /Type /Font /Subtype /Type1 /BaseFont /Helvetica /Encoding /WinAnsiEncoding >>");
  pages.forEach((lines, i) => {
    if (lines.length > 60) throw new Error("statement fixture pages hold at most 60 lines");
    objects.push(`<< /Type /Page /Parent 2 0 R /MediaBox [0 0 612 792] /Resources << /Font << /F1 3 0 R >> >> /Contents ${pageIds[i] + 1} 0 R >>`);
    let stream = "BT\n/F1 9 Tf\n";
    lines.forEach((line, n) => {
      stream += `1 0 0 1 40 ${760 - n * 12} Tm\n(${escapeLine(line)}) Tj\n`;
    });
    stream += "ET\n";
    objects.push(`<< /Length ${stream.length} >>\nstream\n${stream}endstream`);
  });
  let out = "%PDF-1.4\n";
  const offsets = [];
  objects.forEach((body, i) => {
    offsets.push(out.length);
    out += `${i + 1} 0 obj\n${body}\nendobj\n`;
  });
  const xref = out.length;
  out += `xref\n0 ${objects.length + 1}\n0000000000 65535 f \n`;
  for (const offset of offsets) out += `${String(offset).padStart(10, "0")} 00000 n \n`;
  out += `trailer\n<< /Size ${objects.length + 1} /Root 1 0 R >>\nstartxref\n${xref}\n%%EOF\n`;
  return Buffer.from(out, "latin1");
}

/** Money as the statements print it: 1234.5 -> "1,234.50". */
export function money(value) {
  const cents = Math.round(Math.abs(value) * 100);
  const whole = String(Math.floor(cents / 100)).replace(/\B(?=(\d{3})+(?!\d))/g, ",");
  return `${whole}.${String(cents % 100).padStart(2, "0")}`;
}

const parts = (iso) => {
  const [y, m, d] = iso.split("-");
  return { y, m, d };
};
const monthDayYear = (iso) => {
  const { y, m, d } = parts(iso);
  return `${m}/${d}/${y}`;
};
const dayMonthYear = (iso) => {
  const { y, m, d } = parts(iso);
  return `${d}/${m}/${y}`;
};

/** A bank statement in a common shape the app reads without help: "Beginning/Ending Balance",
 * MM/DD/YYYY dates and the amount right after the description (money out has a minus sign).
 * `rows`: [{ date: "YYYY-MM-DD", description, amount: number }]. Returns the PDF and the closing balance. */
export function checkingStatement({ start, end, opening, rows }) {
  const closing = rows.reduce((sum, r) => sum + r.amount, opening);
  const sign = (n) => (n < 0 ? "-" : "");
  const lines = [
    "Northwind Community Bank",
    "Everyday Checking Statement",
    `Beginning Balance $${money(opening)}`,
    "Date Description Amount",
    ...rows.map((r) => `${monthDayYear(r.date)} ${r.description} ${sign(r.amount)}$${money(r.amount)}`),
    `Ending Balance $${money(closing)}`,
  ];
  return { pdf: buildPdf([lines]), closing, period: { start, end } };
}

/** A bank the app has never seen: day-first dates, money out printed without a sign, money in marked CR,
 * "Opening balance" / "Closing balance". The app has to be shown where the date, amount and balances are.
 * `rows`: [{ date, description, amount: number }] (negative = money out). */
export function unknownBankStatement({ start, end, opening, rows }) {
  const closing = rows.reduce((sum, r) => sum + r.amount, opening);
  const lines = [
    "Riverbend Mutual Bank",
    "Everyday Account Statement",
    `Opening balance ${money(opening)}`,
    "Date Details Amount",
    ...rows.map((r) => `${dayMonthYear(r.date)} ${r.description} ${money(r.amount)}${r.amount > 0 ? " CR" : ""}`),
    `Closing balance ${money(closing)}`,
  ];
  return { pdf: buildPdf([lines]), closing, period: { start, end } };
}

/** A brokerage the app has never seen: cash balances, a holdings table with four-decimal quantities and
 * two-decimal prices (not what the built-in reading expects), "Total Market Value", then activity.
 * `holdings`: [{ symbol, name, quantity, price }]; `rows`: [{ date, description, amount }]. */
export function unknownBrokerageStatement({ start, end, beginningCash, rows, holdings }) {
  const endingCash = rows.reduce((sum, r) => sum + r.amount, beginningCash);
  const value = (h) => Math.round(h.quantity * h.price * 100) / 100;
  const total = holdings.reduce((sum, h) => sum + value(h), 0);
  const lines = [
    "Harborview Investing",
    "Account Summary",
    "Brokerage Account",
    `Beginning Cash Balance $${money(beginningCash)}`,
    `Ending Cash Balance $${money(endingCash)}`,
    "Holdings",
    "Symbol Description Quantity Price Value",
    ...holdings.flatMap((h) => [`${h.symbol} ${h.name}`, `${h.quantity.toFixed(4)} $${money(h.price)} $${money(value(h))}`]),
    `Total Market Value $${money(total)}`,
    "Activity",
    ...rows.map((r) => `${monthDayYear(r.date)} ${r.description} ${r.amount < 0 ? "-" : ""}$${money(r.amount)}`),
  ];
  return { pdf: buildPdf([lines]), endingCash, total, period: { start, end } };
}
