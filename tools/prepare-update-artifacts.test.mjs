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
test("preparation workflow cannot publish and retains protected signing and complete Windows gates", () => {
  const text = fs.readFileSync(new URL("../.github/workflows/prepare-signed-installers.yml", import.meta.url), "utf8"), workflow = yaml.load(text);
  assert.deepEqual(workflow.permissions, { contents: "read" });
  assert.deepEqual(Object.keys(workflow.on), ["workflow_call", "workflow_dispatch"]);
  assert.doesNotMatch(text, /gh release|contents: write|tagName:|releaseName:|releaseId:|GITHUB_TOKEN:|git push/);
  for (const job of Object.values(workflow.jobs)) for (const step of job.steps) {
    if (step.uses === "tauri-apps/tauri-action@v0") assert.deepEqual(Object.keys(step.with), ["args"]);
    if (step.uses === "actions/checkout@v4") assert.equal(step.with["persist-credentials"], false);
  }
  const release = yaml.load(fs.readFileSync(new URL("../.github/workflows/release-windows.yml", import.meta.url), "utf8"));
  for (const name of ["Frontend tests", "Lint", "Rust tests", "Build current desktop test app", "Refresh hosted WebView2 runtime", "Pin hosted Edge version", "Install desktop test drivers", "Install native Edge test driver", "Prepare medium-integrity desktop tests", "Desktop WebDriver smoke preflight", "Full desktop E2E release gate"])
    assert.deepEqual(workflow.jobs.windows.steps.find(step => step.name === name), release.jobs.release.steps.find(step => step.name === name), name);
  assert.equal(workflow.jobs["sign-updates"].environment, "release-signing");
  assert.deepEqual(workflow.jobs["sign-updates"].needs, ["windows", "macos"]);
  const secretSteps = workflow.jobs["sign-updates"].steps.filter(step => JSON.stringify(step).includes("secrets.UPDATE_SIGNING"));
  assert.equal(secretSteps.length, 1);
  assert.equal(secretSteps[0].run, "node tools/prepare-update-artifacts.mjs sign");
  assert.ok(secretSteps[0].env.VAULTSPEND_UPDATE_EXPECTED_DIGESTS);
  assert.ok(workflow.jobs["sign-updates"].steps.find(step => step.run === "node tools/prepare-update-artifacts.mjs verify"));
  const entry = yaml.load(fs.readFileSync(new URL("../.github/workflows/build-macos-check.yml", import.meta.url), "utf8"));
  assert.deepEqual(entry.permissions, { contents: "read", actions: "read" });
  assert.equal(entry.on.workflow_dispatch.inputs.prepare_signed.default, false);
  assert.equal(entry.jobs["prepare-signed"].uses, "./.github/workflows/prepare-signed-installers.yml");
  assert.equal(entry.jobs["prepare-signed"].if, "${{ inputs.prepare_signed && !inputs.sign_prepared_run }}");
  assert.equal(entry.jobs["macos-check"].if, "${{ !inputs.prepare_signed && !inputs.sign_prepared_run }}");
  for (const name of ["UPDATE_SIGNING_PRIVATE_KEY", "UPDATE_SIGNING_PASSWORD"]) {
    assert.equal(workflow.on.workflow_call.secrets[name].required, true);
    assert.equal(entry.jobs["prepare-signed"].secrets[name], "${{ secrets." + name + " }}");
  }
  assert.equal(entry.jobs["sign-prepared"].environment, "release-signing");
  assert.equal(entry.jobs["sign-prepared"].needs, "validate-prepared");
  const download = entry.jobs["sign-prepared"].steps.find(step => step.uses === "actions/download-artifact@v4");
  assert.equal(download.with["run-id"], "${{ inputs.sign_prepared_run }}");
  assert.equal(download.with["github-token"], "${{ secrets.GITHUB_TOKEN }}");
  const scope = entry.jobs["sign-prepared"].steps.filter(step => JSON.stringify(step).includes("secrets.UPDATE_SIGNING"));
  assert.equal(scope.length, 1);
  assert.ok(scope[0].env.VAULTSPEND_UPDATE_EXPECTED_DIGESTS);
  assert.doesNotMatch(JSON.stringify(scope[0]), /GITHUB_TOKEN|github-token|upload-artifact/);
  assert.doesNotMatch(JSON.stringify(entry), /gh release|contents.*write|tagName|releaseName|releaseId|git push/);
});
