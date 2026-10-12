import { test } from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import crypto from "node:crypto";
import { spawnSync } from "node:child_process";
import { fileURLToPath, pathToFileURL } from "node:url";
import { buildDigests } from "./update-build-provenance.mjs";
import { generateKeyFiles, loadSigningKey, packageName, signArtifacts } from "./update-signing.mjs";
test("encrypted custody and exact-byte manifests with no overwrite or unknown trust", () => {
  const parent = fs.mkdtempSync(path.join(os.tmpdir(), "vs-sign-test-"));
  const custody = path.join(parent, "custody"),
    output = path.join(parent, "public");
  const password = "inert test passphrase 123456789";
  const registry = generateKeyFiles(custody, "release-fixture", password);
  const pem = fs.readFileSync(path.join(custody, "update-signing-private.pem"), "utf8");
  assert.match(pem, /BEGIN ENCRYPTED PRIVATE KEY/);
  assert.throws(() => generateKeyFiles(custody, "release-fixture", password));
  assert.throws(() => loadSigningKey(pem, "wrong", "release-fixture", registry));
  assert.throws(() => loadSigningKey(pem, password, "unknown", registry));
  assert.throws(() =>
    loadSigningKey(pem, password, "release-fixture", { ...registry, keys: [...registry.keys, ...registry.keys] }),
  );
  assert.throws(() => loadSigningKey(pem, password, "release-fixture", { ...registry, extra: true }));
  const key = loadSigningKey(pem, password, "release-fixture", registry);
  const file = path.join(parent, "Vault Spend_1.4.0_x64-setup.exe");
  fs.writeFileSync(file, "inert");
  const msi = path.join(parent, "Vault Spend_1.4.0_x64_en-US.msi");
  fs.writeFileSync(msi, "inert MSI");
  const digests = buildDigests([file, msi], "windows-x86_64", "1.4.0");
  assert.throws(() => buildDigests([file], "windows-x86_64", "1.4.0"));
  const changed = path.join(parent, "changed");
  assert.throws(() =>
    signArtifacts({
      files: [file, msi],
      output: changed,
      version: "1.4.0",
      target: "windows-x86_64",
      id: "release-fixture",
      key,
      expectedDigests: { ...digests, "Vault.Spend_1.4.0_x64-setup.exe": { size: 5, sha256: "0".repeat(64) } },
    }),
  );
  assert.equal(fs.existsSync(changed), false, "mismatch leaves no signatures or output folder");
  const files = signArtifacts({
    files: [file, msi],
    output,
    version: "1.4.0",
    target: "windows-x86_64",
    id: "release-fixture",
    key,
    expectedDigests: digests,
  });
  const bytes = fs.readFileSync(files[1]),
    envelope = JSON.parse(fs.readFileSync(files[2]));
  assert.equal(JSON.parse(bytes).sha256, crypto.createHash("sha256").update("inert").digest("hex"));
  assert.equal(
    crypto.verify(null, bytes, crypto.createPublicKey(key), Buffer.from(envelope.signature, "base64")),
    true,
  );
  assert.equal(
    crypto.verify(
      null,
      Buffer.concat([bytes, Buffer.from(" ")]),
      crypto.createPublicKey(key),
      Buffer.from(envelope.signature, "base64"),
    ),
    false,
  );
  assert.throws(() =>
    signArtifacts({ files: [file], output, version: "1.4.0", target: "windows-x86_64", id: "release-fixture", key }),
  );
  const dmg = path.join(parent, "Vault Spend_1.4.0_universal.dmg");
  fs.writeFileSync(dmg, "inert DMG");
  const macOutput = path.join(parent, "mac-public");
  const macFiles = signArtifacts({
    files: [dmg],
    output: macOutput,
    version: "1.4.0",
    target: "macos-universal",
    id: "release-fixture",
    key,
    expectedDigests: buildDigests([dmg], "macos-universal", "1.4.0"),
  });
  assert.equal(JSON.parse(fs.readFileSync(macFiles[1])).target, "macos-universal");
  assert.equal(
    crypto.verify(
      null,
      fs.readFileSync(macFiles[1]),
      crypto.createPublicKey(key),
      Buffer.from(JSON.parse(fs.readFileSync(macFiles[2])).signature, "base64"),
    ),
    true,
  );
  for (const name of macFiles) fs.unlinkSync(name);
  fs.rmdirSync(macOutput);
  fs.unlinkSync(dmg);
  // Remove only explicitly owned test files/directories, never an enumerated recursive tree.
  for (const name of files) fs.unlinkSync(name);
  fs.rmdirSync(output);
  fs.unlinkSync(file);
  fs.unlinkSync(msi);
  fs.unlinkSync(path.join(custody, "update-signing-private.pem"));
  fs.unlinkSync(path.join(custody, "update-public-keys.json"));
  fs.rmdirSync(custody);
  fs.rmdirSync(parent);
});
test("filename/version policy and key generation refuse unsafe input", () => {
  assert.throws(() => packageName("4294967296.4.0", "windows-x86_64", "Vault.Spend_4294967296.4.0_x64-setup.exe"));
  assert.throws(() => packageName("01.4.0", "windows-x86_64", "Vault.Spend_01.4.0_x64-setup.exe"));
  assert.throws(() => packageName("1.4.0", "macos-universal", "evil.dmg"));
  assert.throws(() =>
    generateKeyFiles(path.resolve("private-key-test"), "release", "inert passphrase with sufficient length"),
  );
});

