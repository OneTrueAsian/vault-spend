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
});
