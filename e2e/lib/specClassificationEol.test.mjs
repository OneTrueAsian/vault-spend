// `node e2e/classify-specs.mjs --check` compares e2e/spec-classification.json with the LF text it generates, byte for byte. A CRLF
// checkout therefore always reported "out of date". Checking the file out in LF on every machine keeps --check meaningful.
import { execFileSync } from "node:child_process";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { afterEach, describe, expect, it } from "vitest";

const repoRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "../..");
let outDir;
afterEach(() => { if (outDir) fs.rmSync(outDir, { recursive: true, force: true }); });

describe("spec classification checkout", () => {
  it("checks e2e/spec-classification.json out with LF line endings, matching what classify-specs.mjs writes", () => {
    outDir = fs.mkdtempSync(path.join(os.tmpdir(), "vs-classification-eol-"));
    // checkout-index applies this machine's real checkout conversion (core.autocrlf, .gitattributes) to the indexed file.
    execFileSync("git", ["checkout-index", `--prefix=${outDir.replace(/\\/g, "/")}/`, "--", "e2e/spec-classification.json"], { cwd: repoRoot });
    const bytes = fs.readFileSync(path.join(outDir, "e2e", "spec-classification.json"));
    expect(bytes.includes(13)).toBe(false);
  });
});
