// Runs in the packaging job, before private signing credentials are available.
import fs from "node:fs";
import path from "node:path";
import crypto from "node:crypto";
import { execFileSync } from "node:child_process";
import { fileURLToPath } from "node:url";
import { packageName } from "./update-signing.mjs";

export function buildDigests(files, target, version) {
  const digests = {};
  for (const file of files) {
    if (!file.endsWith(target === "windows-x86_64" ? ".exe" : ".dmg") && !(target === "windows-x86_64" && file.endsWith(".msi"))) continue;
    const name = packageName(version, target, path.basename(file));
    const stat = fs.lstatSync(file);
    if (digests[name] || !stat.isFile() || stat.isSymbolicLink() || stat.size <= 0 || stat.size > 128 * 1024 * 1024) throw Error("Invalid final build artifacts.");
    const bytes = fs.readFileSync(file);
    digests[name] = { size: bytes.length, sha256: crypto.createHash("sha256").update(bytes).digest("hex") };
  }
  const count = target === "windows-x86_64" ? 2 : target === "macos-universal" ? 1 : 0;
  if (!count || Object.keys(digests).length !== count) throw Error("Final installer set is incomplete.");
  return digests;
}
if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  if (!process.env.GITHUB_OUTPUT || !process.env.ARTIFACT_PATHS) throw Error("Final build metadata and GitHub output path are required.");
  const [target, version] = process.argv.slice(2);
  const digests = buildDigests(JSON.parse(process.env.ARTIFACT_PATHS), target, version);
  const sha = execFileSync("git", ["rev-parse", "HEAD"], { encoding: "utf8" }).trim();
  if (!/^[a-f0-9]{40}$/.test(sha)) throw Error("Invalid build commit.");
  fs.appendFileSync(process.env.GITHUB_OUTPUT, `digests=${JSON.stringify(digests)}\nsource_sha=${sha}\n`);
}
