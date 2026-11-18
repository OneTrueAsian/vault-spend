// npm run e2e:review -- [folder] [--host=<url>] [--model=<name>]
// Reviews every PNG in the folder (default: the newest run kept by `npm run e2e -- --keep-screens`) with a local vision model and writes
// summary.md (read this) and verdicts.json (every screenshot) into it. Exit 0 when reviewed, 3 when the local model is unavailable
// even after trying to start it (then review the screenshots directly), 1 for anything else. Run it after an E2E run, never during one.
import fs from "node:fs";
import path from "node:path";
import { repoRoot } from "./lib/accessPaths.mjs";
import { DEFAULT_HOST, DEFAULT_MODEL, ModelUnavailableError, ensureOllama, reviewScreens } from "./lib/screenReview.mjs";

const args = process.argv.slice(2);
const flag = (name, fallback) => args.find((a) => a.startsWith(`--${name}=`))?.slice(name.length + 3) ?? fallback;
const host = flag("host", DEFAULT_HOST), model = flag("model", DEFAULT_MODEL);
let dir = args.find((a) => !a.startsWith("--"));
if (!dir) {
  const root = path.join(repoRoot, "target", "e2e-shots");
  const runs = fs.existsSync(root) ? fs.readdirSync(root, { withFileTypes: true }).filter((e) => e.isDirectory()).map((e) => e.name).sort() : [];
  if (runs.length === 0) { console.error("No kept screenshots found. Run the specs with: npm run e2e -- --spec=<specs> --keep-screens"); process.exit(1); }
  dir = path.join(root, runs.at(-1));
}
dir = path.resolve(dir);
if (!fs.existsSync(dir)) { console.error(`Folder not found: ${dir}`); process.exit(1); }

await ensureOllama({ host });
console.log(`Reviewing screenshots in ${dir} with ${model}`);
const write = ({ verdicts, summary }) => {
  fs.writeFileSync(path.join(dir, "verdicts.json"), JSON.stringify(verdicts.map((v) => ({ ...v, file: path.relative(dir, v.file).replace(/\\/g, "/") })), null, 2) + "\n");
  fs.writeFileSync(path.join(dir, "summary.md"), summary);
  console.log(`\n${summary}\nWritten: ${path.join(dir, "summary.md")}`);
};
try {
  write(await reviewScreens({ dir, host, model }));
} catch (error) {
  if (error instanceof ModelUnavailableError) {
    if (error.partial) write(error.partial); // what was reviewed before the model went away, marked INCOMPLETE
    console.error(`Local review unavailable: ${error.message}. Ollama could not be started or answered; check it is installed and pull ${model}, or review the screenshots directly.`);
    process.exit(3);
  }
  throw error;
}
