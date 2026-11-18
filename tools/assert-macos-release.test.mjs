import { test } from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { spawnSync } from "node:child_process";
import { checkMacosRelease, windowsAssets, macosAssets, MACOS_BUNDLE_ASSET } from "./assert-macos-release.mjs";

const TAG = "v1.3.3", V = "1.3.3", TEST_TAG = "v1.3.92";
const SOURCE = "a".repeat(40), OTHER = "b".repeat(40);
const WINDOWS = windowsAssets(V), DMG = macosAssets(V);
const row = (over = {}) => JSON.stringify({ id: 10, tag_name: TAG, draft: true, prerelease: false, target_commitish: SOURCE, assets: [...WINDOWS], ...over });
const published = (tag, id = 2, assets = ["Vault.Spend.exe"]) => JSON.stringify({ id, tag_name: tag, draft: false, prerelease: false, target_commitish: "main", assets });
const lines = (...rows) => rows.join("\n") + "\n";
const before = { stage: "before", previous: "v1.3.2", sourceSha: SOURCE };
const packaged = { stage: "packaged", previous: "v1.3.2", releaseId: 10, state: "draft" };
const signed = { ...packaged, stage: "signed" };
const problems = (listing, tag, options) => checkMacosRelease(listing, tag, options).problems.join(" | ");

test("the asset names follow the signing tool: two Windows installers with their manifests and signatures, one universal DMG with its pair", () => {
  assert.deepEqual(WINDOWS, [`Vault.Spend_${V}_x64-setup.exe`, `Vault.Spend_${V}_x64_en-US.msi`].flatMap(n => [n, `${n}.manifest.json`, `${n}.signature.json`]));
  assert.deepEqual(DMG, [`Vault.Spend_${V}_universal.dmg`, `Vault.Spend_${V}_universal.dmg.manifest.json`, `Vault.Spend_${V}_universal.dmg.signature.json`]);
});

test("before: an existing, complete, signed Windows draft is the one release macOS may join", () => {
  const result = checkMacosRelease(lines(row(), published("v1.3.2")), TAG, before);
  assert.deepEqual(result.problems, []);
  assert.deepEqual(result.release, { id: 10, state: "draft", prerelease: false });
});

test("before: macOS never creates a release, so a missing release fails and says the Windows draft must come first", () => {
  assert.match(problems(lines(published("v1.3.2")), TAG, before), /no release.*Windows draft/i);
  assert.match(problems("", TAG, before), /no release/i);
  assert.equal(checkMacosRelease(lines(published("v1.3.2")), TAG, before).release, undefined);
});

test("before: more than one release for the tag is refused (a race may already have made a second one)", () => {
  assert.match(problems(lines(row(), row({ id: 11 }), published("v1.3.2")), TAG, before), /more than one/);
});

test("before: a draft is joined only after Windows finished, signing included: every missing Windows file is named and refused", () => {
  for (const missing of WINDOWS) {
    const reasons = problems(lines(row({ assets: WINDOWS.filter(n => n !== missing) }), published("v1.3.2")), TAG, before);
    assert.ok(reasons.includes(missing), `${missing} is named`);
  }
  assert.match(problems(lines(row({ assets: [] }), published("v1.3.2")), TAG, before), /Windows/);
  assert.match(problems(lines(row({ assets: undefined }), published("v1.3.2")), TAG, before), /asset list/);
});

test("before: a draft that already holds macOS files is refused, never replaced", () => {
  for (const name of DMG) assert.match(problems(lines(row({ assets: [...WINDOWS, name] }), published("v1.3.2")), TAG, before), /already holds.*macOS|macOS.*already/i, name);
});

test("the action also uploads the unversioned app archive (as it did for v1.3.1 and v1.3.2): expected after packaging, never allowed to be replaced", () => {
  assert.equal(MACOS_BUNDLE_ASSET, "Vault.Spend_universal.app.tar.gz");
  const withBundle = [...WINDOWS, DMG[0], MACOS_BUNDLE_ASSET];
  assert.deepEqual(checkMacosRelease(lines(row({ assets: withBundle }), published("v1.3.2")), TAG, packaged).problems, [], "packaged");
  assert.deepEqual(checkMacosRelease(lines(row({ assets: [...WINDOWS, ...DMG, MACOS_BUNDLE_ASSET] }), published("v1.3.2")), TAG, signed).problems, [], "signed");
  assert.deepEqual(checkMacosRelease(lines(row({ assets: [...WINDOWS, DMG[0]] }), published("v1.3.2")), TAG, packaged).problems, [], "the archive is not required");
  assert.match(problems(lines(row({ assets: [...WINDOWS, MACOS_BUNDLE_ASSET] }), published("v1.3.2")), TAG, before), /already holds.*Vault\.Spend_universal\.app\.tar\.gz/);
});

