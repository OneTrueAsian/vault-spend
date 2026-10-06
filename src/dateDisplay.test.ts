// One date format (1.3.0): lists show "Oct 4" (or "Oct 4, 2025" for another year) through
// formatDisplayDate, and every date field is the shared DateField. This keeps a stored "2026-10-04"
// from slipping back onto the screen through a new raw `{t.date}` or a bare `<input type="date">`.
// Files the app writes (exports, backups) keep the stored form; those come from the Rust side.
import { readdirSync, readFileSync, statSync } from "node:fs";
import { join, relative } from "node:path";
import { describe, expect, it } from "vitest";

const SRC = join(__dirname);

function files(dir: string): string[] {
  return readdirSync(dir).flatMap((name) => {
    const path = join(dir, name);
    if (statSync(path).isDirectory()) return files(path);
    if (!/\.tsx?$/.test(name) || /\.test\.tsx?$/.test(name)) return [];
    if (/^(Mobile|mobile)/.test(name)) return [];
    return [path];
  });
}

const sources = files(SRC).map((path) => ({ rel: relative(SRC, path).replace(/\\/g, "/"), text: readFileSync(path, "utf8") }));

/** Every line matching `re`, as "file:line: text". */
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
    // `{t.date}`, `${r.next_date}`, `{a.valued_on}`, `{b.created_at}` … rendered without the helper
    // (a prop such as `targetDate={b.target_date}` passes the stored date on, so it is left alone).
    const raw = /(?<!=)[{]\s*[a-zA-Z_.?]*\.(date|next_date|valued_on|target_date|payoff_date|checkpoint_date|statement_date|payment_source_date|created_at|measuredOn|confirmedOn)\s*[}]/;
    const keyed = /key=\{|\$\{[^}]*\}-/; // React keys and id-building, never shown
    expect(hits(raw).filter((line) => !keyed.test(line))).toEqual([]);
  });

  it("doesn't build its own written-out dates", () => {
    expect(hits(/toLocaleDateString\([^)]*day:\s*"numeric"/)).toEqual([]);
  });
});
