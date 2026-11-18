import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { execFileSync, spawnSync } from "node:child_process";
import { afterAll, describe, expect, it } from "vitest";
import { seedMainHousehold } from "./index.mjs";

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
