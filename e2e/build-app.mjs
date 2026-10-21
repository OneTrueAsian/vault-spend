// npm run build:app — the debug Tauri build the desktop specs run against, taken under exclusive access.
// Reuses target\debug\vaultspend.exe, without compiling, only when its complete build inputs match what it was built from;
// otherwise rebuilds and records the inputs. `--force` rebuilds regardless. Same compiler command as before:
//   npx tauri build --debug --no-bundle
import { spawn } from "node:child_process";
import { BUILD_MODE, exePath, lockDir, recordPath, repoRoot } from "./lib/accessPaths.mjs";
import { buildArtifact } from "./lib/buildApp.mjs";
import { collectInputs, readToolchain } from "./lib/buildIdentity.mjs";

const runBuild = () => new Promise((resolve, reject) => {
  const child = spawn("npx", ["tauri", "build", "--debug", "--no-bundle"], { cwd: repoRoot, stdio: "inherit", shell: true });
  child.on("error", reject);
  child.on("close", code => (code === 0 ? resolve() : reject(new Error(`tauri build failed (exit ${code}).`))));
});
try {
  const result = await buildArtifact({
    lockDir, exePath, recordPath, collectInputs: () => collectInputs(repoRoot), toolchain: readToolchain(), mode: BUILD_MODE, runBuild, force: process.argv.includes("--force"),
  });
  console.log(result.action === "reused"
    ? `Reused ${exePath}: every build input matches (SHA-256 ${result.artifact.exeSha256}). Nothing was compiled; use --force to rebuild.`
    : `Built ${exePath} (SHA-256 ${result.artifact.exeSha256}).`);
} catch (error) {
  console.error(error.message);
  process.exit(error.name === "AccessHeldError" || error.name === "AccessTimeoutError" ? 2 : 1);
}
