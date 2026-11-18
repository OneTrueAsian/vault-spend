// Joins the results of the hosted gate's shards into one verdict. The sharded gate must prove what the serial gate proved: every discovered spec
// ran exactly once as a primary run, against the one executable the prepare job built, with every shard's own run valid. Failures and retries are
// reported separately and never merged: a spec that passed only on its retry is a retry, not a clean pass, and a spec that failed is a failure
// whether or not it was retried. The serial gate's retry allowance (a few specs, each retried once, alone) applies to the whole gate, not per shard.
export const GATE_RETRY_BUDGET = 3;

const sorted = list => [...list].sort();

/**
 * expected: every spec the unsharded runner discovers. prepared: the transfer manifest. runAttempt: this workflow run's attempt number.
 * shards: [{ index, meta: { index, total, runAttempt, outcome }, record }] where record is the shard's target/e2e-last-run.json (or undefined when missing).
 */
export function aggregateShardResults({ expected, total, prepared, runAttempt, shards, retryBudget = GATE_RETRY_BUDGET }) {
  const problems = [];
  const failures = [], retries = [], summaries = [];
  const seen = new Map();
  const expectedSet = new Set(expected);
  if (new Set(expected).size !== expected.length || expected.length === 0) problems.push("The expected spec list is empty or has duplicates.");

  for (let index = 1; index <= total; index++) {
    const matching = shards.filter(s => s.index === index);
    if (matching.length !== 1) { problems.push(`Shard ${index}/${total}: expected exactly one result, found ${matching.length}.`); continue; }
    const { meta, record } = matching[0];
    if (!record || typeof record !== "object") { problems.push(`Shard ${index}/${total}: no run record (the shard did not finish its run).`); continue; }
    if (meta?.index !== index || meta?.total !== total) problems.push(`Shard ${index}/${total}: its metadata says ${meta?.index}/${meta?.total}.`);
    // A re-run of only the failed jobs would mix results from different attempts; the gate accepts one attempt end to end.
    if (meta?.runAttempt !== runAttempt) problems.push(`Shard ${index}/${total}: result is from attempt ${meta?.runAttempt}, this is attempt ${runAttempt}. Re-run all jobs, not just the failed ones.`);
    const identity = record.identity ?? {};
    if (record.sourceValid !== true || record.valid !== true) problems.push(`Shard ${index}/${total}: the run is not valid evidence (${(record.problems ?? []).map(p => p.kind).join(", ") || "unknown reason"}).`);
    if (identity.artifactStatus !== "fresh") problems.push(`Shard ${index}/${total}: artifact status was ${identity.artifactStatus}, not fresh.`);
    if (identity.exeSha256 !== prepared.exeSha256) problems.push(`Shard ${index}/${total}: ran executable ${identity.exeSha256}, but the prepare job built ${prepared.exeSha256}.`);
    if (identity.buildKey !== prepared.buildKey) problems.push(`Shard ${index}/${total}: build key ${identity.buildKey} differs from the prepare job's ${prepared.buildKey}.`);
    if (record.concurrency !== 1) problems.push(`Shard ${index}/${total}: ran at concurrency ${record.concurrency}, not 1.`);
    const selected = record.selected ?? [], executed = record.executed ?? [];
    if (sorted(selected).join("|") !== sorted(executed.map(e => e.name)).join("|")) problems.push(`Shard ${index}/${total}: the specs it executed are not the specs it selected.`);
    for (const name of selected) {
      if (!expectedSet.has(name)) problems.push(`Shard ${index}/${total}: ran ${name}, which is not a discovered spec.`);
      if (seen.has(name)) problems.push(`${name} ran in shard ${seen.get(name)} and in shard ${index}.`);
      else seen.set(name, index);
    }
    let passed = 0;
    for (const entry of executed) {
      if (entry.code === 0) passed++;
      else failures.push({ shard: index, name: entry.name, code: entry.code, attempts: entry.attempts?.length ?? 1 });
      if (Array.isArray(entry.attempts) && entry.attempts.length > 1) retries.push({ shard: index, name: entry.name, firstExit: entry.attempts[0].code, finalExit: entry.code, passedOnRetry: entry.code === 0 });
    }
    summaries.push({ shard: index, specs: selected.length, passed, failed: executed.length - passed, seconds: record.elapsedSeconds ?? null });
  }
  for (const name of expected) if (!seen.has(name)) problems.push(`${name} ran in no shard.`);
  const testKeys = new Set(shards.map(s => s.record?.identity?.testKey).filter(Boolean));
  if (testKeys.size > 1) problems.push(`Shards ran different test sources (${testKeys.size} distinct test keys).`);
  if (retries.length > retryBudget) problems.push(`${retries.length} specs were retried across the gate, above the gate-wide budget of ${retryBudget}.`);
  if (failures.length) problems.push(`${failures.length} spec${failures.length === 1 ? "" : "s"} failed: ${failures.map(f => f.name).join(", ")}.`);
  const ranOnce = [...seen.keys()].length;
  return {
    ok: problems.length === 0,
    problems,
    totals: { expected: expected.length, ran: ranOnce, passed: summaries.reduce((n, s) => n + s.passed, 0), failed: failures.length, retried: retries.length, passedOnRetry: retries.filter(r => r.passedOnRetry).length },
    failures, retries, shards: summaries,
  };
}

export function renderSummary(result, { runAttempt, prepared } = {}) {
  const t = result.totals, lines = [];
  lines.push(`## Sharded desktop gate: ${result.ok ? "PASSED" : "FAILED"}`, "");
  lines.push(`Specs: ${t.expected} discovered, ${t.ran} ran as primary runs, ${t.passed} passed, ${t.failed} failed. Retries: ${t.retried} (${t.passedOnRetry} passed on retry).`);
  if (prepared) lines.push(`Executable SHA-256 ${prepared.exeSha256}; build key ${String(prepared.buildKey).slice(0, 16)}; source ${prepared.sourceSha}; attempt ${runAttempt}.`);
  lines.push("", "| Shard | Specs | Passed | Failed | Seconds |", "|---|---|---|---|---|");
  for (const s of result.shards) lines.push(`| ${s.shard} | ${s.specs} | ${s.passed} | ${s.failed} | ${s.seconds ?? "?"} |`);
  if (result.retries.length) { lines.push("", "### Retries (recorded separately from failures)"); for (const r of result.retries) lines.push(`- ${r.name} (shard ${r.shard}): first run exit ${r.firstExit}, ${r.passedOnRetry ? "passed alone on retry" : `failed again (exit ${r.finalExit})`}`); }
  if (result.failures.length) { lines.push("", "### Failures"); for (const f of result.failures) lines.push(`- ${f.name} (shard ${f.shard}): exit ${f.code}${f.attempts > 1 ? ", also failed its retry" : ""}`); }
  if (result.problems.length) { lines.push("", "### Problems"); for (const p of result.problems) lines.push(`- ${p}`); }
  return lines.join("\n") + "\n";
}
