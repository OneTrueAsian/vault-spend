/** Acceptance-driver helper only; never imported by the application. */
export function validateRetirementPerformanceEvidence(evidence: unknown): { pass: boolean; errors: string[] } {
  const errors: string[] = [];
  const object = (v: unknown): v is Record<string, unknown> => v !== null && typeof v === "object" && !Array.isArray(v);
  const array = (v: unknown): v is unknown[] => Array.isArray(v);
  const finite = (v: unknown): v is number => typeof v === "number" && Number.isFinite(v) && v >= 0;
  const metric = (v: unknown, n: number, limit: number, useMax = false): boolean => object(v) && v.n === n && finite(v.p50) && finite(v.p95) && finite(v.max) && v.p50 <= v.p95 && v.p95 <= v.max && (useMax ? v.max : v.p95) <= limit;
  const same = (v: unknown, expected: unknown[]) => array(v) && v.length === expected.length && new Set(v).size === expected.length && expected.every(x => v.includes(x));
  if (!object(evidence) || !object(evidence.environment) || !object(evidence.protocol) || !array(evidence.groups) || !array(evidence.failures)) return { pass: false, errors: ["Malformed evidence"] };
  const env = evidence.environment, protocol = evidence.protocol, mode = env.mode;
  if (!["warm", "cold", "control"].includes(String(mode))) errors.push("Unknown mode");
  if (typeof env.power !== "string" || !env.power.trim() || /not recorded|unavailable/i.test(env.power)) errors.push("Missing power metadata");
  if (!object(env.source) || !/^[a-f0-9]{40}$/.test(String(env.source.head)) || !/^[a-f0-9]{64}$/.test(String(env.source.filesHash)) || !/^[a-f0-9]{64}$/.test(String(env.source.exeSha256))) errors.push("Missing source identity");
  const seeds = mode === "warm" ? [11, 22, 33] : [11];
  if (protocol.warmups !== 5 || protocol.warmSamples !== 30 || protocol.freshStarts !== 10 || !same(protocol.sizes, [1000, 10000, 50000]) || !same(protocol.shapes, ["concentrated", "spread"]) || !same(protocol.seeds, seeds)) errors.push("Incomplete approved protocol");
  if (evidence.failures.length) errors.push("Retained measurement failures");
  const expected = new Set([1000, 10000, 50000].flatMap(size => ["concentrated", "spread"].flatMap(shape => seeds.map(seed => `${size}/${shape}/${seed}`))));
  for (const group of evidence.groups) {
    if (!object(group)) { errors.push("Malformed group"); continue; }
    const key = `${group.size}/${group.shape}/${group.seed}`;
    if (!expected.delete(key)) errors.push("Duplicate or unexpected group");
    if (!array(group.errors) || group.errors.length) errors.push("Retained group errors");
    const s = group.summary;
    if (mode === "warm") {
      if (![group.samples, group.native, group.largestHorizon, group.advanced].every(v => array(v) && v.length === 30) || group.supportsLongTasks !== true || group.activeResultVisible !== true) errors.push("Incomplete warm samples/checkpoint");
      if (!object(s) || !metric(s.inputAck, 30, 100) || !metric(s.cancelAck, 30, 100) || !metric(s.nativeRoundTrip, 30, 300) ||
          ![s.confirmToResult, s.resultPainted, s.questionToReview, s.reviewPainted].every(v => metric(v, 30, 500)) || s.longTasksOver50 !== 0 ||
          ![s.largestHorizon, s.advanced].every(v => object(v) && metric(v.confirm, 30, 500) && metric(v.painted, 30, 500))) errors.push("Invalid or over-limit warm timing");
    } else if (mode === "cold") {
      if (!array(group.starts) || group.starts.length !== 10 || !same(group.starts.map(v => object(v) ? v.i : null), [0, 1, 2, 3, 4, 5, 6, 7, 8, 9]) || group.starts.some(v => !object(v) || !object(v.flow) || !object(v.native) || v.flow.error || v.native.error || !finite(v.flow.questionToReviewMs))) errors.push("Incomplete fresh starts");
      if (!object(s) || !metric(s.firstContextReadUpperBound, 10, 2000, true) || !metric(s.firstQuestionToReview, 10, 2000, true)) errors.push("Invalid or over-limit first flow");
    } else if (mode === "control") {
      if (!finite(group.matchedFlowDurationMs) || group.matchedFlowDurationMs === 0 || !object(group.memory) || !object(group.memory.settled) || !object(group.memory.afterFlowDuration) || !object(group.memory.idle)) errors.push("Missing duration-matched memory control");
    }
  }
  if (expected.size) errors.push("Missing shape/seed groups");
  return { pass: errors.length === 0, errors };
}
