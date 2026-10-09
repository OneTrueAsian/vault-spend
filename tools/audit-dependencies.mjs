import { spawnSync } from "node:child_process";
import fs from "node:fs";
import path from "node:path";
import { rustFindings, npmFindings } from "./dependency-security-policy.mjs";

const target = process.argv[2];
if (!["x86_64-pc-windows-msvc", "aarch64-apple-darwin", "x86_64-apple-darwin"].includes(target)) throw new Error("Specify a supported release target.");
const output = path.resolve(process.env.VAULTSPEND_AUDIT_OUTPUT ?? "dependency-audit");
fs.mkdirSync(output, { recursive: true });
function run(command, args, allowed = [0]) {
  const result = spawnSync(command, args, { encoding: "utf8", windowsHide: true, maxBuffer: 32 * 1024 * 1024,
    shell: process.platform === 'win32' && command === 'npm' });
  if (result.error || !allowed.includes(result.status)) throw new Error(`${command} ${args.join(' ')} failed: ${result.error?.message ?? result.stderr}`);
  return result.stdout;
}
function scan(name, command, args) {
  const raw = run(command, args, [0, 1]);
  fs.writeFileSync(path.join(output, name + '.json'), raw);
  const report = JSON.parse(raw); // Empty, network-error or invalid results fail closed.
  return report;
}
const versions = { node: process.version, npm: run('npm', ['--version']).trim(), cargoAudit: run('cargo', ['audit', '--version']).trim(), target };
fs.writeFileSync(path.join(output, 'tool-versions.json'), JSON.stringify(versions, null, 2));
const prod = scan('npm-production', 'npm', ['audit', '--omit=dev', '--json']);
const all = scan('npm-all', 'npm', ['audit', '--json']);
const rust = scan('rustsec', 'cargo', ['audit', '--json']); // Refreshes the advisory database; no --no-fetch/offline fallback.
const tree = run('cargo', ['tree', '--locked', '--target', target, '--edges', 'normal,build,dev', '--prefix', 'none']);
fs.writeFileSync(path.join(output, 'target-tree.txt'), tree);
const findings = rustFindings(rust, tree, target);
const result = { versions, database: rust.database, npmProduction: npmFindings(prod), npmAll: npmFindings(all), rust: findings, maintenance: rust.warnings?.unmaintained ?? [] };
fs.writeFileSync(path.join(output, 'result.json'), JSON.stringify(result, null, 2));
console.log(JSON.stringify({ ...result, maintenance: result.maintenance.map(item => ({ advisory: item.advisory.id, package: item.package.name })) }, null, 2));
if (result.npmProduction || result.npmAll || findings.some(item => !item.permitted)) process.exitCode = 1;
