// Moving a compiled debug executable from the hosted job that built it to the jobs that test it (sharded hosted gate).
// Nothing here relaxes the build-identity guard: the receiving job copies the executable and its build record unchanged, then asks the
// ordinary guard code (verifyArtifact, with the key recomputed from ITS OWN checkout, toolchain and environment) whether the pair is fresh.
// A job whose source, toolchain or build environment differs gets "stale" and stops; a modified executable gets "changed"; a missing or
// unreadable record gets "unknown". The manifest below is only there to explain a refusal and to catch a mismatched checkout early.
// The mobile viewer build (dist-mobile) is not part of the executable's identity but two specs serve it to a second browser, and it is gitignored,
// so a job that never builds must receive it too. Each file travels with its hash and is checked on arrival; nothing else may be in the folder.
import fs from "node:fs";
import path from "node:path";
import { computeBuildKey, isBuildInput, sha256File, verifyArtifact } from "./buildIdentity.mjs";

const FILES = ["vaultspend.exe", "vaultspend.artifact.json", "init_db.exe"];
const MOBILE = "dist-mobile";

/** Every file under `dir` as { "relative/posix/path": sha256 }. */
function hashTree(dir) {
  const hashes = {};
  const walk = current => {
    for (const entry of fs.readdirSync(current, { withFileTypes: true })) {
      const full = path.join(current, entry.name);
      if (entry.isDirectory()) walk(full);
      else hashes[path.relative(dir, full).split(path.sep).join("/")] = sha256File(full);
    }
  };
  if (fs.existsSync(dir)) walk(dir);
  return Object.fromEntries(Object.entries(hashes).sort(([a], [b]) => (a < b ? -1 : 1)));
}
export const MANIFEST_NAME = "transfer-manifest.json";

/** What the building job records: where the build came from and what it was built with. `buildInputs` holds only build-input hashes (no test files, no secrets). */
const isBuildInputName = file => file.startsWith("@build/") || isBuildInput(file);

export function createManifest({ sourceSha, key, exeSha256, toolchain, mode, inputs, mobileAssets = {}, runner = {} }) {
  const buildInputs = Object.fromEntries(Object.entries(inputs).filter(([file]) => isBuildInputName(file)).sort(([a], [b]) => (a < b ? -1 : 1)));
  return { sourceSha, buildKey: key, exeSha256, toolchain, mode, runner, buildInputs, mobileAssets };
}

/** Stages exe + record + init_db + the mobile viewer build + manifest into `stageDir` for upload. Refuses unless the executable is fresh for the inputs it was built from. */
export function stageBuild({ exePath, recordPath, initDbPath, mobileDir, stageDir, sourceSha, inputs, toolchain, mode }) {
  const key = computeBuildKey({ files: inputs, toolchain, mode });
  const verified = verifyArtifact({ exePath, recordPath, currentKey: key });
  if (verified.status !== "fresh") throw new Error(`Refusing to transfer a build that is not fresh (${verified.status}): ${verified.reason}`);
  if (!fs.existsSync(initDbPath)) throw new Error(`The database fixture tool is missing at ${initDbPath}.`);
  const mobileAssets = hashTree(mobileDir);
  if (!Object.keys(mobileAssets).length) throw new Error(`The mobile viewer build is missing or empty at ${mobileDir}.`);
  fs.rmSync(stageDir, { recursive: true, force: true });
  fs.mkdirSync(stageDir, { recursive: true });
  fs.cpSync(mobileDir, path.join(stageDir, MOBILE), { recursive: true });
  fs.copyFileSync(exePath, path.join(stageDir, "vaultspend.exe"));
  fs.copyFileSync(recordPath, path.join(stageDir, "vaultspend.artifact.json"));
  fs.copyFileSync(initDbPath, path.join(stageDir, "init_db.exe"));
  const manifest = createManifest({ sourceSha, key, exeSha256: verified.exeSha256, toolchain, mode, inputs, mobileAssets, runner: { image: process.env.ImageVersion ?? null } });
  fs.writeFileSync(path.join(stageDir, MANIFEST_NAME), JSON.stringify(manifest, null, 2) + "\n");
  return manifest;
}

/**
 * Receiving side. Copies the staged files into place and reports what the unchanged guard says about them. Returns { status, manifest, problems[] }:
 * status is the guard's own word ("fresh" is the only acceptable one); problems name what differs when it is not.
 */
export function receiveBuild({ stageDir, exePath, recordPath, initDbPath, mobileDir, sourceSha, inputs, toolchain, mode }) {
  const problems = [];
  let manifest;
  try { manifest = JSON.parse(fs.readFileSync(path.join(stageDir, MANIFEST_NAME), "utf8")); } catch { return { status: "unknown", manifest: null, problems: ["The transfer manifest is missing or unreadable."] }; }
  for (const name of FILES) if (!fs.existsSync(path.join(stageDir, name))) problems.push(`The transferred build is missing ${name}.`);
  if (problems.length) return { status: "missing", manifest, problems };
  if (manifest.sourceSha !== sourceSha) problems.push(`Built from ${manifest.sourceSha}, but this job checked out ${sourceSha}.`);
  if (manifest.mode !== mode) problems.push(`Built in mode ${manifest.mode}, expected ${mode}.`);
  for (const name of ["node", "rustc", "cargo"]) if (manifest.toolchain?.[name] !== toolchain[name]) problems.push(`Toolchain ${name} differs: built with "${manifest.toolchain?.[name]}", this job has "${toolchain[name]}".`);
  // Name exactly which inputs differ, so a refusal is diagnosable without weakening it.
  const mine = Object.fromEntries(Object.entries(inputs).filter(([file]) => isBuildInputName(file)));
  for (const file of new Set([...Object.keys(manifest.buildInputs ?? {}), ...Object.keys(mine)])) if (manifest.buildInputs?.[file] !== mine[file]) problems.push(`Build input differs: ${file}`);
  fs.mkdirSync(path.dirname(exePath), { recursive: true });
  fs.copyFileSync(path.join(stageDir, "vaultspend.exe"), exePath);
  fs.copyFileSync(path.join(stageDir, "vaultspend.artifact.json"), recordPath);
  fs.mkdirSync(path.dirname(initDbPath), { recursive: true });
  fs.copyFileSync(path.join(stageDir, "init_db.exe"), initDbPath);
  // Replace, never merge: a leftover file from an earlier build must not be served to the specs.
  fs.rmSync(mobileDir, { recursive: true, force: true });
  if (fs.existsSync(path.join(stageDir, MOBILE))) fs.cpSync(path.join(stageDir, MOBILE), mobileDir, { recursive: true });
  const expected = manifest.mobileAssets ?? {}, arrived = hashTree(mobileDir);
  if (!Object.keys(expected).length) problems.push("The transfer manifest lists no mobile viewer files.");
  for (const file of Object.keys(expected)) {
    if (!(file in arrived)) problems.push(`Mobile viewer file is missing from the transfer: ${file}`);
    else if (arrived[file] !== expected[file]) problems.push(`Mobile viewer file differs from the build: ${file}`);
  }
  for (const file of Object.keys(arrived)) if (!(file in expected)) problems.push(`Mobile viewer file was not in the build: ${file}`);
  if (sha256File(exePath) !== manifest.exeSha256) problems.push("The executable's SHA-256 differs from the one the building job recorded.");
  const key = computeBuildKey({ files: inputs, toolchain, mode });
  const verified = verifyArtifact({ exePath, recordPath, currentKey: key });
  if (verified.status !== "fresh") problems.push(`The build-identity check says ${verified.status}: ${verified.reason}`);
  return { status: verified.status, manifest, problems };
}
