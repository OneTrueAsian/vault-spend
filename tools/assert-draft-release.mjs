// Release-windows.yml: checks the GitHub release list before and after every step that can change a release, so a release this workflow
// creates stays a draft and can never become the "latest release" that installed apps look at.
//   --mode test        a reserved test tag (v1.3.90 to v1.3.99): the draft is also a prerelease.
//   --mode production  a normal stable tag: the draft is not a prerelease, and must be newer than the previous published release.
//   --stage before     the tag has no release yet, or only an empty draft (nothing already uploaded is ever replaced).
//   --stage after      the tag has exactly one release and it is still a draft.
//   --previous <tag>   the newest published release, read once at the start of the run. It must still be the newest published one.
//   --allow-older      recovery of an older tag: skip the "newer than previous" rule.
// Usage: gh api --paginate repos/OWNER/REPO/releases --jq '.[] | {id,tag_name,draft,prerelease,assets:[.assets[].name]}' | node tools/assert-draft-release.mjs <tag> --mode ... --stage ... --previous <tag>
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

export const TEST_TAG = /^v1\.3\.9[0-9]$/;
export const STABLE_TAG = /^v(0|[1-9][0-9]*)\.(0|[1-9][0-9]*)\.(0|[1-9][0-9]*)$/;

const parts = tag => tag.slice(1).split(".").map(Number);
const compare = (a, b) => { const [x, y] = [parts(a), parts(b)]; return x[0] - y[0] || x[1] - y[1] || x[2] - y[2]; };

/** The newest release that installed apps can see: published, not a draft, not a prerelease. Chosen by version, not by list order. */
export function newestPublishedTag(releases) {
  const tags = releases.filter(r => r.draft === false && r.prerelease === false && STABLE_TAG.test(r.tag_name ?? "")).map(r => r.tag_name);
  return tags.sort(compare).pop();
}

/** listing: one JSON release per line. Returns the reasons to refuse; empty means the release state is safe. */
export function checkDraftRelease(listing, tag, { mode, stage, previous, allowOlder = false } = {}) {
  if (mode !== "test" && mode !== "production") return [`Unknown mode ${mode}: use test or production.`];
  if (stage !== "before" && stage !== "after") return [`Unknown stage ${stage}: use before or after.`];
  if (mode === "test" && !TEST_TAG.test(tag)) return [`${tag} is not a reserved test tag.`];
  if (mode === "production" && !STABLE_TAG.test(tag)) return [`${tag} is not a stable release tag.`];
  if (mode === "production" && TEST_TAG.test(tag)) return [`${tag} is a reserved test tag and cannot be a production release.`];
  const releases = [];
  for (const line of listing.split(/\r?\n/).filter(l => l.trim())) {
    try { releases.push(JSON.parse(line)); } catch { return ["The release listing is unreadable."]; }
  }
  const problems = [], mine = releases.filter(r => r.tag_name === tag);
  if (!previous) problems.push("The previous published release (previous) is required.");
  else if (TEST_TAG.test(previous)) problems.push(`The previous release ${previous} is a reserved test tag, not a production release.`);
  else if (!STABLE_TAG.test(previous)) problems.push(`The previous release ${previous} is not a stable release tag.`);
  else {
    const newest = newestPublishedTag(releases);
    if (newest !== previous) problems.push(`The newest published release is ${newest ?? "none"}, not ${previous}.`);
    if (mode === "production" && !allowOlder && compare(tag, previous) <= 0) problems.push(`The release ${tag} must be newer than the previous published release ${previous}.`);
  }
  for (const r of releases) if (r.draft === false && TEST_TAG.test(r.tag_name ?? "")) problems.push(`Reserved test tag release ${r.tag_name} is published.`);
  if (stage === "after") {
    if (mine.length !== 1) problems.push(`Expected exactly one release for ${tag}, found ${mine.length}.`);
    else {
      if (mine[0].draft !== true) problems.push(`The ${tag} release is not a draft.`);
      if (mine[0].prerelease !== (mode === "test")) problems.push(`The ${tag} release ${mode === "test" ? "is not marked prerelease" : "is marked prerelease"}.`);
    }
  } else if (mine.length > 1) problems.push(`There is more than one release for ${tag}.`);
  else if (mine.length === 1) {
    if (mine[0].draft !== true) problems.push(`The ${tag} release is already published, not a draft.`);
    else if (!Array.isArray(mine[0].assets)) problems.push(`The listing has no asset list for ${tag}.`);
    else if (mine[0].assets.length) problems.push(`The ${tag} draft already holds ${mine[0].assets.length} file${mine[0].assets.length === 1 ? "" : "s"}; refusing to replace them. Delete that unpublished draft to start again.`);
  }
  return problems;
}

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  const args = process.argv.slice(2), tag = args[0] ?? "", option = name => { const at = args.indexOf(name); return at < 0 ? undefined : args[at + 1]; };
  const options = { mode: option("--mode"), stage: option("--stage"), previous: option("--previous"), allowOlder: args.includes("--allow-older") };
  const problems = checkDraftRelease(fs.readFileSync(0, "utf8"), tag, options);
  if (problems.length) { for (const p of problems) console.error(`Release check failed: ${p}`); process.exit(1); }
  console.log(`${tag} (${options.mode}, ${options.stage}): release state is safe; newest published release is ${options.previous}.`);
}