test("keygen CLI preserves passphrase spaces and never prints credentials", () => {
  const parent = fs.mkdtempSync(path.join(os.tmpdir(), "vs-key-cli-"));
  const custody = path.join(parent, "custody");
  const password = "inert CLI passphrase Ω 漢 with trailing spaces  ";
  try {
    const result = spawnSync(
      process.execPath,
      [fileURLToPath(new URL("./update-signing.mjs", import.meta.url)), "keygen", custody, "release-cli"],
      { input: password + "\r\n", encoding: "utf8" },
    );
    assert.equal(result.status, 0, result.stderr);
    assert.ok(!(result.stdout + result.stderr).includes(password));
    assert.doesNotMatch(result.stdout + result.stderr, /BEGIN ENCRYPTED PRIVATE KEY/);
    const pem = fs.readFileSync(path.join(custody, "update-signing-private.pem"), "utf8");
    const registry = JSON.parse(fs.readFileSync(path.join(custody, "update-public-keys.json")));
    assert.ok(loadSigningKey(pem, password, "release-cli", registry));
    assert.throws(() => loadSigningKey(pem, password.trimEnd(), "release-cli", registry));
  } finally {
    for (const name of ["update-signing-private.pem", "update-public-keys.json"]) {
      const file = path.join(custody, name);
      if (fs.existsSync(file)) fs.unlinkSync(file);
    }
    if (fs.existsSync(custody)) fs.rmdirSync(custody);
    fs.rmdirSync(parent);
  }
});

test("a junction inside source cannot expose an outside private custody folder to git", async () => {
  const project = fs.mkdtempSync(path.join(os.tmpdir(), "vs-custody-repo-"));
  const outside = fs.mkdtempSync(path.join(os.tmpdir(), "vs-custody-outside-"));
  const tools = path.join(project, "tools"), junction = path.join(project, "external");
  const copy = path.join(tools, "update-signing.mjs");
  fs.mkdirSync(tools); fs.copyFileSync(fileURLToPath(new URL("./update-signing.mjs", import.meta.url)), copy);
  try {
    fs.symlinkSync(outside, junction, "junction");
    const isolated = await import(pathToFileURL(copy).href);
    assert.throws(() => isolated.generateKeyFiles(path.join(junction, "custody"), "release", "inert sufficiently long passphrase"), /outside the repository/);
    assert.equal(fs.existsSync(path.join(outside, "custody")), false);
  } finally {
    if (fs.existsSync(junction)) fs.unlinkSync(junction);
    fs.unlinkSync(copy); fs.rmdirSync(tools); fs.rmdirSync(project); fs.rmdirSync(outside);
  }
});
