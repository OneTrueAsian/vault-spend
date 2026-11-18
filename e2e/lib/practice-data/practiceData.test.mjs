import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { execFileSync, spawnSync } from "node:child_process";
import { afterAll, describe, expect, it } from "vitest";
import { buildPracticeData, seedMainHousehold } from "./index.mjs";

// The shared practice data (see COVERAGE.md) is built by the real seeding path: init_db.exe for the schema, then
// Python inserts. Both must exist to build it; without them the reason is printed instead of a silent pass.
const initDb = path.resolve("target/debug/init_db.exe");
const hasPython = spawnSync("python", ["--version"]).status === 0;
const canBuild = fs.existsSync(initDb) && hasPython;
if (!canBuild) console.warn(`practice data tests skipped: needs ${initDb} (cargo build -p budget_core --bin init_db) and python`);

const made = [];
afterAll(() => { for (const dir of made) fs.rmSync(dir, { recursive: true, force: true }); });

async function build(today) {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "vs-practice-"));
  made.push(dir);
  await seedMainHousehold(dir, today ? { today } : undefined);
  return path.join(dir, "vaultspend.db");
}

function query(db, sql) {
  const py = "import sqlite3,sys,json;c=sqlite3.connect(sys.argv[1]);print(json.dumps(c.execute(sys.argv[2]).fetchall()))";
  return JSON.parse(execFileSync("python", ["-c", py, db, sql], { encoding: "utf8" }));
}

const TODAY = "2026-11-18";
const monthsBack = (iso, n) => { const d = new Date(`${iso}T00:00:00`); d.setDate(1); d.setMonth(d.getMonth() - n); return d.toISOString().slice(0, 10); };

describe.skipIf(!canBuild)("main practice household", () => {
  let db;
  it("has 15 months of history", async () => {
    db = await build(TODAY);
    const [[earliest]] = query(db, "SELECT MIN(date) FROM transactions");
    expect(earliest <= monthsBack(TODAY, 14)).toBe(true);
  }, 60000);

  it("has two family members who each spent something this month or last", () => {
    const members = query(db, "SELECT id, name FROM family_members ORDER BY id");
    expect(members.length).toBeGreaterThanOrEqual(2);
    for (const [id, name] of members) {
      const [[n]] = query(db, `SELECT COUNT(*) FROM transactions WHERE member_id = ${id} AND CAST(amount AS REAL) < 0 AND category <> 'Transfer' AND date >= '${monthsBack(TODAY, 1)}'`);
      expect(n, `${name} has spending`).toBeGreaterThan(0);
    }
  });

  it("has unique account names and exactly one Car Loan", () => {
    const names = query(db, "SELECT name FROM accounts").map(([n]) => n);
    expect(new Set(names).size).toBe(names.length);
    expect(names.filter((n) => n === "Car Loan")).toHaveLength(1);
  });

  it("gives identical transaction rows on two builds the same day", async () => {
    const again = await build(TODAY);
    const rows = (d) => query(d, "SELECT date, description, amount, category FROM transactions ORDER BY 1, 2, 3");
    expect(rows(again)).toEqual(rows(db));
  }, 60000);

  it.each(["2027-03-01", "2027-02-28", "2027-01-31"])("builds on %s with nothing dated in the future", async (day) => {
    const d = await build(day);
    const [[future]] = query(d, `SELECT COUNT(*) FROM transactions WHERE date > '${day}'`);
    expect(future).toBe(0);
  }, 60000);
});

