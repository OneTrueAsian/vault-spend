import { test } from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import crypto from "node:crypto";
import yaml from "js-yaml";
import { validateSource, verifyArtifacts } from "./prepare-update-artifacts.mjs";
import { signArtifacts, publicBytes } from "./update-signing.mjs";
import { buildDigests } from "./update-build-provenance.mjs";

const sha = "a".repeat(40), versions = Array(5).fill("1.3.1");
test("preparation refuses wrong branch, moved source, platform mismatch and version drift", () => {
  const env = { GITHUB_REF: "refs/heads/release-1.3.1", SOURCE_SHA: sha, GITHUB_SHA: sha };
  validateSource(env, sha, versions);
  for (const change of [{ GITHUB_REF: "refs/tags/v1.3.1" }, { SOURCE_SHA: "b".repeat(40) }, { GITHUB_SHA: "b".repeat(40) }, { WINDOWS_SHA: sha, MACOS_SHA: "b".repeat(40) }])
    assert.throws(() => validateSource({ ...env, ...change }, sha, versions));
  assert.throws(() => validateSource(env, sha, ["1.3.3", ...versions.slice(1)]));
});
test("independent public verification rejects changed installer, signature, provenance and extra output", () => {
  const tmp = fs.mkdtempSync(path.join(os.tmpdir(), "vault-preparation-contract-"));
  try {
    const target = "windows-x86_64", version = "1.3.1";
    const files = ["Vault.Spend_1.3.1_x64-setup.exe", "Vault.Spend_1.3.1_x64_en-US.msi"].map(name => {
      const file = path.join(tmp, name); fs.writeFileSync(file, "inert fixture bytes " + name); return file;
    });
    const pair = crypto.generateKeyPairSync("ed25519"), id = "preparation-contract";
    const registry = { format: 1, keys: [{ id, publicKey: publicBytes(pair.privateKey).toString("base64") }] };
    const digests = buildDigests(files, target, version), provenance = { target, version, sourceSha: sha, digests };
    const output = path.join(tmp, "signed");
    signArtifacts({ files, output, version, target, id, key: pair.privateKey, expectedDigests: digests });
    assert.equal(verifyArtifacts(output, target, provenance, registry).length, 2);
    const installer = path.join(output, path.basename(files[0])), original = fs.readFileSync(installer);
    fs.writeFileSync(installer, "tampered"); assert.throws(() => verifyArtifacts(output, target, provenance, registry)); fs.writeFileSync(installer, original);
    const manifest = installer + ".manifest.json", bytes = fs.readFileSync(manifest);
    fs.appendFileSync(manifest, " "); assert.throws(() => verifyArtifacts(output, target, provenance, registry), /signature/); fs.writeFileSync(manifest, bytes);
    assert.throws(() => verifyArtifacts(output, target, { ...provenance, digests: {} }, registry));
    const extra = path.join(output, "unexpected.pem"); fs.writeFileSync(extra, "inert");
    assert.throws(() => verifyArtifacts(output, target, provenance, registry), /Unexpected files/);
  } finally { fs.rmSync(tmp, { recursive: true, force: true }); }
});
