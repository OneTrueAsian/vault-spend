// npm run e2e:review: a local vision model (Ollama, qwen3.6:35b, thinking off) reviews kept screenshots and writes a short summary, so an
// agent opens only the flagged ones instead of loading every image. The prompt is the one measured in the 17 November 2026 trial:
// 9 of 12 seeded faults caught, 1 of 64 good screens flagged. It does not notice missing content (spec 415's DOM checks cover that).
// A pass is a hint, never acceptance.
import { spawn } from "node:child_process";
import fs from "node:fs";
import path from "node:path";

export const DEFAULT_MODEL = "qwen3.6:35b";
export const DEFAULT_HOST = "http://127.0.0.1:11434";

export class ModelUnavailableError extends Error {
  constructor(message) { super(message); this.name = "ModelUnavailableError"; }
}

const SYSTEM = `You are a careful UI quality reviewer for the Vault Spend desktop budgeting app. You review one screenshot and report only problems you can actually see.
Design facts (these are correct, never report them):
- The left navigation sidebar is always dark navy, in both light and dark themes. Judge the theme from the main content area only.
- Content continuing below the bottom of the window is normal scrolling. The scrollbar is normal.
- Grouped rows such as "Everything else (5)" are intended summaries, not missing items.
Check in this order:
1. Theme: the main content area uses one theme everywhere (no panel or patch in the other theme), matching the expected theme if one is given.
2. Panel by panel: every panel (a box with a heading) has content in its body. A heading with an empty body, or a chart area with axes or a frame but no lines or bars, is a defect.
3. Edges: every line of text ends inside its panel's border. Text crossing a panel border, or cut off mid-word at an edge, is a defect. Nothing overlaps other content.
4. Values and messages: money is formatted as currency (no "NaN", "undefined"), and there are no error messages.
5. Alignment: panel edges and rows line up.
If every check passes, verdict "pass" with no issues. If anything is clearly wrong, verdict "fail" and name each issue with where it is on screen. Use "unsure" only when the image does not let you tell.`;

const FORMAT = {
  type: "object",
  properties: { verdict: { type: "string", enum: ["pass", "fail", "unsure"] }, issues: { type: "array", items: { type: "string" } } },
  required: ["verdict", "issues"],
};

// Where the Windows installer puts Ollama when it is not on PATH.
const installedOllama = () => {
  const local = process.env.LOCALAPPDATA && path.join(process.env.LOCALAPPDATA, "Programs", "Ollama", "ollama.exe");
  const onPath = (process.env.PATH ?? "").split(path.delimiter).map((d) => path.join(d, process.platform === "win32" ? "ollama.exe" : "ollama"));
  return [...onPath, local].find((p) => p && fs.existsSync(p));
};

// Returns "running" (already up), "started" (we launched ollama serve and it answered) or "not-started" (the review will then exit 3).
// Only a server on this machine is started; it is left running afterwards, like the Ollama tray app would.
export async function ensureOllama({ host = DEFAULT_HOST, fetchImpl = fetch, spawnImpl = spawn, ollamaPath = installedOllama(), pollMs = 500, waitMs = 30000, log = console.log } = {}) {
  const answers = async () => { try { return (await fetchImpl(`${host}/api/version`)).ok; } catch { return false; } };
  if (await answers()) return "running";
  if (!/^https?:\/\/(127\.0\.0\.1|localhost)(:|\/|$)/.test(host) || !ollamaPath || !fs.existsSync(ollamaPath)) return "not-started";
  log(`Ollama is not running; starting ${ollamaPath} serve`);
  const child = spawnImpl(ollamaPath, ["serve"], { detached: true, stdio: "ignore", windowsHide: true });
  child.on("error", () => {});
  child.unref();
  for (const end = Date.now() + waitMs; Date.now() < end; ) {
    await new Promise((r) => setTimeout(r, pollMs));
    if (await answers()) return "started";
  }
  return "not-started";
}

export function findScreens(dir) {
  return fs.readdirSync(dir, { recursive: true })
    .map(String).filter((f) => f.toLowerCase().endsWith(".png"))
    .map((f) => path.join(dir, f)).sort();
}

