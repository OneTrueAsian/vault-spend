// VS-135: the GitHub release page gets its notes from the same changelog entry the app's What's New shows, so a release cannot go out without them.
import { test } from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { spawnSync } from "node:child_process";
import { CHANGELOG, versionsNewestFirst } from "../src/shared/lib/changelog.ts";
import { releaseNotes } from "./release-notes.mjs";

const INSTALL = "## Install notes\n\nBoth builds are unsigned.";
const changelog = {
  "2.0.0": { "New features": ["Alpha thing.", "Beta thing."], Enhancements: [], "Bug fixes": ["Gamma fix."] },
  "1.0.0": ["An older flat note.", "Another one."],
  "0.0.1": { Enhancements: [] },
};
const notes = version => releaseNotes(version, { changelog, installNotes: INSTALL });
const run = (args, env = {}) => spawnSync(process.execPath, ["tools/release-notes.mjs", ...args], { encoding: "utf8", env: { ...process.env, ...env } });

test("the page body is each group in the order written, as bullets, then the install notes", () => {
  assert.equal(notes("2.0.0"), "## New features\n\n- Alpha thing.\n- Beta thing.\n\n## Bug fixes\n\n- Gamma fix.\n\n" + INSTALL);
});

test("an older flat list becomes one What's new group", () => {
  assert.equal(notes("1.0.0"), "## What's new\n\n- An older flat note.\n- Another one.\n\n" + INSTALL);
});

test("a version with no entry, no notes in it, or a malformed number is refused, never released with an empty page", () => {
  assert.throws(() => notes("9.9.9"), /no release notes for 9\.9\.9.*changelog\.ts/);
  assert.throws(() => notes("0.0.1"), /no release notes for 0\.0\.1/);
  for (const bad of ["", "1.3", "v1.3.5", "1.3.5-rc1", "latest"]) assert.throws(() => notes(bad), /not a release version/, bad);
});

test("every version the app already shows has notes the page can use", () => {
  for (const version of versionsNewestFirst()) {
    const body = releaseNotes(version, { changelog: CHANGELOG, installNotes: INSTALL });
    assert.match(body, /^## .+\n\n- /, version);
    assert.ok(body.endsWith(INSTALL), version);
  }
});

test("the install notes come from the checked-in file, the same text as the earlier release pages", () => {
  const body = releaseNotes("1.3.5");
  const file = fs.readFileSync(new URL("./release-install-notes.md", import.meta.url), "utf8").replace(/\r\n/g, "\n").trim();
  assert.match(file, /^## Install notes\n/);
  assert.ok(body.replace(/\r\n/g, "\n").endsWith(file));
});

test("the command prints the body, and --check says what it found without printing it", () => {
  const body = run(["1.3.5"]);
  assert.equal(body.status, 0, body.stderr);
  assert.match(body.stdout, /^## New features\n/);
  const check = run(["1.3.5", "--check"]);
  assert.equal(check.status, 0, check.stderr);
  assert.match(check.stdout, /^Release notes for 1\.3\.5: \d+ groups?, \d+ notes\./);
  assert.doesNotMatch(check.stdout, /Watch tiles/);
});

test("the command fails with a plain message when the version has no notes, and when no version is given", () => {
  const missing = run(["9.9.9", "--check"]);
  assert.notEqual(missing.status, 0);
  assert.match(missing.stderr, /no release notes for 9\.9\.9/);
  assert.notEqual(run([]).status, 0);
});

test("--github-output writes a multi-line step output that reads back as exactly the body", () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "release-notes-"));
  const out = path.join(dir, "github-output");
  fs.writeFileSync(out, "previous=v1.0.0\n");
  const result = run(["1.3.5", "--github-output", "notes"], { GITHUB_OUTPUT: out });
  assert.equal(result.status, 0, result.stderr);
  const text = fs.readFileSync(out, "utf8").replace(/\r\n/g, "\n");
  assert.ok(text.startsWith("previous=v1.0.0\n"), "existing outputs are kept");
  const match = text.match(/^notes<<(\S+)\n([\s\S]*)\n\1\n$/m);
  assert.ok(match, "a heredoc-style output");
  assert.equal(match[2], run(["1.3.5"]).stdout.replace(/\r\n/g, "\n").replace(/\n$/, ""));
  assert.ok(!match[2].includes(match[1]), "the delimiter never occurs in the body");
  assert.notEqual(run(["1.3.5", "--github-output", "notes"], { GITHUB_OUTPUT: "" }).status, 0, "no output file is an error, not a silent skip");
  fs.rmSync(dir, { recursive: true, force: true });
});
