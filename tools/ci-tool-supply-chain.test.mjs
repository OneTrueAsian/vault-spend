// Guards for VS-42: the Edge driver is checked for a Microsoft signature where it is extracted, cargo-audit is pinned, and no job that builds installers also downloads a driver.
import { test } from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { spawnSync } from "node:child_process";
import yaml from "js-yaml";

const DIR = new URL("../.github/workflows/", import.meta.url);
const workflows = Object.fromEntries(fs.readdirSync(DIR).filter(n => n.endsWith(".yml")).map(n => [n, yaml.load(fs.readFileSync(new URL(n, DIR), "utf8"))]));
const steps = [];
for (const [file, wf] of Object.entries(workflows)) for (const [id, job] of Object.entries(wf.jobs)) for (const step of job.steps ?? []) steps.push({ file, id, job, step, where: `${file} ${id} ${step.name ?? step.uses ?? ""}` });

const CHECK = /\$sig = Get-AuthenticodeSignature \$(\w+); if \(\$sig\.Status -ne 'Valid' -or \$sig\.SignerCertificate\.Subject -notmatch 'O=Microsoft Corporation'\) \{ throw "msedgedriver\.exe is not signed by Microsoft" \}/;
const POWERSHELL = [path.join(process.env.SystemRoot ?? "C:\\Windows", "System32/WindowsPowerShell/v1.0/powershell.exe")].find(p => fs.existsSync(p));

test("every step that downloads the Edge driver checks it is signed by Microsoft right after extracting it", () => {
  const downloads = steps.filter(s => String(s.step.run ?? "").includes("edgedriver_win64.zip"));
  assert.ok(downloads.length >= 2, "the driver steps are found");
  for (const { step, where } of downloads) {
    const run = step.run, check = run.match(CHECK);
    assert.ok(check, `${where}: signature check`);
    assert.ok(run.indexOf("Expand-Archive") > run.indexOf("edgedriver_win64.zip") && check.index > run.indexOf("Expand-Archive"), `${where}: the check follows the extraction`);
    assert.match(run, /msedgedriver\.exe/, where);
  }
});

test("the signature check refuses an unsigned file and accepts a Microsoft-signed one", { skip: !POWERSHELL && "Windows PowerShell is required" }, () => {
  const run = steps.find(s => String(s.step.run ?? "").includes("edgedriver_win64.zip")).step.run;
  const check = run.match(CHECK), snippet = check[0];
  const folder = path.join(os.tmpdir(), "edge-signature-check");
  fs.mkdirSync(folder, { recursive: true });
  const unsigned = path.join(folder, "msedgedriver.exe");
  fs.writeFileSync(unsigned, "not an executable");
  const attempt = file => spawnSync(POWERSHELL, ["-NoProfile", "-NonInteractive", "-Command", `$ErrorActionPreference='Stop'; $${check[1]} = '${file}'; ${snippet}`], { encoding: "utf8" });
  const bad = attempt(unsigned);
  assert.notEqual(bad.status, 0);
  assert.match(bad.stderr, /not signed by Microsoft/);
  assert.equal(attempt(path.join(process.env.SystemRoot ?? "C:\\Windows", "System32", "notepad.exe")).status, 0, "a Microsoft-signed executable passes");
});

test("every cargo-audit install pins its version", () => {
  const installs = steps.filter(s => /cargo install cargo-audit/.test(String(s.step.run ?? "")));
  assert.ok(installs.length >= 3, "the installs are found");
  for (const { step, where } of installs) assert.match(step.run, /cargo install cargo-audit --version 0\.23\.0 --locked/, where);
});

test("no job that builds installers or the desktop app downloads an Edge driver", () => {
  for (const [file, wf] of Object.entries(workflows)) for (const [id, job] of Object.entries(wf.jobs)) {
    const builds = (job.steps ?? []).some(s => /^tauri-apps\/tauri-action@/.test(s.uses ?? "") || /tauri build|build:app/.test(s.run ?? ""));
    if (builds) assert.doesNotMatch(JSON.stringify(job), /edgedriver|msedgedriver/i, `${file} ${id}`);
  }
  assert.ok(Object.values(workflows).some(wf => Object.values(wf.jobs).some(job => (job.steps ?? []).some(s => /^tauri-apps\/tauri-action@/.test(s.uses ?? "")))), "the packaging jobs are found");
});

test("the release workflow has only the sharded route: no serial release or signing job and no sharded switch", () => {
  const release = workflows["release-windows.yml"];
  assert.deepEqual(Object.keys(release.jobs), ["sharded-request", "release-baseline", "sharded-gate", "sharded-package", "sharded-sign-updates"]);
  assert.equal(release.on.workflow_dispatch.inputs.sharded, undefined);
  assert.doesNotMatch(fs.readFileSync(new URL("release-windows.yml", DIR), "utf8"), /inputs\.sharded|SHARDED/);
});
