// `npm run demo:statements` — opens the REAL compiled app on the shared practice data (see e2e/demo.mjs and
// e2e/lib/practice-data/), whose files/ folder holds practice statement PDFs and CSV downloads for the
// statement-file accounts (Practice Checking, Riverbend Checking, Harborview Brokerage, Corner Credit Union).
// files/README.txt lists each file's dates and what to expect. Flags: --keep (reopen without rebuilding),
// --seed (rebuild only).

import path from "node:path";
import { fileURLToPath } from "node:url";
import { runPracticeLauncher } from "./lib/practice-data/launcher.mjs";

const repoRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
await runPracticeLauncher({
  repoRoot,
  args: new Set(process.argv.slice(2)),
  extraNote: `Practice statements and their dates: ${path.join(repoRoot, ".demo-data", "files", "README.txt")}`,
});
