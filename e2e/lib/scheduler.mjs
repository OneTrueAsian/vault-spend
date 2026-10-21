// Desktop spec scheduling (R2). Parallel-safe specs share a bounded pool. An exclusive spec runs completely alone across the whole
// runner: the pool is drained first and nothing else starts until it ends. A spec that is classified in neither list, or in both,
// is exclusive. Every selected spec runs exactly once and appears in the results, including ones cancelled before they started.
const exclusiveNames = config => (Array.isArray(config?.exclusive) ? config.exclusive : Object.keys(config?.exclusive ?? {}));
const parallelNames = config => (Array.isArray(config?.parallelSafe) && config.parallelSafe.every(name => typeof name === "string") ? config.parallelSafe : []);

export function classifySpecs(specs, config) {
  const safe = new Set(parallelNames(config)), exclusive = new Set(exclusiveNames(config));
  const parallel = specs.filter(name => safe.has(name) && !exclusive.has(name));
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

export async function runSchedule({ specs, classification, concurrency, run, durations = {}, signal }) {
  if (!Number.isInteger(concurrency) || concurrency < 1) throw new Error(`concurrency must be a positive integer, got ${JSON.stringify(concurrency)}`);
  if (new Set(specs).size !== specs.length) throw new Error("A spec was selected more than once; each spec runs exactly once.");
  const { parallel, exclusive } = classifySpecs(specs, classification);
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
