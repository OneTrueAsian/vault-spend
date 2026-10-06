// Everything Vault Spend says is written for people who are new to money terms (owner, 2026-10-01).
// App words like "tracked" ("your tracked accounts") and "published" ("the published figure") read
// as jargon, so no on-screen text may use them. Comments and code names (`trackedValue`) are fine;
// this strips comments and only matches the whole words.
import { readdirSync, readFileSync, statSync } from "node:fs";
import { join, relative } from "node:path";
import { describe, expect, it } from "vitest";

const SRC = join(__dirname);
const BANNED = /\b(tracked|published)\b/i;

function sourceFiles(dir: string): string[] {
  return readdirSync(dir).flatMap((name) => {
    const path = join(dir, name);
    if (statSync(path).isDirectory()) return sourceFiles(path);
    if (!/\.(ts|tsx)$/.test(name) || /\.test\.(ts|tsx)$/.test(name) || /testFixtures|TestUtils/.test(name)) return [];
    return [path];
  });
}

/** The file with block and line comments blanked out, line numbers kept. */
function withoutComments(text: string): string[] {
  const noBlocks = text.replace(/\/\*[\s\S]*?\*\//g, (block) => block.replace(/[^\n]/g, " "));
  return noBlocks.split(/\r?\n/).map((line) => line.replace(/(^|[^:"'`])\/\/.*$/, "$1"));
}

describe("plain-language copy", () => {
  it("never says tracked or published on screen", () => {
    const hits: string[] = [];
    for (const file of sourceFiles(SRC)) {
      withoutComments(readFileSync(file, "utf8")).forEach((line, i) => {
        if (BANNED.test(line)) hits.push(`${relative(SRC, file)}:${i + 1}: ${line.trim()}`);
      });
    }
    expect(hits).toEqual([]);
  });

  // "Convention" is a word for people who already know the rules; say what the rule is instead
  // (Task 16 sweep: Help and the import sign question both said "Vault Spend's convention").
  it("never says convention on screen", () => {
    const hits: string[] = [];
    for (const file of sourceFiles(SRC).filter((f) => !f.endsWith("changelog.ts"))) {
      withoutComments(readFileSync(file, "utf8")).forEach((line, i) => {
        if (/\bconvention\b/i.test(line)) hits.push(`${relative(SRC, file)}:${i + 1}: ${line.trim()}`);
      });
    }
    expect(hits).toEqual([]);
  });

  // Help and page subtitles name things the way the screens do (UI review, 2026-10-04): Accounts
  // says "What you own" / "What you owe", the Dashboard card is "To do", and "sinking fund" is a
  // term most people don't know. Help's search keywords may still list it (a lone quoted string
  // in a `tags` list), so someone who knows the word can find the topic.
  it("uses the screens' own names, not old or technical ones", () => {
    const OLD = /\b(Total Assets|Total Liabilities|Needs a look|[Ss]inking[- ][Ff]unds?)\b/;
    const searchKeyword = /^\s*("[^"]*",?\s*)+$|\btags:\s*\[/;
    const hits: string[] = [];
    // What's new describes past releases in the names they had then.
    for (const file of sourceFiles(SRC).filter((f) => !f.endsWith("changelog.ts"))) {
      withoutComments(readFileSync(file, "utf8")).forEach((line, i) => {
        if (OLD.test(line) && !searchKeyword.test(line)) hits.push(`${relative(SRC, file)}:${i + 1}: ${line.trim()}`);
      });
    }
    expect(hits).toEqual([]);
  });
});
