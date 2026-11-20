// npm run e2e:review: a local vision model (Ollama, qwen3.6:35b, thinking off) reviews kept screenshots and writes a short summary, so an
// agent opens only the flagged ones instead of loading every image. The prompt was chosen on 19 November 2026 against 254 hand-labelled
// screenshots from that day's full QA audit: it sent 34 of 40 real defects for a look (the earlier prompt: 33) and 65 of 98 known false
// alarms (earlier: 93). It does not check for missing content (spec 415's DOM checks cover that). A pass is a hint, never acceptance.
import { spawn } from "node:child_process";
import fs from "node:fs";
import path from "node:path";

export const DEFAULT_MODEL = "qwen3.6:35b";
export const DEFAULT_HOST = "http://127.0.0.1:11434";

export class ModelUnavailableError extends Error {
  constructor(message) { super(message); this.name = "ModelUnavailableError"; }
}

// Most false alarms on real screens were deliberate design read as a fault (dimmed page behind a dialog, menus and toasts on top,
// Retro bevels, scrolling), so the prompt describes that design and asks only for six concrete kinds of problem.
const SYSTEM = `You are a careful UI quality reviewer for the Vault Spend desktop budgeting app. You look at one screenshot and report only clear layout problems you can point to.
How the app is meant to look. These are correct, never report them:
- The left sidebar is dark navy in every theme. Judge light or dark from the main content area only.
- When a dialog is open, the page behind it is dimmed or blurred on purpose. Judge the dialog itself and ignore the page behind it. Exception: if page text can be read through the dialog's own panel, report that.
- Menus, dropdown lists, tooltips, popovers and pop-up messages sit on top of the page on purpose. Report one only if it covers a dialog's own buttons.
- The Retro style has grey panels with double, bevelled borders and square corners. The Futuristic style has neon outlines and glows. These borders are correct.
- Content running past the bottom of the window is normal scrolling, and scrollbars are normal. A wide table that scrolls sideways in a narrow window is normal.
- A short sentence such as "No transactions yet" is the content of an empty panel. A grid of day numbers is the daily spending heatmap.
- A note under a field that says what to type is intended. Very long names and very large amounts are test data.
Report only these problems:
1. Text drawn on top of other text, so that one of them is hard to read.
2. Text, a number or a button cut off at the left or right edge of its panel, card or the window.
3. One money amount split across two lines.
4. A table whose row labels have scrolled out of view, leaving numbers with no label.
5. A panel or patch in the other theme (a light box on a dark screen or the reverse), or a main area in the wrong theme when an expected theme is given. The dimmed page behind a dialog does not count.
6. Raw technical text: "NaN", "undefined", "null", "[object Object]", a stack trace or an error code.
For each problem give where it is (the panel heading or area), what you see (quote the visible text), the number of the problem type above, and whether you are sure. If you would need words like "may", "might", "appears" or "seems", set sure to false. If none of the six problems is visible, return an empty list.`;

const FORMAT = {
  type: "object",
  properties: {
    issues: {
      type: "array",
      items: {
        type: "object",
        properties: { where: { type: "string" }, seen: { type: "string" }, type: { type: "integer", minimum: 1, maximum: 6 }, sure: { type: "boolean" } },
        required: ["where", "seen", "type", "sure"],
      },
    },
  },
  required: ["issues"],
};

// Any sure issue fails the screen; issues the model is not sure about send it for a look as "unsure".
const verdictFor = (issues) => (issues.some((i) => i.sure) ? "fail" : issues.length ? "unsure" : "pass");
const describeIssue = (i) => `${i.where}: "${i.seen}"${i.sure ? "" : " (not sure)"}`;

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
  const width = name.match(/-(\d{3,4})(?:x\d+)?(?:-\d+)?\.png$/i)?.[1] ?? name.match(/-(\d{3,4})(?:x\d+)?-/)?.[1];
  const style = /retro/i.test(name) ? "Retro" : /futuristic/i.test(name) ? "Futuristic" : /default|transparent/i.test(name) ? "Default" : null;
  const expected = [style && `the ${style} style`, theme && `the ${theme} theme`, width && `a window ${width}px wide`].filter(Boolean).join(", ");
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
    if (!Array.isArray(parsed.issues)) throw new Error("no issues list");
    return { verdict: verdictFor(parsed.issues), issues: parsed.issues.map(describeIssue) };
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
