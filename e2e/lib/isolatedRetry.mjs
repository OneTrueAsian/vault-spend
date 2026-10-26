// A hosted full gate runs 255 desktop specs in one go, and a lone intermittent failure in an unrelated spec has failed a whole release run each time. With --retry-failed a
// spec that fails is run once more, alone, after everything else. A spec that then passes counts as passed but is reported as flaky with its first failure kept in full;
// a spec that fails again stays failed. Off unless asked for, so a developer's local run still shows every failure.

const DEFAULT_BUDGET = 3;

/** Reads --retry-failed[=N] (N = the most specs that may be retried). Retrying is only allowed one spec at a time, so a retried pass can never be taken for parallel proof. */
export function parseRetryOptions(argv, concurrency) {
  const flag = argv.find(a => a === "--retry-failed" || a.startsWith("--retry-failed="));
  if (!flag) return { enabled: false };
  let budget = DEFAULT_BUDGET;
  if (flag !== "--retry-failed") {
    const text = flag.slice("--retry-failed=".length);
    budget = Number(text);
    if (!/^\d+$/.test(text) || !Number.isInteger(budget) || budget < 1) throw new Error(`--retry-failed needs a positive whole number of specs, got "${text}"`);
  }
  if (concurrency !== 1) throw new Error("--retry-failed needs --concurrency=1: a retried pass must not count toward parallel-safety proof");
  return { enabled: true, budget };
}

/**
 * Re-runs each failed result once, alone and in order. When more than `budget` specs failed, nothing is retried: that many failures points at something wrong
 * with the build or the machine, not at isolated flakes, and retrying would only hide it.
 * Returns { results (same order, retried ones replaced), flaky: [{ name, firstFailure, retry }], skipped? }. The input is not changed.
 */
export async function retryFailuresInIsolation({ results, run, budget }) {
  const failed = results.filter(r => r.code !== 0);
  if (failed.length === 0) return { results, flaky: [] };
  if (failed.length > budget) return { results, flaky: [], skipped: `${failed.length} specs failed, above the retry budget of ${budget}; nothing was retried because that many failures is not an isolated flake.` };
  const flaky = [], replaced = new Map();
  for (const first of failed) {
    let retry;
    try { retry = await run(first.name); }
    catch (error) {
      replaced.set(first.name, { ...first, output: `${first.output}\n[run-all] the retry could not run (${error.message}); the first failure output is kept in attempts\n`, attempts: [first] });
      continue;
    }
    replaced.set(first.name, { ...retry, attempts: [first, retry] });
    if (retry.code === 0) flaky.push({ name: first.name, firstFailure: first, retry });
  }
  return { results: results.map(r => replaced.get(r.name) ?? r), flaky };
}