test("before: a draft must have been built from the commit this macOS run checked out", () => {
  assert.match(problems(lines(row({ target_commitish: OTHER }), published("v1.3.2")), TAG, before), /built from commit b+.*checked out.*a+|different commit/i);
  assert.match(problems(lines(row({ target_commitish: "main" }), published("v1.3.2")), TAG, before), /commit/i);
  assert.match(problems(lines(row({ target_commitish: undefined }), published("v1.3.2")), TAG, before), /commit/i);
  assert.match(problems(lines(row(), published("v1.3.2")), TAG, { ...before, sourceSha: undefined }), /source commit|sourceSha|source-sha/i);
  assert.match(problems(lines(row(), published("v1.3.2")), TAG, { ...before, sourceSha: "main" }), /source commit|source-sha/i);
});

test("before: the draft keeps its classification: a normal draft is not a prerelease, a reserved test draft is", () => {
  assert.match(problems(lines(row({ prerelease: true }), published("v1.3.2")), TAG, before), /prerelease/);
  const testDraft = (over = {}) => row({ tag_name: TEST_TAG, prerelease: true, assets: windowsAssets("1.3.92"), ...over });
  assert.deepEqual(checkMacosRelease(lines(testDraft(), published("v1.3.2")), TEST_TAG, before).problems, []);
  assert.deepEqual(checkMacosRelease(lines(testDraft(), published("v1.3.2")), TEST_TAG, before).release, { id: 10, state: "draft", prerelease: true });
  assert.match(problems(lines(testDraft({ prerelease: false }), published("v1.3.2")), TEST_TAG, before), /prerelease/);
});

test("a reserved test tag is only ever a draft: a published one is refused, and none may be public anywhere", () => {
  assert.match(problems(lines(row({ tag_name: TEST_TAG, draft: false, prerelease: true, assets: windowsAssets("1.3.92") }), published("v1.3.2")), TEST_TAG, before), /published|test/i);
  assert.match(problems(lines(row(), published("v1.3.2"), published("v1.3.91", 5)), TAG, before), /v1\.3\.91.*published/);
});

test("before: a published release that lacks macOS files can still receive them (nothing is created or hidden), but existing macOS files are never replaced", () => {
  const result = checkMacosRelease(lines(published(TAG, 10, ["Vault.Spend.exe"]), published("v1.3.2", 2)), TAG, { ...before, previous: TAG });
  assert.deepEqual(result.problems, []);
  assert.deepEqual(result.release, { id: 10, state: "published", prerelease: false });
  // Owner decision (6 Nov 2026): a published release's macOS files are never replaced either.
  for (const name of [...DMG, MACOS_BUNDLE_ASSET]) assert.match(problems(lines(published(TAG, 10, ["Vault.Spend.exe", name])), TAG, { ...before, previous: TAG }), /already holds.*macOS/i, name);
  assert.match(problems(lines(JSON.stringify({ id: 10, tag_name: TAG, draft: false, prerelease: true, assets: [] }), published("v1.3.2")), TAG, before), /prerelease/);
});

test("the previous published release is verified, not assumed", () => {
  const listing = lines(row(), published("v1.3.2"), published("v1.3.1", 3));
  assert.match(problems(listing, TAG, { ...before, previous: undefined }), /previous/);
  assert.match(problems(listing, TAG, { ...before, previous: "v1.3.1" }), /newest published release is v1\.3\.2, not v1\.3\.1/);
  assert.match(problems(listing, TAG, { ...before, previous: "v1.3.91" }), /reserved test tag/);
  assert.match(problems(listing, TAG, { ...before, previous: "latest" }), /not a stable release tag/);
});

test("tags must be exact stable tags, and unknown or missing stages fail", () => {
  for (const tag of ["latest", "v1.3", "1.3.3", "v1.3.3-rc1", ""]) assert.match(problems(lines(row({ tag_name: tag })), tag, before), /not a stable release tag/, tag);
  assert.match(problems(lines(row()), TAG, { ...before, stage: "later" }), /stage/);
  assert.match(problems(lines(row()), TAG, {}), /stage/);
  assert.match(problems("{oops\n", TAG, before), /unreadable/);
});

test("packaged: the same draft, still private, holds Windows' files plus exactly the universal DMG", () => {
  assert.deepEqual(checkMacosRelease(lines(row({ assets: [...WINDOWS, DMG[0]] }), published("v1.3.2")), TAG, packaged).problems, []);
});

test("packaged: a missing DMG, a missing Windows file, or an unexpected extra file fails", () => {
  assert.match(problems(lines(row(), published("v1.3.2")), TAG, packaged), new RegExp(DMG[0].replace(/\./g, "\\.")));
  assert.match(problems(lines(row({ assets: [...WINDOWS.slice(1), DMG[0]] }), published("v1.3.2")), TAG, packaged), new RegExp(WINDOWS[0].replace(/\./g, "\\.")));
  assert.match(problems(lines(row({ assets: [...WINDOWS, DMG[0], "latest.json"] }), published("v1.3.2")), TAG, packaged), /latest\.json/);
  assert.match(problems(lines(row({ assets: [...WINDOWS, DMG[0], DMG[1]] }), published("v1.3.2")), TAG, packaged), /unexpected/);
});

