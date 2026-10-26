import fs from "node:fs";
import path from "node:path";
import crypto from "node:crypto";
import { fileURLToPath } from "node:url";

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const KEY_ID = /^[a-zA-Z0-9][a-zA-Z0-9_-]{0,63}$/;
export function publicBytes(key) {
  const der = crypto.createPublicKey(key).export({ type: "spki", format: "der" });
  if (der.length !== 44 || der.subarray(0, 12).toString("hex") !== "302a300506032b6570032100")
    throw Error("An Ed25519 signing key is required.");
  return der.subarray(12);
}
export function generateKeyFiles(directory, id, passphrase) {
  if (typeof id !== "string" || !KEY_ID.test(id) || /^(test|fixture)/i.test(id))
    throw Error("Choose a production key ID.");
  if (typeof passphrase !== "string" || passphrase.length < 20)
    throw Error("Use a passphrase of at least 20 characters.");
  const parent = fs.realpathSync(path.dirname(path.resolve(directory)));
  const dest = path.join(parent, path.basename(directory));
  const repositories = [ROOT, fs.realpathSync(ROOT)];
  const insideRepository = (candidate) => repositories.some((repository) => {
    const relative = path.relative(repository, candidate);
    return !relative || (!relative.startsWith(".." + path.sep) && !path.isAbsolute(relative));
  });
  // Check both the requested path and its physical destination: a junction inside
  // source must not make an outside custody folder appear safe to version control.
  for (const candidate of [path.resolve(directory), dest]) {
    if (insideRepository(candidate)) throw Error("Private keys must be generated outside the repository.");
  }
  // ESM resolves the tool's path physically. Canonicalize each requested ancestor
  // as well: an aliased repository root (/var vs /private/var on macOS, or a
  // Windows junction) must not conceal an in-repository link pointing outside.
  for (let ancestor = path.dirname(path.resolve(directory)); ;) {
    if (insideRepository(fs.realpathSync(ancestor)))
      throw Error("Private keys must be generated outside the repository.");
    const next = path.dirname(ancestor);
    if (next === ancestor) break;
    ancestor = next;
  }
  fs.mkdirSync(dest, { mode: 0o700 }); // Never overwrite an existing custody directory.
  const pair = crypto.generateKeyPairSync("ed25519", {
    privateKeyEncoding: { type: "pkcs8", format: "pem", cipher: "aes-256-cbc", passphrase },
  });
  const registry = {
    format: 1,
    keys: [
      {
        id,
        publicKey: publicBytes(
          pair.privateKey ? crypto.createPrivateKey({ key: pair.privateKey, passphrase }) : pair.publicKey,
        ).toString("base64"),
      },
    ],
  };
  fs.writeFileSync(path.join(dest, "update-signing-private.pem"), pair.privateKey, { flag: "wx", mode: 0o600 });
  fs.writeFileSync(path.join(dest, "update-public-keys.json"), JSON.stringify(registry, null, 2) + "\n", {
    flag: "wx",
    mode: 0o600,
  });
  return registry;
}
export function loadSigningKey(pem, passphrase, id, registry) {
  if (!pem?.startsWith("-----BEGIN ENCRYPTED PRIVATE KEY-----") || !passphrase || !KEY_ID.test(id ?? ""))
    throw Error("Configure the encrypted signing key, passphrase and key ID.");
  let key;
  try {
    key = crypto.createPrivateKey({ key: pem, passphrase });
  } catch {
    throw Error("Could not unlock the signing key.");
  }
  const seenIds = new Set(),
    seenKeys = new Set();
  if (
    registry?.format !== 1 ||
    Object.keys(registry).sort().join() !== "format,keys" ||
    !Array.isArray(registry.keys) ||
    registry.keys.length > 8
  )
    throw Error("Invalid embedded public registry.");
  for (const entry of registry.keys) {
    if (
      !entry ||
      Object.keys(entry).sort().join() !== "id,publicKey" ||
      typeof entry.id !== "string" ||
      !KEY_ID.test(entry.id) ||
      /^(test|fixture)/i.test(entry.id) ||
      typeof entry.publicKey !== "string" ||
      !/^[A-Za-z0-9+/]{43}=$/.test(entry.publicKey) ||
      Buffer.from(entry.publicKey, "base64").length !== 32 ||
      Buffer.from(entry.publicKey, "base64").toString("base64") !== entry.publicKey ||
      Buffer.from(entry.publicKey, "base64").every((byte) => byte === 0) ||
      entry.publicKey === "6kpsY+KcUgq+9VB7Ey7F+ZVHdq6+vnuSQh7qaRRG0iw=" ||
      seenIds.has(entry.id) ||
      seenKeys.has(entry.publicKey)
    )
      throw Error("Invalid embedded public registry.");
    seenIds.add(entry.id);
    seenKeys.add(entry.publicKey);
  }
  const matches = registry.keys.filter((entry) => entry.id === id);
  if (matches.length !== 1 || matches[0].publicKey !== publicBytes(key).toString("base64"))
    throw Error("Signing key does not match the app's embedded public registry.");
  return key;
}
export function packageName(version, target, originalName) {
  if (
    typeof version !== "string" ||
    !/^(0|[1-9]\d*)\.(0|[1-9]\d*)\.(0|[1-9]\d*)$/.test(version) ||
    version.split(".").some((part) => Number(part) > 4294967295)
  )
    throw Error("A stable release version is required.");
  const name = originalName.replace(/^Vault Spend_/, "Vault.Spend_");
  const allowed =
    target === "windows-x86_64"
      ? [`Vault.Spend_${version}_x64-setup.exe`, `Vault.Spend_${version}_x64_en-US.msi`]
      : target === "macos-universal"
        ? [`Vault.Spend_${version}_universal.dmg`]
        : [];
  if (!allowed.includes(name)) throw Error("Unexpected installer filename or platform.");
  return name;
}
export function signArtifacts({ files, output, version, target, id, key, expectedDigests }) {
  if (!files.length) throw Error("No final installers were supplied.");
  const packages = files.map((file) => ({ file, name: packageName(version, target, path.basename(file)) }));
  if (new Set(packages.map((entry) => entry.name)).size !== packages.length)
    throw Error("Duplicate installer filenames.");
  if (
    expectedDigests &&
    Object.keys(expectedDigests).sort().join() !==
      packages
        .map((entry) => entry.name)
        .sort()
        .join()
  )
    throw Error("Final installer set does not match the packaging job.");
  fs.mkdirSync(output, { mode: 0o700 });
  const created = [];
  try {
    for (const { file, name } of packages) {
      const stat = fs.lstatSync(file);
      if (!stat.isFile() || stat.isSymbolicLink() || stat.size === 0 || stat.size > 128 * 1024 * 1024)
        throw Error("Installer is missing, redirected or outside the size policy.");
      const artifact = path.join(output, name);
      fs.copyFileSync(file, artifact, fs.constants.COPYFILE_EXCL);
      created.push(artifact);
      const bytes = fs.readFileSync(artifact);
      const sha256 = crypto.createHash("sha256").update(bytes).digest("hex");
      if (
        bytes.length === 0 ||
        bytes.length > 128 * 1024 * 1024 ||
        (expectedDigests && (expectedDigests[name]?.size !== bytes.length || expectedDigests[name]?.sha256 !== sha256))
      )
        throw Error("Final installer bytes do not match the packaging job.");
      const manifest = Buffer.from(
        JSON.stringify({
          format: 1,
          repository: "OneTrueAsian/vault-spend",
          version,
          target,
          filename: name,
          size: bytes.length,
          sha256,
        }),
      );
      const signature = crypto.sign(null, manifest, key);
      if (!crypto.verify(null, manifest, crypto.createPublicKey(key), signature))
        throw Error("Signature verification failed.");
      for (const [suffix, value] of [
        [".manifest.json", manifest],
        [".signature.json", JSON.stringify({ format: 1, keyId: id, signature: signature.toString("base64") })],
      ]) {
        const dest = artifact + suffix;
        fs.writeFileSync(dest, value, { flag: "wx" });
        created.push(dest);
      }
    }
    return created;
  } catch (error) {
    for (const file of created.reverse()) fs.unlinkSync(file);
    fs.rmdirSync(output); // Only our newly created, now empty directory; never recursive deletion.
    throw error;
  }
}
async function main() {
  const [action, ...args] = process.argv.slice(2);
  if (action === "keygen") {
    const [directory, id] = args;
    let passphrase = "";
    process.stdin.setEncoding("utf8");
    for await (const chunk of process.stdin) passphrase += chunk;
    generateKeyFiles(directory, id, passphrase.replace(/\r?\n$/, ""));
    console.log(
      "Encrypted private key and public registry created outside the repository. Only promote the public registry.",
    );
  } else if (action === "sign") {
    const [target, version, output, ...files] = args;
    const pem = process.env.VAULTSPEND_UPDATE_SIGNING_KEY,
      passphrase = process.env.VAULTSPEND_UPDATE_SIGNING_PASSWORD,
      id = process.env.VAULTSPEND_UPDATE_SIGNING_KEY_ID;
    delete process.env.VAULTSPEND_UPDATE_SIGNING_KEY;
    delete process.env.VAULTSPEND_UPDATE_SIGNING_PASSWORD;
    const registry = JSON.parse(fs.readFileSync(path.join(ROOT, "src-tauri/update-keys.json"), "utf8"));
    const key = loadSigningKey(pem, passphrase, id, registry);
    if (!process.env.VAULTSPEND_UPDATE_EXPECTED_DIGESTS)
      throw Error("The packaging job's expected digests are required.");
    const expectedDigests = JSON.parse(process.env.VAULTSPEND_UPDATE_EXPECTED_DIGESTS);
    if (!expectedDigests || typeof expectedDigests !== "object" || Array.isArray(expectedDigests))
      throw Error("The packaging job's expected digests are invalid.");
    signArtifacts({ files, output, version, target, id, key, expectedDigests });
    console.log("Final installers, manifests and signatures prepared and locally verified.");
  } else
    throw Error(
      "Use keygen <new-custody-directory> <key-id> (passphrase on stdin), or sign <target> <version> <new-output-directory> <installers...>.",
    );
}
if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url))
  main().catch((error) => {
    console.error(error.message);
    process.exitCode = 1;
  });
