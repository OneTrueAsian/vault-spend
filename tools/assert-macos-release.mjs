// build-macos.yml: macOS packaging only JOINS the shared release that the Windows workflow already built. It never creates, publishes or replaces one.
// This reads the GitHub release list before and after every step that can change the release and refuses anything else.
//   Route: taken from the tag. A reserved test tag (v1.3.90 to v1.3.99) is only ever a draft PRERELEASE; any other stable tag is a normal draft, not a prerelease.
//   --stage before    exactly one release exists for the tag (macOS never creates it). A draft must already hold Windows' complete signed set (both installers
//                     with their manifests and signatures) and no macOS file; it is never replaced. It must also have been built from the commit this
//                     checkout is at (--source-sha). A published release is the existing rerun case and is kept (its target is often a branch name).
//   --stage packaged  after tauri-action: the SAME release (id and state), Windows' files, and the universal DMG (plus the app archive tauri-action adds), nothing else.
//   --stage signed    after the signing job: the same, plus the DMG's manifest and signature.
//   --previous <tag>  the newest published release, read once at the start. It must still be the newest published one.
//   --release-id / --state   what the "before" stage found (printed to GITHUB_OUTPUT); required for the later stages.
// Usage: gh api --paginate repos/OWNER/REPO/releases --jq '.[] | {id,tag_name,draft,prerelease,assets:[.assets[].name]}' | node tools/assert-macos-release.mjs <tag> --stage ... --previous <tag>
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { TEST_TAG, STABLE_TAG, newestPublishedTag } from "./assert-draft-release.mjs";

const withPair = name => [name, `${name}.manifest.json`, `${name}.signature.json`];
/** What the Windows workflow leaves in a finished draft: both installers, each with its signed manifest and signature. */
export const windowsAssets = version => [`Vault.Spend_${version}_x64-setup.exe`, `Vault.Spend_${version}_x64_en-US.msi`].flatMap(withPair);
/** The universal DMG, then its manifest and signature (added by the protected signing job). */
export const macosAssets = version => withPair(`Vault.Spend_${version}_universal.dmg`);
/** tauri-action also uploads the app archive, with no version in its name (it is on v1.3.1 and v1.3.2). Allowed after packaging, never replaced in a draft. */
export const MACOS_BUNDLE_ASSET = "Vault.Spend_universal.app.tar.gz";

const STAGES = ["before", "packaged", "signed"];

