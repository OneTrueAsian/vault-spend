import { test } from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import yaml from "js-yaml";

for (const [filename, dependency, target] of [
  ["release-windows.yml", "release", "windows-x86_64"],
  ["build-macos.yml", "build-macos", "macos-universal"],
]) {
  test(`${filename}: protected final-byte signing with immutable publication`, () => {
    const workflow = fs.readFileSync(new URL(`../.github/workflows/${filename}`, import.meta.url), "utf8");
    const parsed = yaml.load(workflow);
    assert.equal(parsed.jobs["sign-updates"].environment, "release-signing");
    assert.equal(parsed.jobs["sign-updates"].needs, dependency);
    const job = workflow.split("  sign-updates:")[1];
    assert.ok(job, "separate signing job exists");
    assert.match(job, new RegExp(`needs: ${dependency}`));
    assert.match(job, /environment: release-signing/);
    assert.match(job, new RegExp(`ref: \\$\\{\\{ needs.${dependency}.outputs.source-sha \\}\\}`));
    assert.match(workflow, /steps.package.outputs.artifactPaths/);
    assert.match(workflow, /node tools\/update-build-provenance.mjs/);
    const privateScope = job.split("      - name: Sign exact final")[1].split("      - name: Publish")[0];
    assert.match(privateScope, /secrets.UPDATE_SIGNING_PRIVATE_KEY/);
    assert.match(privateScope, /secrets.UPDATE_SIGNING_PASSWORD/);
    assert.match(privateScope, /vars.UPDATE_SIGNING_KEY_ID/);
    assert.match(privateScope, /VAULTSPEND_UPDATE_EXPECTED_DIGESTS/);
    assert.match(privateScope, new RegExp(`node tools/update-signing.mjs sign ${target}`));
    assert.doesNotMatch(privateScope, /GH_TOKEN|upload-artifact|echo/);
    const publish = job.split("      - name: Publish")[1];
    assert.match(publish, /gh release upload/);
    assert.match(publish, /--repo OneTrueAsian\/vault-spend/);
    assert.doesNotMatch(publish, /--clobber|UPDATE_SIGNING_PRIVATE_KEY|UPDATE_SIGNING_PASSWORD/);
    if (target === "windows-x86_64") {
      assert.match(privateScope, /update-input\/Vault\.Spend_\$\{RELEASE_TAG#v\}_x64-setup.exe/);
      assert.match(privateScope, /update-input\/Vault\.Spend_\$\{RELEASE_TAG#v\}_x64_en-US.msi/);
      assert.match(job, /!inputs.recovery/);
    }
  });
}
