import { describe, expect, it } from "vitest";
import { toCsv, sanitizeCsvText } from "./csv";

describe("toCsv", () => {
  it("quotes a field containing a comma, quote, or LF newline", () => {
    const csv = toCsv(["A"], [["a,b"], ['a"b'], ["a\nb"]]);
    expect(csv).toBe('A\r\n"a,b"\r\n"a""b"\r\n"a\nb"\r\n');
  });

  it("quotes a field containing a bare carriage return, not just LF", () => {
    const csv = toCsv(["Description"], [["line1\rline2"]]);
    expect(csv).toContain('"line1\rline2"');
  });

  it("leaves a plain field unquoted", () => {
    const csv = toCsv(["A"], [["plain text"]]);
    expect(csv).toBe("A\r\nplain text\r\n");
  });

  it("defuses a formula-shaped field for every caller, without an opt-in step", () => {
    const csv = toCsv(["Description", "Amount"], [["=1+1", "-10"]], ["text", "decimal"]);
    const dataRow = csv.split("\r\n")[1];
    expect(dataRow.startsWith("=1+1,")).toBe(false);
    expect(dataRow).toBe("'=1+1,-10");
  });

  // Notes are the first free-text field in any export likely to actually
  // contain a comma, an embedded quote, or a multi-line value a person
  // typed — added alongside the Transactions "Notes" export column (Task 3
  // of the transactions-usability plan). The import side of this same
  // contract is core's csv_loader ("reads_back_an_optional_notes_column..."
  // test).
  it("preserves Unicode text unquoted when it needs no escaping", () => {
    expect(toCsv(["Notes"], [["Café Résumé — imported vendor"]])).toBe(
      "Notes\r\nCafé Résumé — imported vendor\r\n",
    );
  });

  it("combines comma, quote and newline correctly in one field (the realistic worst case for a note)", () => {
    const note = 'Split 50/50, "kitchen" stuff\nRe-check total';
    const csv = toCsv(["Notes"], [[note]]);
    expect(csv).toBe('Notes\r\n"Split 50/50, ""kitchen"" stuff\nRe-check total"\r\n');
  });

  it("renders a missing note as an empty field, not the literal string \"null\"", () => {
    expect(toCsv(["Notes"], [[""]])).toBe("Notes\r\n\r\n");
  });
});

describe("sanitizeCsvText", () => {
  it("prefixes a field starting with =, +, -, or @ with a single quote", () => {
    expect(sanitizeCsvText("=1+1")).toBe("'=1+1");
    expect(sanitizeCsvText("+1")).toBe("'+1");
    expect(sanitizeCsvText("-1+2")).toBe("'-1+2");
    expect(sanitizeCsvText("@SUM(A1)")).toBe("'@SUM(A1)");
  });

  it("leaves an ordinary description untouched", () => {
    expect(sanitizeCsvText("Coffee shop")).toBe("Coffee shop");
    expect(sanitizeCsvText("")).toBe("");
  });

  it("does not touch a character that merely appears mid-string", () => {
    expect(sanitizeCsvText("Rent - September")).toBe("Rent - September");
  });

  it("treats numeric-looking descriptions as text, independently of decimal amount columns", () => {
    expect(sanitizeCsvText("-50.00")).toBe("'-50.00");
    expect(toCsv(["Description", "Amount"], [["-50.00", "-50.00"]], ["text", "decimal"])).toBe("Description,Amount\r\n'-50.00,-50.00\r\n");
  });

  it.each([" =1+1", "\t=1+1", "\r=1+1", "\n=1+1", "\u0000=1+1", "\u0085=1+1", "＝1+1", "＋1", "－1+2", "＠SUM(1)"])("prefixes whitespace/control/full-width variant %j without removing characters", value => {
    expect(sanitizeCsvText(value)).toBe(`'${value}`);
  });

  it("keeps ordinary apostrophes and precise decimal strings without number coercion", () => {
    expect(toCsv(["Name", "Amount"], [["O'Brien", "-9007199254740992.01"], ["'=1+1", "0.000001"]], ["text", "decimal"])).toBe("Name,Amount\r\nO'Brien,-9007199254740992.01\r\n'=1+1,0.000001\r\n");
  });

  it.each(["=1+1", "-1+2", "NaN", "Infinity", " 12", "1e3"])("refuses non-decimal data in a declared decimal column: %s", value => {
    expect(() => toCsv(["Amount"], [[value]], ["decimal"])).toThrow();
  });

  it("rejects mismatched column declarations and ragged records", () => {
    expect(() => toCsv(["A", "B"], [["1", "2"]], ["text"])).toThrow();
    expect(() => toCsv(["A"], [["1", "2"]])).toThrow();
  });

  it("still defuses a formula-shaped value that merely starts like a number", () => {
    expect(sanitizeCsvText("-1+2")).toBe("'-1+2");
    expect(sanitizeCsvText("-10*3")).toBe("'-10*3");
  });
});
