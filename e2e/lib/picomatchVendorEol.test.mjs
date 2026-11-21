// tools/picomatch-security.test.mjs compares the installed picomatch with tools/vendor/picomatch byte for byte. npm installs the
// indexed (LF) bytes, so a CRLF checkout of the vendored copy always failed that check (VS-70). The vendored files must be checked
// out byte-exact on every machine.
import { execFileSync } from "node:child_process";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { afterEach, describe, expect, it } from "vitest";

const repoRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "../..");
let outDir;
afterEach(() => { if (outDir) fs.rmSync(outDir, { recursive: true, force: true }); });

describe("vendored picomatch checkout", () => {
  it("checks tools/vendor/picomatch out with the same bytes as the index, so the installed copy matches it", () => {
    outDir = fs.mkdtempSync(path.join(os.tmpdir(), "vs-picomatch-eol-"));
    const files = execFileSync("git", ["ls-files", "tools/vendor/picomatch"], { cwd: repoRoot, encoding: "utf8" }).split("\n").filter(Boolean);
    expect(files.length).toBeGreaterThan(0);
    // checkout-index applies this machine's real checkout conversion (core.autocrlf, .gitattributes) to the indexed files.
    execFileSync("git", ["checkout-index", `--prefix=${outDir.replace(/\\/g, "/")}/`, "--", ...files], { cwd: repoRoot });
    for (const file of files) {
      const indexed = execFileSync("git", ["cat-file", "blob", `:${file}`], { cwd: repoRoot });
      expect(fs.readFileSync(path.join(outDir, file)).equals(indexed), file).toBe(true);
    }
  });
});
