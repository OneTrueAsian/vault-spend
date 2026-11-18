import { test } from "node:test";
import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { checkDraftRelease, newestPublishedTag } from "./assert-draft-release.mjs";

const row = (over = {}) => JSON.stringify({ id: 1, tag_name: "v1.3.90", draft: true, prerelease: true, assets: [], ...over });
const published = (tag, id = 2) => row({ id, tag_name: tag, draft: false, prerelease: false, assets: ["Vault.Spend.exe"] });
const lines = (...rows) => rows.join("\n") + "\n";
const prod = (over = {}) => row({ tag_name: "v1.3.3", prerelease: false, ...over });
const test_ = { mode: "test", stage: "after", previous: "v1.3.2" };
const production = { mode: "production", stage: "after", previous: "v1.3.2" };

test("test mode: one draft prerelease for a reserved test tag passes after packaging", () => {
  assert.deepEqual(checkDraftRelease(lines(row(), published("v1.3.2")), "v1.3.90", test_), []);
});

test("test mode: a published release, or one that is not marked prerelease, fails", () => {
  assert.match(checkDraftRelease(lines(row({ draft: false }), published("v1.3.2")), "v1.3.90", test_).join(), /draft/);
  assert.match(checkDraftRelease(lines(row({ prerelease: false }), published("v1.3.2")), "v1.3.90", test_).join(), /prerelease/);
});

test("production mode: one draft that is NOT a prerelease passes after packaging", () => {
  assert.deepEqual(checkDraftRelease(lines(prod(), published("v1.3.2")), "v1.3.3", production), []);
});

test("production mode: a published release, or one marked prerelease, fails", () => {
  assert.match(checkDraftRelease(lines(prod({ draft: false }), published("v1.3.2")), "v1.3.3", production).join(), /draft/);
  assert.match(checkDraftRelease(lines(prod({ prerelease: true }), published("v1.3.2")), "v1.3.3", production).join(), /prerelease/);
});

test("no release, or a duplicate release, for the tag fails after packaging", () => {
  assert.match(checkDraftRelease(lines(published("v1.3.2")), "v1.3.3", production).join(), /exactly one/);
  assert.match(checkDraftRelease(lines(prod(), prod({ id: 3 }), published("v1.3.2")), "v1.3.3", production).join(), /exactly one/);
  assert.match(checkDraftRelease("", "v1.3.3", production).join(), /exactly one/);
});

test("tags are held to their own mode: test tags are never production and production tags are never test", () => {
  assert.match(checkDraftRelease(lines(row(), published("v1.3.2")), "v1.3.90", production).join(), /reserved test tag/);
  assert.match(checkDraftRelease(lines(prod(), published("v1.3.2")), "v1.3.3", test_).join(), /not a reserved test tag/);
  assert.match(checkDraftRelease(lines(published("v1.3.2")), "latest", production).join(), /not a stable release tag/);
  assert.match(checkDraftRelease(lines(published("v1.3.2")), "v1.3", production).join(), /not a stable release tag/);
});

test("unreadable listings, and a missing or unknown mode or stage, fail", () => {
  assert.match(checkDraftRelease("{oops\n", "v1.3.3", production).join(), /unreadable/);
  assert.match(checkDraftRelease(lines(prod()), "v1.3.3", { ...production, mode: "other" }).join(), /mode/);
  assert.match(checkDraftRelease(lines(prod()), "v1.3.3", { ...production, stage: "later" }).join(), /stage/);
  assert.match(checkDraftRelease(lines(prod()), "v1.3.3", {}).join(), /mode/);
});

test("the previous published release is verified, not assumed: it must be the newest one and a real production release", () => {
  const listing = lines(prod(), published("v1.3.2"), published("v1.3.1", 3));
  assert.deepEqual(checkDraftRelease(listing, "v1.3.3", production), []);
  assert.match(checkDraftRelease(listing, "v1.3.3", { ...production, previous: "v1.3.1" }).join(), /newest published release is v1\.3\.2, not v1\.3\.1/);
  assert.match(checkDraftRelease(lines(prod()), "v1.3.3", production).join(), /newest published release is none, not v1\.3\.2/);
  assert.match(checkDraftRelease(listing, "v1.3.3", { ...production, previous: undefined }).join(), /previous/);
  assert.match(checkDraftRelease(listing, "v1.3.3", { ...production, previous: "v1.3.90" }).join(), /previous.*production|reserved test tag/);
});

