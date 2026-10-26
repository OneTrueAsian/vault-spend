import fs from "node:fs";
import path from "node:path";
import crypto from "node:crypto";
import { execFileSync } from "node:child_process";
import { fileURLToPath } from "node:url";
import { buildDigests } from "./update-build-provenance.mjs";
import { packageName } from "./update-signing.mjs";

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const VERSION = "1.3.1";
export function validateSource(env, sha, versions) {
  if (env.GITHUB_REF !== "refs/heads/release-1.3.1" ||
      !/^[a-f0-9]{40}$/.test(env.SOURCE_SHA ?? "") ||
      env.SOURCE_SHA !== sha || env.GITHUB_SHA !== sha ||
      versions.some(version => version !== VERSION) || versions.length !== 5)
    throw Error("Preparation requires the exact dispatched release-1.3.1 commit and matching 1.3.1 metadata.");
  if ((env.WINDOWS_SHA || env.MACOS_SHA) && (env.WINDOWS_SHA !== sha || env.MACOS_SHA !== sha))
    throw Error("Platform builds do not share the approved source.");
}
export function verifyArtifacts(directory, target, provenance, registry) {
  const names = target === "windows-x86_64"
    ? [`Vault.Spend_${VERSION}_x64-setup.exe`, `Vault.Spend_${VERSION}_x64_en-US.msi`]
    : target === "macos-universal" ? [`Vault.Spend_${VERSION}_universal.dmg`] : [];
  if (!names.length || provenance.target !== target || provenance.version !== VERSION ||
      !/^[a-f0-9]{40}$/.test(provenance.sourceSha ?? "") ||
      Object.keys(provenance.digests ?? {}).sort().join() !== [...names].sort().join())
    throw Error("Invalid preparation provenance.");
  const expectedFiles = names.flatMap(name => [name, name + ".manifest.json", name + ".signature.json"]);
  if (fs.readdirSync(directory).sort().join() !== [...expectedFiles].sort().join())
    throw Error("Unexpected files in signed output.");
  for (const name of names) {
    const read = suffix => {
      const file = path.join(directory, name + suffix), stat = fs.lstatSync(file);
      if (!stat.isFile() || stat.isSymbolicLink() || stat.size <= 0 || stat.size > 128 * 1024 * 1024)
        throw Error("Invalid signed artifact file.");
      return fs.readFileSync(file);
    };
    const manifestBytes = read(".manifest.json"), manifest = JSON.parse(manifestBytes);
    const envelope = JSON.parse(read(".signature.json"));
    const entry = registry.keys.find(key => key.id === envelope.keyId);
    if (!entry || envelope.format !== 1 || Object.keys(envelope).sort().join() !== "format,keyId,signature" ||
        typeof envelope.signature !== "string" || !/^[A-Za-z0-9+/]{86}==$/.test(envelope.signature))
      throw Error("Invalid signature envelope.");
    const publicKey = crypto.createPublicKey({
      key: Buffer.concat([Buffer.from("302a300506032b6570032100", "hex"), Buffer.from(entry.publicKey, "base64")]),
      format: "der", type: "spki",
    });
    if (!crypto.verify(null, manifestBytes, publicKey, Buffer.from(envelope.signature, "base64")))
      throw Error("Invalid public-key signature.");
    const bytes = read(""), digest = crypto.createHash("sha256").update(bytes).digest("hex");
    if (Object.keys(manifest).sort().join() !== "filename,format,repository,sha256,size,target,version" ||
        manifest.format !== 1 || manifest.repository !== "OneTrueAsian/vault-spend" ||
        manifest.version !== VERSION || manifest.target !== target || manifest.filename !== name ||
        manifest.size !== bytes.length || manifest.sha256 !== digest ||
        provenance.digests[name].size !== bytes.length || provenance.digests[name].sha256 !== digest)
      throw Error("Installer bytes or manifest do not match packaging provenance.");
  }
  return names;
}
function validate() {
  const json = file => JSON.parse(fs.readFileSync(path.join(ROOT, file), "utf8"));
  const lock = json("package-lock.json");
  const cargo = fs.readFileSync(path.join(ROOT, "src-tauri/Cargo.toml"), "utf8").match(/^version = "([^"]+)"$/m)?.[1];
  const sha = execFileSync("git", ["rev-parse", "HEAD"], { encoding: "utf8" }).trim();
  validateSource(process.env, sha, [json("package.json").version, lock.version, lock.packages[""].version, json("src-tauri/tauri.conf.json").version, cargo]);
  return sha;
}
function main() {
  const [action, targetArg] = process.argv.slice(2);
  if (action === "validate") { validate(); return; }
  if (action === "collect") {
    const sha = execFileSync("git", ["rev-parse", "HEAD"], { encoding: "utf8" }).trim();
    const files = JSON.parse(process.env.ARTIFACT_PATHS), digests = buildDigests(files, targetArg, VERSION);
    fs.mkdirSync("prepared-input");
    for (const file of files) {
      const name = path.basename(file).replace(/^Vault Spend_/, "Vault.Spend_");
      if (Object.hasOwn(digests, name)) fs.copyFileSync(file, path.join("prepared-input", packageName(VERSION, targetArg, name)), fs.constants.COPYFILE_EXCL);
    }
    fs.writeFileSync("prepared-input/provenance.json", JSON.stringify({ sourceSha: sha, version: VERSION, target: targetArg, digests }, null, 2));
    fs.appendFileSync(process.env.GITHUB_OUTPUT, `source_sha=${sha}\ndigests=${JSON.stringify(digests)}\n`);
    return;
  }
  const target = process.env.PREPARATION_TARGET;
  const provenance = JSON.parse(fs.readFileSync("prepared-input/provenance.json", "utf8"));
  const sha = execFileSync("git", ["rev-parse", "HEAD"], { encoding: "utf8" }).trim();
  if (provenance.sourceSha !== sha || provenance.version !== VERSION || provenance.target !== target)
    throw Error("Downloaded artifacts do not match checked-out source.");
  if (action === "sign") {
    if (JSON.stringify(provenance.digests) !== process.env.VAULTSPEND_UPDATE_EXPECTED_DIGESTS)
      throw Error("Artifact provenance differs from packaging job outputs.");
    const files = Object.keys(provenance.digests).map(name => path.join("prepared-input", packageName(VERSION, target, name)));
    execFileSync(process.execPath, [path.join(ROOT, "tools/update-signing.mjs"), "sign", target, VERSION, "prepared-signed", ...files], { stdio: "inherit" });
  } else if (action === "verify") {
    const names = verifyArtifacts("prepared-signed", target, provenance, JSON.parse(fs.readFileSync(path.join(ROOT, "src-tauri/update-keys.json"), "utf8")));
    fs.writeFileSync("prepared-signed/verification.json", JSON.stringify({ ...provenance, keyId: "release-2026", verifiedInstallers: names, publication: false }, null, 2));
    console.log(`Verified ${names.length} installer(s) against the embedded public registry and packaging hashes. No publication.`);
  } else throw Error("Unknown preparation action.");
}
if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  try { main(); } catch (error) { console.error(error.message); process.exitCode = 1; }
}
