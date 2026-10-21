// node e2e/with-access.mjs <operation> -- <command> [args...]
// Runs a command that uses the shared target\ directory (cargo build/test/clippy, a hand-run tauri command) while holding exclusive
// access, waiting for any build or desktop run to finish first. It never stops another process. Unit tests, lint and tsc do not
// need it. Example: node e2e/with-access.mjs cargo-test -- cargo test -p budget_core -- --test-threads=1
import { spawn } from "node:child_process";
import { lockDir, repoRoot } from "./lib/accessPaths.mjs";
import { acquireAccess } from "./lib/exclusiveAccess.mjs";

const separator = process.argv.indexOf("--");
const operation = process.argv[2];
if (separator < 3 || separator === process.argv.length - 1 || !operation || operation === "--") {
  console.error("Usage: node e2e/with-access.mjs <operation> -- <command> [args...]");
  process.exit(64);
}
const [command, ...args] = process.argv.slice(separator + 1);
let lock;
try { lock = await acquireAccess({ dir: lockDir, operation, wait: true, timeoutMs: Number(process.env.VAULTSPEND_ACCESS_TIMEOUT_MS ?? 30 * 60 * 1000) }); } catch (error) { console.error(error.message); process.exit(2); }
// No shell by default, so arguments (quotes, spaces) reach the program exactly as given. Windows needs a shell only for .cmd launchers
// such as npx; those get each argument quoted.
const quote = arg => `"${String(arg).replaceAll('"', '\\"')}"`;
function start(useShell) {
  const child = useShell ? spawn([command, ...args.map(quote)].join(" "), { cwd: repoRoot, stdio: "inherit", shell: true }) : spawn(command, args, { cwd: repoRoot, stdio: "inherit" });
  let failedToStart = false; // a program that never started also emits "close"; that must not end the wrapper before the retry
  child.on("error", error => {
    failedToStart = true;
    if (!useShell && process.platform === "win32" && ["ENOENT", "EINVAL"].includes(error.code)) return start(true);
    console.error(error.message); lock.release(); process.exit(127);
  });
  child.on("close", code => { if (failedToStart) return; lock.release(); process.exit(code ?? 1); });
}
start(false);