test("the newest published release is chosen by version, not by listing order, and ignores drafts and prereleases", () => {
  assert.equal(newestPublishedTag([JSON.parse(published("v1.3.1", 3)), JSON.parse(published("v1.3.10", 4)), JSON.parse(published("v1.3.2"))]), "v1.3.10");
  assert.equal(newestPublishedTag([JSON.parse(row({ tag_name: "v9.9.9" })), JSON.parse(row({ tag_name: "v8.8.8", draft: false })), JSON.parse(published("v1.3.2"))]), "v1.3.2");
  assert.equal(newestPublishedTag([]), undefined);
});

test("a production release must be newer than the previous one, unless recovering an older tag", () => {
  const listing = (tag) => lines(prod({ tag_name: tag }), published("v1.3.2"));
  assert.match(checkDraftRelease(listing("v1.3.2"), "v1.3.2", production).join(), /newer than/);
  assert.match(checkDraftRelease(listing("v1.3.1"), "v1.3.1", production).join(), /newer than/);
  assert.deepEqual(checkDraftRelease(listing("v1.3.1"), "v1.3.1", { ...production, allowOlder: true }), []);
});

test("a reserved test tag must never be public, whatever the mode", () => {
  const leaked = lines(prod(), published("v1.3.2"), published("v1.3.91", 5));
  assert.match(checkDraftRelease(leaked, "v1.3.3", production).join(), /v1\.3\.91.*published|published.*v1\.3\.91/);
  assert.match(checkDraftRelease(lines(row(), published("v1.3.2"), published("v1.3.91", 5)), "v1.3.90", test_).join(), /v1\.3\.91/);
});

test("before packaging: nothing yet, or a draft with no assets, is accepted", () => {
  const before = { ...production, stage: "before" };
  assert.deepEqual(checkDraftRelease(lines(published("v1.3.2")), "v1.3.3", before), []);
  assert.deepEqual(checkDraftRelease(lines(prod(), published("v1.3.2")), "v1.3.3", before), []);
});

test("before packaging: a published release, a duplicate, or a draft that already holds files is refused, never replaced", () => {
  const before = { ...production, stage: "before" };
  assert.match(checkDraftRelease(lines(prod({ draft: false }), published("v1.3.2")), "v1.3.3", before).join(), /already published|not a draft/);
  assert.match(checkDraftRelease(lines(prod(), prod({ id: 3 }), published("v1.3.2")), "v1.3.3", before).join(), /more than one/);
  assert.match(checkDraftRelease(lines(prod({ assets: ["Vault.Spend_1.3.3_x64-setup.exe"] }), published("v1.3.2")), "v1.3.3", before).join(), /already holds 1 file/);
  assert.match(checkDraftRelease(lines(prod({ assets: undefined }), published("v1.3.2")), "v1.3.3", before).join(), /asset list/);
});

test("the command line reads the listing from stdin and exits non-zero on a refusal", () => {
  const run = (args, input) => spawnSync(process.execPath, ["tools/assert-draft-release.mjs", ...args], { encoding: "utf8", input });
  const good = lines(prod(), published("v1.3.2"));
  assert.equal(run(["v1.3.3", "--mode", "production", "--stage", "after", "--previous", "v1.3.2"], good).status, 0);
  assert.notEqual(run(["v1.3.3", "--mode", "production", "--stage", "after", "--previous", "v1.3.1"], good).status, 0);
  assert.notEqual(run(["v1.3.3", "--mode", "production", "--stage", "after"], good).status, 0, "no previous release given");
  assert.notEqual(run(["v1.3.3", "--stage", "after", "--previous", "v1.3.2"], good).status, 0, "no mode given");
  assert.equal(run(["v1.3.1", "--mode", "production", "--stage", "after", "--previous", "v1.3.2", "--allow-older"], lines(prod({ tag_name: "v1.3.1" }), published("v1.3.2"))).status, 0);
});
