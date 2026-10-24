// One place for where the shared executable, its build record and the exclusive-access lock live. The harness reads the same
// VAULTSPEND_EXE override, so the guard and the app launcher always agree on which executable is meant.
import path from "node:path";
import { fileURLToPath } from "node:url";

export const repoRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..", "..");
export const BUILD_MODE = "debug";
export const lockDir = path.resolve(process.env.VAULTSPEND_ACCESS_DIR ?? path.join(repoRoot, "target", ".vs-access"));
export const exePath = path.resolve(process.env.VAULTSPEND_EXE ?? path.join(repoRoot, "target", "debug", "vaultspend.exe"));
export const recordPath = path.resolve(process.env.VAULTSPEND_ARTIFACT_RECORD ?? path.join(path.dirname(exePath), "vaultspend.artifact.json"));
export const lastRunPath = path.resolve(process.env.VAULTSPEND_LAST_RUN ?? path.join(repoRoot, "target", "e2e-last-run.json"));