test("packaged: a different release id (a second release was created), a published draft, or a second release fails", () => {
  const ok = [...WINDOWS, DMG[0]];
  assert.match(problems(lines(row({ id: 99, assets: ok }), published("v1.3.2")), TAG, packaged), /release id|different release/i);
  assert.match(problems(lines(row({ draft: false, assets: ok }), published("v1.3.2")), TAG, packaged), /no longer a draft|state/i);
  assert.match(problems(lines(row({ assets: ok }), row({ id: 11, draft: false, assets: [DMG[0]] }), published("v1.3.2")), TAG, packaged), /more than one/);
  assert.match(problems(lines(row({ assets: ok, prerelease: true }), published("v1.3.2")), TAG, packaged), /prerelease/);
});

test("packaged and signed: the release that was seen at the start must be named, and the newest published release must be unchanged", () => {
  const ok = lines(row({ assets: [...WINDOWS, DMG[0]] }), published("v1.3.2"));
  assert.match(problems(ok, TAG, { stage: "packaged", previous: "v1.3.2", state: "draft" }), /release id/);
  assert.match(problems(ok, TAG, { stage: "packaged", previous: "v1.3.2", releaseId: 10 }), /state/);
  assert.match(problems(ok, TAG, { ...packaged, state: "other" }), /state/);
  assert.match(problems(lines(row({ assets: [...WINDOWS, DMG[0]] }), published("v1.3.2"), published("v1.3.4", 7)), TAG, packaged), /newest published release is v1\.3\.4, not v1\.3\.2/);
});

test("signed: Windows' files, the DMG and its manifest and signature, nothing else", () => {
  assert.deepEqual(checkMacosRelease(lines(row({ assets: [...WINDOWS, ...DMG] }), published("v1.3.2")), TAG, signed).problems, []);
  assert.match(problems(lines(row({ assets: [...WINDOWS, DMG[0], DMG[1]] }), published("v1.3.2")), TAG, signed), /signature\.json/);
  assert.match(problems(lines(row({ assets: [...WINDOWS, ...DMG, "extra.txt"] }), published("v1.3.2")), TAG, signed), /extra\.txt/);
});

test("a release that was public at the start stays public, and a draft cannot turn public mid-run unnoticed", () => {
  const publicRun = { stage: "packaged", previous: TAG, releaseId: 10, state: "published" };
  assert.deepEqual(checkMacosRelease(lines(published(TAG, 10, ["Vault.Spend.exe", DMG[0]])), TAG, publicRun).problems, []);
  assert.match(problems(lines(row({ assets: [...WINDOWS, DMG[0]] })), TAG, { ...publicRun, previous: undefined }), /previous/);
  assert.match(problems(lines(row({ assets: [DMG[0]] }), published("v1.3.2")), TAG, { ...publicRun, previous: "v1.3.2" }), /state|published/i);
});

test("the command line reads stdin, writes the release facts for later steps, and exits non-zero on a refusal", () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "macos-release-"));
  try {
    const run = (args, input, env = {}) => spawnSync(process.execPath, ["tools/assert-macos-release.mjs", ...args], { encoding: "utf8", input, env: { ...process.env, ...env } });
    const output = path.join(dir, "output.txt");
    const good = lines(row(), published("v1.3.2"));
    const ok = run([TAG, "--stage", "before", "--previous", "v1.3.2", "--source-sha", SOURCE], good, { GITHUB_OUTPUT: output });
    assert.equal(ok.status, 0, ok.stderr);
    assert.equal(fs.readFileSync(output, "utf8"), "release_id=10\nstate=draft\nprerelease=false\n");
    assert.notEqual(run([TAG, "--stage", "before", "--previous", "v1.3.2"], lines(published("v1.3.2")), { GITHUB_OUTPUT: output }).status, 0);
    assert.match(run([TAG, "--stage", "before", "--previous", "v1.3.2"], lines(published("v1.3.2"))).stderr, /Release check failed/);
    assert.notEqual(run([TAG, "--stage", "before", "--source-sha", SOURCE], good).status, 0, "no previous release given");
    assert.notEqual(run([TAG, "--stage", "before", "--previous", "v1.3.2"], good).status, 0, "no source commit given");
    const after = lines(row({ assets: [...WINDOWS, DMG[0]] }), published("v1.3.2"));
    assert.equal(run([TAG, "--stage", "packaged", "--previous", "v1.3.2", "--release-id", "10", "--state", "draft"], after).status, 0);
    assert.notEqual(run([TAG, "--stage", "packaged", "--previous", "v1.3.2", "--release-id", "11", "--state", "draft"], after).status, 0);
    assert.notEqual(run([TAG, "--stage", "packaged", "--previous", "v1.3.2"], after).status, 0, "no release id or state given");
  } finally { fs.rmSync(dir, { recursive: true, force: true }); }
});