describe.skipIf(!canBuild)("practice data registry, profiles, files and README", () => {
  let dir, result, registry;
  it("builds", async () => {
    dir = fs.mkdtempSync(path.join(os.tmpdir(), "vs-practice-reg-"));
    made.push(dir);
    result = await buildPracticeData(dir, { today: TODAY });
    registry = JSON.parse(fs.readFileSync(path.join(dir, "profiles.json"), "utf8"));
  }, 120000);

  it("lists the main household, Sam, Fresh start and Locked, in that order, with existing databases", () => {
    expect(registry.profiles.map((p) => [p.id, p.name])).toEqual([["household-0", "Rivera household"], ["sam-1", "Sam"], ["fresh-2", "Fresh start"], ["locked-3", "Locked"]]);
    for (const p of registry.profiles) expect(fs.existsSync(p.db_path), p.name).toBe(true);
    expect(result.profiles.map((p) => p.id)).toEqual(registry.profiles.map((p) => p.id));
  });

  it("pre-selects the main household without skipping the selector", () => {
    const device = JSON.parse(fs.readFileSync(path.join(dir, "device-settings.json"), "utf8"));
    expect(device.last_used_profile_id).toBe("household-0");
  });

  it("gives Sam two plaintext backups", () => {
    const sam = registry.profiles.find((p) => p.id === "sam-1");
    expect(sam.protection ?? null).toBe(null);
    expect(fs.readdirSync(path.join(path.dirname(sam.db_path), "backups")).filter((f) => f.endsWith(".db"))).toEqual(result.samBackupNames);
    expect(result.samBackupNames).toHaveLength(2);
  });

  it("keeps Fresh start empty with every default", () => {
    const fresh = registry.profiles.find((p) => p.id === "fresh-2").db_path;
    expect(query(fresh, "SELECT COUNT(*) FROM transactions")[0][0]).toBe(0);
    expect(query(fresh, "SELECT COUNT(*) FROM family_members")[0][0]).toBe(0);
    expect(query(fresh, "SELECT COUNT(*) FROM accounts")[0][0]).toBe(0);
    const settings = query(fresh, "SELECT budget_exclusion_enabled, auto_link_transfers FROM app_settings WHERE id = 1")[0] ?? [0, 0];
    expect(settings).toEqual([0, 0]);
  });

  it("makes Locked a protected profile with no plaintext copy left", () => {
    const locked = registry.profiles.find((p) => p.id === "locked-3");
    expect(locked.protection).toEqual({ format: 1 });
    expect(path.basename(locked.db_path)).toBe("vaultspend-protected.db");
    expect(fs.existsSync(`${locked.db_path}.key`)).toBe(true);
    expect(fs.existsSync(path.join(path.dirname(locked.db_path), "vaultspend.db"))).toBe(false);
  });

  it("writes the practice files", () => {
    const files = fs.readdirSync(result.filesDir).sort();
    for (const f of ["1-northwind-month-1.pdf", "3-riverbend-month-1.pdf", "5-harborview-month-1.pdf", "7-picture-only.pdf", "8-corner-download-unfamiliar-headers.csv", "11-joint-checking-download.csv", "README.txt"]) expect(files, f).toContain(f);
    const readme = fs.readFileSync(path.join(result.filesDir, "README.txt"), "utf8");
    expect(readme).toContain("Practice Checking");
    expect(readme).not.toContain("Everyday Checking");
  });

  it("explains every profile, and holds Locked's password only in the README", () => {
    const readme = fs.readFileSync(result.readmePath, "utf8");
    for (const name of ["Rivera household", "Sam", "Fresh start", "Locked"]) expect(readme).toContain(name);
    expect(readme).toMatch(/Password: \S{12,}/);
    expect(readme).toMatch(/Recovery key: \S+/);
    expect(JSON.stringify(registry)).not.toMatch(/Password/i);
  });
});

