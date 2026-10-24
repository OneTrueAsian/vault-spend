// Desktop spec scheduling (R2). Parallel-safe specs share a bounded pool. An exclusive spec runs completely alone across the whole
// runner: the pool is drained first and nothing else starts until it ends. A spec that is classified in neither list, or in both,
// is exclusive. Every selected spec runs exactly once and appears in the results, including ones cancelled before they started.
const exclusiveNames = config => (Array.isArray(config?.exclusive) ? config.exclusive : Object.keys(config?.exclusive ?? {}));
const parallelNames = config => (Array.isArray(config?.parallelSafe) && config.parallelSafe.every(name => typeof name === "string") ? config.parallelSafe : []);
import crypto from "node:crypto";

/** Conservative union: all compiled inputs and executable harness sources, including helpers/fixtures not statically resolved.
 * The approval registry is data, not executable code, and must be excluded to avoid a self-referential approval key.
 * It remains in the guard's full validation manifest, so editing it during a run invalidates that run. */
export function createApprovalContext({ inputs, identity, registry = {} }) {
  const sources = Object.entries(inputs ?? {}).filter(([p]) => !/\.test\.(?:mjs|tsx?)$/.test(p) && !p.endsWith(".md") && p !== "e2e/parallel-approvals.json").sort(([a], [b]) => a < b ? -1 : a > b ? 1 : 0);
  return {
    binding: { buildKey: identity?.buildKey, exeSha256: identity?.exeSha256, sourceKey: crypto.createHash("sha256").update(JSON.stringify(sources)).digest("hex") },
    receipts: registry.receipts ?? {},
  };
}

const sameBinding = (a, b) => ["buildKey", "exeSha256", "sourceKey"].every(k => typeof a?.[k] === "string" && a[k].length > 0 && a[k] === b?.[k]);

function approved(name, config, context) {
  if (!context) return true; // low-level legacy API; the real classified CLI always supplies a context
  const approval = config?.approvals?.[name];
  if (!sameBinding(approval?.binding, context.binding) || !Array.isArray(approval.receipts) || new Set(approval.receipts).size < 2) return false;
  if (new Set(approval.receipts.map(id => context.receipts?.[id]?.receiptSha256 ?? id)).size < 2) return false;
  const runIds = approval.receipts.map(id => context.receipts?.[id]?.runId);
  if (runIds.some(id => typeof id !== "string" || !id) || new Set(runIds).size < 2) return false;
  return approval.receipts.every(id => {
    const r = context.receipts?.[id];
    if (!r || r.id !== id || r.valid !== true || !Number.isInteger(r.concurrency) || r.concurrency < Math.max(2, context.concurrency ?? 2) || !sameBinding(r.binding, context.binding)) return false;
    // A truncated, duplicate or failing group cannot approve one of its lucky passing cases.
    return Array.isArray(r.specs) && r.specs.every(n => typeof n === "string" && n.length > 0) && r.specs.includes(name) && new Set(r.specs).size === r.specs.length && r.specs.length >= 2
      && Array.isArray(r.results) && r.results.length === r.specs.length
      && r.results.every(x => x && typeof x.name === "string")
      && new Set(r.results.map(x => x.name)).size === r.specs.length
      && r.results.every(x => r.specs.includes(x.name) && x.code === 0 && !x.notRun && !x.timedOut);
  });
}

export function classifySpecs(specs, config, approvalContext) {
  const safe = new Set(parallelNames(config)), exclusive = new Set(exclusiveNames(config));
  const candidates = specs.filter(name => safe.has(name) && !exclusive.has(name) && approved(name, config, approvalContext));
  // Independent proof pools cannot be silently composed into a new concurrent cohort.
  const parallel = candidates.filter(name => !approvalContext || config.approvals[name].receipts.every(id => candidates.every(other => approvalContext.receipts[id].specs.includes(other))));
  return { parallel, exclusive: specs.filter(name => !parallel.includes(name)) };
}

export function validateClassification(specs, config) {
  const known = new Set(specs), problems = [], seen = new Set();
  const safe = parallelNames(config), exclusive = exclusiveNames(config);
  for (const name of safe) {
    if (seen.has(name)) problems.push({ kind: "duplicate", name });
    seen.add(name);
    if (!known.has(name)) problems.push({ kind: "unknown-spec", name, list: "parallelSafe" });
  }
  for (const name of exclusive) {
    if (!known.has(name)) problems.push({ kind: "unknown-spec", name, list: "exclusive" });
    if (seen.has(name) && known.has(name)) problems.push({ kind: "both-lists", name });
  }
  return problems;
}

/** Longest recorded duration first; specs with no history keep their given order after those that have one. */
function longestFirst(names, durations) {
  const known = names.filter(name => durations[name] !== undefined).sort((a, b) => durations[b] - durations[a]);
  return [...known, ...names.filter(name => durations[name] === undefined)];
}

export async function runSchedule({ specs, classification, approvalContext, concurrency, run, durations = {}, signal }) {
  if (!Number.isInteger(concurrency) || concurrency < 1) throw new Error(`concurrency must be a positive integer, got ${JSON.stringify(concurrency)}`);
  if (new Set(specs).size !== specs.length) throw new Error("A spec was selected more than once; each spec runs exactly once.");
  const { parallel, exclusive } = classifySpecs(specs, classification, approvalContext && { ...approvalContext, concurrency });
  const results = [], started = new Set();

  async function runOne(name) {
    started.add(name);
    try { results.push(await run(name)); } catch (error) {
      results.push({ name, code: 1, output: `\n[run-all] the runner failed for "${name}": ${error?.stack || error}\n`, durationMs: 0 });
    }
  }
  async function pool(names, limit) {
    let next = 0;
    const worker = async () => { while (next < names.length && !signal?.aborted) await runOne(names[next++]); };
    await Promise.all(Array.from({ length: Math.min(limit, names.length) }, worker));
  }

  await pool(longestFirst(parallel, durations), concurrency); // every parallel worker has finished before any exclusive spec starts
  await pool(longestFirst(exclusive, durations), 1);
  for (const name of specs) {
    if (!started.has(name)) results.push({ name, code: 1, notRun: true, output: "\n[run-all] not run: the run was cancelled before this spec started\n", durationMs: 0 });
  }
  return results;
}
