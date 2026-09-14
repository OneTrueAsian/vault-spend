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
    const csv = toCsv(["Description", "Amount"], [["=1+1", "-10"]]);
    const dataRow = csv.split("\r\n")[1];
    expect(dataRow.startsWith("=1+1,")).toBe(false);
    expect(dataRow).toBe("'=1+1,-10");
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

  it("leaves a plain negative or positive decimal amount untouched", () => {
    expect(sanitizeCsvText("-50.00")).toBe("-50.00");
    expect(sanitizeCsvText("1234.56")).toBe("1234.56");
    expect(sanitizeCsvText("-10")).toBe("-10");
    expect(sanitizeCsvText("0")).toBe("0");
  });

  it("still defuses a formula-shaped value that merely starts like a number", () => {
    expect(sanitizeCsvText("-1+2")).toBe("'-1+2");
    expect(sanitizeCsvText("-10*3")).toBe("'-10*3");
  });
});