/** listing: one JSON release per line. Returns { problems, release }; no problems means the release state is safe. */
export function checkMacosRelease(listing, tag, { stage, previous, releaseId, state, sourceSha } = {}) {
  const refuse = problem => ({ problems: [problem], release: undefined });
  if (!STAGES.includes(stage)) return refuse(`Unknown stage ${stage}: use before, packaged or signed.`);
  if (!STABLE_TAG.test(tag)) return refuse(`${tag} is not a stable release tag.`);
  const test = TEST_TAG.test(tag), version = tag.slice(1);
  const releases = [];
  for (const line of String(listing).split(/\r?\n/).filter(l => l.trim())) {
    try { releases.push(JSON.parse(line)); } catch { return refuse("The release listing is unreadable."); }
  }
  const problems = [];
  if (!previous) problems.push("The previous published release (previous) is required.");
  else if (TEST_TAG.test(previous)) problems.push(`The previous release ${previous} is a reserved test tag, not a production release.`);
  else if (!STABLE_TAG.test(previous)) problems.push(`The previous release ${previous} is not a stable release tag.`);
  else {
    const newest = newestPublishedTag(releases);
    if (newest !== previous) problems.push(`The newest published release is ${newest ?? "none"}, not ${previous}.`);
  }
  for (const r of releases) if (r.draft === false && TEST_TAG.test(r.tag_name ?? "")) problems.push(`Reserved test tag release ${r.tag_name} is published.`);

  const mine = releases.filter(r => r.tag_name === tag);
  if (mine.length === 0) {
    problems.push(`There is no release for ${tag}. macOS never creates a release: build the Windows draft for this tag first, then add macOS to it.`);
    return { problems, release: undefined };
  }
  if (mine.length > 1) { problems.push(`There is more than one release for ${tag}.`); return { problems, release: undefined }; }
  const found = mine[0], now = found.draft === true ? "draft" : "published";
  const release = { id: found.id, state: now, prerelease: test };
  if (found.prerelease !== test) problems.push(`The ${tag} release ${test ? "is not marked prerelease, but a reserved test tag must be" : "is marked prerelease, but a normal release must not be"}.`);
  if (test && now !== "draft") problems.push(`The reserved test tag ${tag} has a published release; a test release is only ever a draft.`);
  if (!Array.isArray(found.assets)) problems.push(`The listing has no asset list for ${tag}.`);

  if (stage === "before") {
    if (now === "draft" && Array.isArray(found.assets)) {
      const missing = windowsAssets(version).filter(name => !found.assets.includes(name));
      if (missing.length) problems.push(`The ${tag} draft does not yet hold Windows' complete signed set; missing: ${missing.join(", ")}. Finish the Windows draft (including its signing approval) first.`);
    }
    if (Array.isArray(found.assets)) {
      // Never replace a macOS file, in a draft or in a published release (tauri-action would silently replace a same-named file).
      const present = [...macosAssets(version), MACOS_BUNDLE_ASSET].filter(name => found.assets.includes(name));
      if (present.length) problems.push(`The ${tag} ${now === "draft" ? "draft" : "release"} already holds macOS file${present.length === 1 ? "" : "s"}: ${present.join(", ")}; refusing to replace ${present.length === 1 ? "it" : "them"}.${now === "draft" ? " Delete that unpublished macOS file to start again." : ""}`);
    }
    if (now === "draft") {
      // The Windows workflow creates the draft at the tag commit it was dispatched on (tauri-action records it as the release's target).
      // macOS must build that same commit, or the two platforms would ship different sources under one release.
      if (!/^[0-9a-f]{40}$/.test(sourceSha ?? "")) problems.push("The source commit of this checkout (source-sha) is required.");
      else if (!/^[0-9a-f]{40}$/.test(found.target_commitish ?? "")) problems.push(`The ${tag} draft does not record the commit it was built from, so macOS cannot be tied to the Windows source.`);
      else if (found.target_commitish !== sourceSha) problems.push(`The ${tag} draft was built from commit ${found.target_commitish}, but this macOS run checked out a different commit, ${sourceSha}.`);
    }
    return { problems, release };
  }

  // packaged and signed: it must still be the release seen at the start, in the state it was in.
  if (releaseId === undefined || releaseId === "" || !Number.isInteger(Number(releaseId))) problems.push("The release id seen before the build (release id) is required.");
  else if (Number(releaseId) !== found.id) problems.push(`The ${tag} release is a different release (id ${found.id}) from the one seen before the build (release id ${releaseId}).`);
  if (state !== "draft" && state !== "published") problems.push(`The state seen before the build (state) must be draft or published, not ${state ?? "missing"}.`);
  else if (state !== now) problems.push(`The ${tag} release was a ${state} release before the build but is now ${now === "draft" ? "a draft" : "published"} (state changed during the run).`);
  if (Array.isArray(found.assets)) {
    const expectedMac = stage === "signed" ? macosAssets(version) : macosAssets(version).slice(0, 1);
    const missing = [...(state === "draft" ? windowsAssets(version) : []), ...expectedMac].filter(name => !found.assets.includes(name));
    if (missing.length) problems.push(`The ${tag} release is missing: ${missing.join(", ")}.`);
    if (now === "draft" && state === "draft") {
      const allowed = new Set([...windowsAssets(version), ...expectedMac, MACOS_BUNDLE_ASSET]);
      const extra = found.assets.filter(name => !allowed.has(name));
      if (extra.length) problems.push(`The ${tag} draft holds unexpected file${extra.length === 1 ? "" : "s"}: ${extra.join(", ")}.`);
    }
  }
  return { problems, release };
}

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  const args = process.argv.slice(2), tag = args[0] ?? "", option = name => { const at = args.indexOf(name); return at < 0 ? undefined : args[at + 1]; };
  const options = { stage: option("--stage"), previous: option("--previous"), releaseId: option("--release-id"), state: option("--state"), sourceSha: option("--source-sha") };
  const { problems, release } = checkMacosRelease(fs.readFileSync(0, "utf8"), tag, options);
  if (problems.length) { for (const p of problems) console.error(`Release check failed: ${p}`); process.exit(1); }
  if (options.stage === "before" && process.env.GITHUB_OUTPUT) fs.appendFileSync(process.env.GITHUB_OUTPUT, `release_id=${release.id}\nstate=${release.state}\nprerelease=${release.prerelease}\n`);
  console.log(`${tag} (${options.stage}): release ${release.id} is a ${release.state}${release.prerelease ? " test prerelease" : " release"}; newest published release is ${options.previous}.`);
}