export function promptFor(file) {
  const name = path.basename(file);
  const theme = name.match(/-(light|dark)-/)?.[1];
  const width = name.match(/-(\d{3,4})(?:-\d+)?\.png$/i)?.[1];
  const expected = [theme && `the ${theme} theme`, width && `a window ${width}px wide`].filter(Boolean).join(", ");
  return `Screenshot: ${name}.${expected ? ` Expected: ${expected}.` : ""}\n\nReview the screenshot and answer in JSON.`;
}

async function askModel({ file, fetchImpl, model, host, last }) {
  const body = {
    model, stream: false, think: false, format: FORMAT, options: { temperature: 0, num_ctx: 8192 },
    messages: [{ role: "system", content: SYSTEM }, { role: "user", content: promptFor(file), images: [fs.readFileSync(file).toString("base64")] }],
    ...(last ? { keep_alive: 0 } : {}),
  };
  let res;
  try { res = await fetchImpl(`${host}/api/chat`, { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify(body) }); }
  catch (error) { throw new ModelUnavailableError(`Ollama did not answer at ${host} (${error.message})`); }
  if (!res.ok) {
    const detail = await res.text().catch(() => "");
    if (res.status === 404 || /not found/i.test(detail)) throw new ModelUnavailableError(`model ${model} is not available: ${detail.slice(0, 200)}`);
    // One screenshot the model cannot take (for example a truncated PNG) is that screenshot's problem, not the whole review's.
    return { verdict: "unsure", issues: [`Ollama error ${res.status}: ${detail.slice(0, 200)}`] };
  }
  let content;
  try { content = (await res.json())?.message?.content ?? ""; }
  catch (error) { return { verdict: "unsure", issues: [`unreadable Ollama reply: ${error.message}`] }; }
  try {
    const parsed = JSON.parse(content);
    if (!["pass", "fail", "unsure"].includes(parsed.verdict)) throw new Error("no verdict");
    return { verdict: parsed.verdict, issues: Array.isArray(parsed.issues) ? parsed.issues.map(String) : [] };
  } catch { return { verdict: "unsure", issues: [`unparseable reply: ${content.slice(0, 200)}`] }; }
}

export function formatSummary(dir, verdicts, model = DEFAULT_MODEL, stopped = null) {
  if (verdicts.length === 0 && !stopped) return `Local review (${model}): No screenshots found in ${dir}. Nothing was reviewed.\n`;
  const count = (v) => verdicts.filter((r) => r.verdict === v).length;
  const rel = (f) => path.relative(dir, f).replace(/\\/g, "/");
  return [
    ...(stopped ? [`INCOMPLETE: Stopped after ${verdicts.length} of ${stopped.total} screenshots (${stopped.reason}). Open the unreviewed screenshots directly.`] : []),
    `Local review (${model}): ${verdicts.length} screenshots, ${count("pass")} look right, ${count("fail")} flagged, ${count("unsure")} unsure. A pass is a hint, not acceptance.`,
    `Open the flagged and unsure screenshots below, plus at least two passed ones per spec. It does not notice missing content; spec DOM checks cover that.`,
    ...verdicts.filter((r) => r.verdict !== "pass").map((r) => `- [${r.verdict}] ${rel(r.file)}: ${r.issues.join("; ") || "(no detail)"}`),
  ].join("\n") + "\n";
}

export async function reviewScreens({ dir, fetchImpl = fetch, model = DEFAULT_MODEL, host = DEFAULT_HOST, log = console.log }) {
  const files = findScreens(dir), verdicts = [];
  for (const [i, file] of files.entries()) {
    const start = Date.now();
    let answer;
    try { answer = await askModel({ file, fetchImpl, model, host, last: i === files.length - 1 }); }
    catch (error) {
      // The model went away partway: keep what was reviewed, clearly marked as incomplete.
      if (error instanceof ModelUnavailableError && verdicts.length > 0) error.partial = { verdicts, summary: formatSummary(dir, verdicts, model, { total: files.length, reason: error.message }) };
      throw error;
    }
    verdicts.push({ file, ...answer, ms: Date.now() - start });
    log(`${String(i + 1).padStart(String(files.length).length)}/${files.length} ${answer.verdict.padEnd(6)} ${path.relative(dir, file)}`);
  }
  return { verdicts, summary: formatSummary(dir, verdicts, model) };
}
