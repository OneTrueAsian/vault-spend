import { toCsv } from "./csv";

/** The downloadable setup-data template: one combined CSV with a section
 * per entity type, each shipped with one example row to overwrite. The
 * section titles and column headers here are load-bearing — the Rust
 * parser (core/src/setup_import.rs) finds sections and columns by these
 * exact names (case-insensitively). */
export function buildSetupTemplate(): string {
  const intro =
    "# Vault Spend setup template - fill in your own rows under each section.\r\n" +
    "# Delete the example rows, keep the section titles and header rows.\r\n" +
    "# Account types: checking, savings, credit, loan, investment, other.\r\n" +
    "# Budget groups: income, fixed, flexible, nonmonthly. A blank budget Period means the current month.\r\n" +
    "# Holdings' Account must match an existing account's name exactly (case-insensitive) - a row whose\r\n" +
    "# account isn't found is skipped, not partially created.\r\n" +
    "\r\n";
  const accounts =
    "Accounts\r\n" +
    toCsv(
      ["Name", "Type", "Starting Balance", "Institution", "Mask"],
      [["Everyday Checking", "checking", "1000.00", "Ally", "1234"]],
    );
  const categories = "Categories\r\n" + toCsv(["Name"], [["Groceries"]]);
  const budgets =
    "Budgets\r\n" +
    toCsv(["Category", "Group", "Monthly Amount", "Period"], [["Groceries", "flexible", "400.00", ""]]);
  const buckets =
    "Buckets\r\n" +
    toCsv(
      ["Name", "Target Amount", "Target Date", "Linked Account"],
      [["Emergency Fund", "5000.00", "", "Everyday Checking"]],
    );
  const holdings =
    "Holdings\r\n" +
    toCsv(
      ["Account", "Symbol", "Name", "Shares", "Price", "Cost Basis", "Asset Class"],
      [["Brokerage", "AAPL", "Apple Inc.", "10", "231.20", "1450.00", "US Stocks"]],
    );
  return intro + accounts + "\r\n" + categories + "\r\n" + budgets + "\r\n" + buckets + "\r\n" + holdings;
}
