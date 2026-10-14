import { describe, expect, it } from "vitest";
import { buildPdf, checkingStatement, money, unknownBankStatement, unknownBrokerageStatement } from "./statementPdf.mjs";
import { isoDaysFromNow } from "./dates.mjs";

const text = (buffer) => buffer.toString("latin1");

describe("statement PDF writer", () => {
  it("writes a cross-reference table where startxref points", () => {
    const pdf = text(buildPdf([["Hello (world)", "Second"]]));
    const at = Number(pdf.split("startxref\n")[1].split("\n")[0]);
    expect(pdf.slice(at, at + 4)).toBe("xref");
    expect(pdf).toContain("(Hello \\(world\\)) Tj");
  });

  it("gives each line its own height, in order, and drops what a PDF string can't hold", () => {
    const pdf = text(buildPdf([["First", "Café — Second"]]));
    expect(pdf.indexOf("(First) Tj")).toBeLessThan(pdf.indexOf("(Caf  Second) Tj"));
    expect(pdf).toContain("1 0 0 1 40 760 Tm");
    expect(pdf).toContain("1 0 0 1 40 748 Tm");
  });

  it("formats money the way statements print it", () => {
    expect(money(1234.5)).toBe("1,234.50");
    expect(money(-54.2)).toBe("54.20");
    expect(money(0)).toBe("0.00");
  });

  it("writes statements that add up, using the dates given", () => {
    const start = isoDaysFromNow(-30);
    const end = isoDaysFromNow(-1);
    const day = isoDaysFromNow(-20);
    const [yyyy, mm, dd] = day.split("-");

    const checking = checkingStatement({ start, end, opening: 1000, rows: [{ date: day, description: "Coffee", amount: -50 }, { date: day, description: "Refund", amount: 25 }] });
    expect(checking.closing).toBe(975);
    const page = text(checking.pdf);
    expect(page).toContain("(Beginning Balance $1,000.00) Tj");
    expect(page).toContain(`(${mm}/${dd}/${yyyy} Coffee -$50.00) Tj`);
    expect(page).toContain("(Ending Balance $975.00) Tj");

    const bank = unknownBankStatement({ start, end, opening: 1250, rows: [{ date: day, description: "Salary", amount: 2000 }, { date: day, description: "Groceries", amount: -54.2 }] });
    expect(bank.closing).toBeCloseTo(3195.8, 2);
    const bankText = text(bank.pdf);
    expect(bankText).toContain(`(${dd}/${mm}/${yyyy} Salary 2,000.00 CR) Tj`);
    expect(bankText).toContain(`(${dd}/${mm}/${yyyy} Groceries 54.20) Tj`);
    expect(bankText).toContain("(Closing balance 3,195.80) Tj");

    const broker = unknownBrokerageStatement({
      start,
      end,
      beginningCash: 500,
      rows: [{ date: day, description: "Deposit from bank", amount: 1000 }],
      holdings: [{ symbol: "QQQZ", name: "NASDAQ TRACKER FUND", quantity: 10.5, price: 300.25 }],
    });
    expect(broker.total).toBeCloseTo(3152.63, 2);
    const brokerText = text(broker.pdf);
    expect(brokerText).toContain("(10.5000 $300.25 $3,152.63) Tj");
    expect(brokerText).toContain("(Total Market Value $3,152.63) Tj");
    expect(brokerText).toContain("(Ending Cash Balance $1,500.00) Tj");
  });
});