// One check per data-backed row in COVERAGE.md.
describe.skipIf(!canBuild)("practice data covers every feature (COVERAGE.md)", () => {
  let db;
  const one = (sql) => query(db, sql)[0]?.[0];
  const count = (sql) => one(`SELECT COUNT(*) FROM (${sql})`);
  const acct = (name) => one(`SELECT id FROM accounts WHERE name = '${name.replace(/'/g, "''")}'`);
  const thisMonth = TODAY.slice(0, 7);
  const lastMonth = monthsBack(TODAY, 1).slice(0, 7);

  it("builds", async () => { db = await build(TODAY); }, 60000);

  it("Dashboard: quiet account, large charge, duplicate pair", () => {
    expect(one("SELECT MAX(date) FROM transactions t JOIN accounts a ON a.id = t.account_id WHERE a.name = 'Old Checking'")).toBe("2026-09-19");
    expect(count("SELECT 1 FROM transactions WHERE description = 'Home Depot' AND amount = '-412.30'")).toBe(1);
    expect(count("SELECT 1 FROM transactions WHERE description = 'Chipotle' AND amount = '-14.25' AND date = '2026-11-16'")).toBe(2);
  });

  it("Accounts: every type, statement practice accounts", () => {
    const types = query(db, "SELECT DISTINCT account_type FROM accounts").map(([t]) => t).sort();
    expect(types).toEqual(["checking", "credit", "investment", "loan", "savings"]);
    for (const name of ["Statement Checking", "Practice Checking", "Riverbend Checking", "Corner Credit Union", "Harborview Brokerage", "Rewards Card", "Old Checking"]) expect(acct(name), name).toBeTruthy();
    expect(count("SELECT 1 FROM accounts WHERE name = 'Everyday Checking'")).toBe(0);
    expect(count(`SELECT 1 FROM transactions WHERE account_id = ${acct("Statement Checking")}`)).toBe(6);
  });

  it("Transactions: uncategorized trios, split, tags, notes", () => {
    for (const name of ["Ferrywood Coffee", "Corner Cart", "Lunch Truck"]) expect(count(`SELECT 1 FROM transactions WHERE description = '${name}' AND category IS NULL`), name).toBe(3);
    expect(count("SELECT 1 FROM transactions WHERE description IN ('SQ *MYSTERY VENDOR 8841', 'PAYPAL *INST XFER') AND category IS NULL")).toBe(2);
    expect(count("SELECT DISTINCT transaction_id FROM transaction_splits")).toBeGreaterThanOrEqual(1);
    expect(count("SELECT 1 FROM transaction_tags")).toBeGreaterThanOrEqual(2);
    expect(count("SELECT 1 FROM transactions WHERE notes IS NOT NULL")).toBeGreaterThanOrEqual(1);
  });

  it("Transactions: Exclude from budget is on with the UAT rows marked", () => {
    expect(one("SELECT budget_exclusion_enabled FROM app_settings WHERE id = 1")).toBe(1);
    const marked = query(db, "SELECT description FROM transactions WHERE excluded_from_budget = 1 ORDER BY description").map(([d]) => d);
    expect(marked).toEqual(["UAT City Hospital ER bill", "UAT Client dinner (work)", "UAT Employer reimbursement", "UAT Water heater replacement"]);
    expect(count(`SELECT 1 FROM transactions WHERE description = 'UAT Pharmacy' AND date LIKE '${thisMonth}%'`)).toBe(1);
    expect(count(`SELECT 1 FROM transactions WHERE description = 'UAT Water heater replacement' AND date LIKE '${lastMonth}%'`)).toBe(1);
    expect(count(`SELECT 1 FROM budgets WHERE category = 'Medical' AND period = '${thisMonth}'`)).toBe(1);
  });

  it("Transactions: transfers to link by hand, to review, and auto-linked", () => {
    expect(count("SELECT 1 FROM transactions WHERE description IN ('Venmo to Sam', 'Zelle from Sam')")).toBe(2);
    expect(count("SELECT 1 FROM transactions t WHERE t.category = 'Savings Goal' AND t.id NOT IN (SELECT out_transaction_id FROM transfer_links UNION SELECT in_transaction_id FROM transfer_links)")).toBeGreaterThanOrEqual(4);
    expect(one("SELECT auto_link_transfers FROM app_settings WHERE id = 1")).toBe(1);
    expect(count("SELECT 1 FROM transfer_links WHERE auto = 1 AND reviewed = 0")).toBeGreaterThanOrEqual(1);
    expect(count("SELECT 1 FROM transactions WHERE description LIKE 'Holiday Fund%'")).toBe(3);
  });

  it("Transactions: review inbox", () => {
    expect(count("SELECT 1 FROM transactions WHERE description = 'Local Bakery Co' AND confidence < 0.6")).toBe(1);
    expect(count("SELECT 1 FROM transactions WHERE description = 'STARBUCKS #1042 SEATTLE' AND category IS NULL")).toBe(1);
  });

  it("Recurring: late, missed, price change and steady bills", () => {
    for (const m of ["Hulu", "Peak Climbing Gym", "CloudBox Storage", "Trash & Recycling"]) expect(count(`SELECT 1 FROM recurring WHERE merchant = '${m}'`), m).toBe(1);
    expect(count("SELECT 1 FROM transactions WHERE description = 'HULU 877-8244858' AND amount = '-17.99'")).toBe(1);
  });

  it("Budget: rollover, caps, suggestions, month-end review", () => {
    expect(one(`SELECT rollover_enabled FROM budgets WHERE category = 'Household' AND period = '${thisMonth}'`)).toBe(1);
    expect(one("SELECT envelope_caps_enabled FROM app_settings WHERE id = 1")).toBe(1);
    expect(one(`SELECT cap_enabled FROM budgets WHERE category = 'Dining Out' AND period = '${thisMonth}'`)).toBe(1);
    expect(count("SELECT 1 FROM transactions WHERE category = 'Pet Care'")).toBe(3);
    expect(count("SELECT 1 FROM budgets WHERE category = 'Pet Care'")).toBe(0);
    expect(count(`SELECT 1 FROM transactions WHERE category IS NULL AND date LIKE '${lastMonth}%'`)).toBeGreaterThanOrEqual(2);
    expect(count(`SELECT 1 FROM transactions WHERE description IN ('Big Box Outlet', 'Prime Steakhouse') AND date LIKE '${lastMonth}%'`)).toBe(2);
  });

  it("Goals: on track, behind, following an account, sinking fund", () => {
    for (const g of ["Emergency Fund", "Japan Trip", "New Laptop", "Holiday Gifts", "Down Payment", "Car Registration"]) expect(count(`SELECT 1 FROM buckets WHERE name = '${g}'`), g).toBe(1);
    expect(one("SELECT tracks_account FROM buckets WHERE name = 'Down Payment'")).toBe(1);
    expect(one("SELECT sinking_amount FROM buckets WHERE name = 'Car Registration'")).toBeTruthy();
  });

  it("Investments: targets, value history, accumulation accounts and plans", () => {
    expect(count("SELECT 1 FROM allocation_targets")).toBeGreaterThanOrEqual(3);
    expect(count("SELECT 1 FROM portfolio_snapshots")).toBe(24);
    for (const name of ["Sample Roth IRA", "Sam's 529", "Alex's 529", "Fidelity Brokerage"]) expect(acct(name), name).toBeTruthy();
    expect(count("SELECT 1 FROM investment_plans")).toBe(2);
    expect(count(`SELECT 1 FROM transactions WHERE account_id = ${acct("Fidelity Brokerage")}`)).toBe(0);
  });

  it("Safe to spend on, and 12+ completed months for Comparisons", () => {
    expect(one("SELECT safe_to_spend_enabled FROM app_settings WHERE id = 1")).toBe(1);
    expect(count("SELECT DISTINCT substr(date, 1, 7) FROM transactions WHERE CAST(amount AS REAL) < 0 AND category <> 'Transfer' AND date < '2026-11-01'")).toBeGreaterThanOrEqual(12);
  });

  it("Settings: a rule", () => {
    expect(count("SELECT 1 FROM rules WHERE pattern = 'Shell Oil'")).toBe(1);
    expect(count("SELECT 1 FROM rules WHERE pattern LIKE '%Ferrywood%'")).toBe(0); // left for the rules walk-through
  });

  it("no stored balance override, so every balance is its own rows", () => {
    expect(count("SELECT 1 FROM balance_resets")).toBe(0);
  });
});
