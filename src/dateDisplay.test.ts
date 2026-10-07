// One date format (1.3.0): lists show "Oct 4" (or "Oct 4, 2025" for another year) through
// formatDisplayDate, and every date field is the shared DateField. This keeps a stored "2026-10-04"
// from slipping back onto the screen through a new raw `{t.date}` or a bare `<input type="date">`.
// Files the app writes (exports, backups) keep the stored form; those come from the Rust side.
import { readdirSync, readFileSync, statSync } from "node:fs";
import { join, relative } from "node:path";
import { describe, expect, it } from "vitest";

const SRC = join(__dirname);

/** Mobile files that render inside the desktop app (Settings > Mobile snapshots, the pairing prompt). */
const DESKTOP_MOBILE = new Set(["MobileSettings.tsx", "MobileSetupWizard.tsx", "MobilePairingPrompt.tsx"]);

function files(dir: string): string[] {
  return readdirSync(dir).flatMap((name) => {
    const path = join(dir, name);
    if (statSync(path).isDirectory()) return files(path);
    if (!/\.tsx?$/.test(name) || /\.test\.tsx?$/.test(name)) return [];
    // The phone viewer is its own app; the mobile screens that run inside the desktop app are checked.
    if (/^(Mobile|mobile)/.test(name) && !DESKTOP_MOBILE.has(name)) return [];
    return [path];
  });
}

const sources = files(SRC).map((path) => ({ rel: relative(SRC, path).replace(/\\/g, "/"), text: readFileSync(path, "utf8") }));

const DATE_FIELDS = "date|next_date|valued_on|target_date|payoff_date|checkpoint_date|statement_date|payment_source_date|created_at|measuredOn|confirmedOn";
const FIELD = String.raw`[a-zA-Z_][a-zA-Z_.?!]*\.(${DATE_FIELDS})\s*`;

/** `{t.date}`, `${r.next_date}`, `{row.target_date ?? ""}`: a stored date as the whole expression, or the
 * left side of its `??`. Not a prop (`targetDate={b.target_date}` passes the stored date on). */
const PLAIN = new RegExp(String.raw`(?<!=)\{\s*${FIELD}(\}|\?\?)`);

/** A stored date as a ternary branch: `{lastRec ? lastRec.statement_date : "Never"}`, `{x ? "—" : t.date}`.
 * A ternary's `:` has a space before it; an object key's (`{ value: t.date }`) doesn't, so object
 * literals pass. A date passed into a call (`formatDisplayDate(x.date)`) is followed by `)`, so it passes. */
const BRANCH = new RegExp(String.raw`(\?|\s:)\s*${FIELD}(\?\?|\s:|\})`);

/** React keys, id-building and data-* attributes (for tests and code, never shown). */
const KEYED = new RegExp(String.raw`key=\{|\$\{[^}]*\}-|data-[\w-]+=\{[^}]*\.(${DATE_FIELDS})\b`);

/** Every line matching `re`, as "file:line: text". The checks read one line at a time, so a ternary or
 * `??` split across lines (`{x\n ? x.date\n : "—"}`) is not caught; keep such displays on one line or
 * pass the date through formatDisplayDate. */
function hits(re: RegExp, skip: (rel: string) => boolean = () => false): string[] {
  return sources
    .filter((s) => !skip(s.rel))
    .flatMap((s) => s.text.split("\n").flatMap((line, i) => (re.test(line) ? [`${s.rel}:${i + 1}: ${line.trim()}`] : [])));
}

describe("one date format", () => {
  it("scans the app's components", () => {
    expect(sources.some((s) => s.rel === "LedgerTable.tsx")).toBe(true);
    expect(sources.some((s) => s.rel === "comparisons/AmountEditor.tsx")).toBe(true);
  });

  it("uses DateField for every date input", () => {
    expect(hits(/type=["']date["']/, (rel) => rel === "DateField.tsx")).toEqual([]);
  });

  it("never puts a stored date on screen as it is", () => {
    expect(hits(PLAIN).filter((line) => !KEYED.test(line))).toEqual([]);
  });

  it("never puts a stored date on screen through a ternary branch", () => {
    expect(hits(BRANCH).filter((line) => !KEYED.test(line))).toEqual([]);
  });

  it("catches what it is for, and leaves helpers, props and object literals alone", () => {
    expect(PLAIN.test(`<td>{t.date}</td>`)).toBe(true);
    expect(PLAIN.test("`due ${r.next_date}`")).toBe(true);
    expect(PLAIN.test(`<td>{row.target_date ?? ""}</td>`)).toBe(true);
    expect(BRANCH.test(`{lastRec ? lastRec.statement_date : "Never"}`)).toBe(true);
    expect(BRANCH.test(`{x ? "—" : t.date}`)).toBe(true);
    expect(BRANCH.test("{p ? `on ${p.date}` : null}")).toBe(false); // the template form is PLAIN's
    expect(PLAIN.test("{p ? `on ${p.date}` : null}")).toBe(true);

    expect(PLAIN.test(`<GoalPlanLines targetDate={b.target_date} />`)).toBe(false);
    expect(BRANCH.test(`setEditingDate({ id: t.id, value: t.date })`)).toBe(false);
    expect(BRANCH.test(`{lastRec ? formatDisplayDate(lastRec.statement_date) : "Never"}`)).toBe(false);
    expect(PLAIN.test(`<td>{formatDisplayDate(t.date)}</td>`)).toBe(false);
    expect(BRANCH.test(`const date = value?.measuredOn ?? toLocalIsoDate();`)).toBe(false);
    expect(KEYED.test(`<div data-last-reconciled={lastRec ? lastRec.statement_date : ""}>`)).toBe(true);
  });

  it("doesn't build its own written-out dates", () => {
    expect(hits(/toLocaleDateString\([^)]*day:\s*"numeric"/)).toEqual([]);
  });

  // A date through the computer's own settings reads "10/6/2026, 5:21:38 PM" (or another country's
  // order). Dates go through format.ts; the only locale formatting left is month names ("October")
  // and digit grouping, both with the locale named so every computer shows the same thing.
  it("never formats with the computer's own locale settings", () => {
    expect(hits(/\.toLocale(Date|Time)?String\(\s*(\)|undefined)/)).toEqual([]);
  });

  it("names the locale for month names and never asks for a time", () => {
    expect(hits(/\.toLocaleDateString\((?!"en-US")/)).toEqual([]);
    expect(hits(/\.toLocaleTimeString\(/)).toEqual([]);
  });

  it("never turns a date into text with toLocaleString", () => {
    expect(hits(/(new Date\([^)]*\)|\b\w*(date|Date|time|Time|stamp|Stamp|when|When))\.toLocaleString\(/)).toEqual([]);
  });

  it("checks the mobile screens that run inside the desktop app", () => {
    expect(sources.some((s) => s.rel === "MobileSettings.tsx")).toBe(true);
    expect(sources.some((s) => s.rel === "MobileViewer.tsx")).toBe(false);
  });
});
