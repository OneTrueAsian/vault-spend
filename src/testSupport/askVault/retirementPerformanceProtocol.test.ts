import { describe, expect, it } from "vitest";
import { validateRetirementPerformanceEvidence as grade } from "./retirementPerformanceProtocol";

const metric = (value = 1) => ({ n: 30, p50: value, p95: value, max: value });
function warm() {
  return {
    environment: { mode: "warm", power: "Balanced", source: { head: "a".repeat(40), filesHash: "b".repeat(64), exeSha256: "c".repeat(64) } },
    protocol: { warmups: 5, warmSamples: 30, freshStarts: 10, seeds: [11, 22, 33], sizes: [1000, 10000, 50000], shapes: ["concentrated", "spread"] },
    failures: [] as unknown[],
    groups: [1000, 10000, 50000].flatMap(size => ["concentrated", "spread"].flatMap(shape => [11, 22, 33].map(seed => ({
      size, shape, seed, errors: [] as unknown[], samples: Array(30).fill({}), native: Array(30).fill({}), largestHorizon: Array(30).fill({}), advanced: Array(30).fill({}),
      supportsLongTasks: true, activeResultVisible: true,
      summary: { inputAck: metric(), cancelAck: metric(), confirmToResult: metric(), resultPainted: metric(), questionToReview: metric(), reviewPainted: metric(), nativeRoundTrip: metric(), longTasksOver50: 0,
        largestHorizon: { confirm: metric(), painted: metric() }, advanced: { confirm: metric(), painted: metric() } },
    })))),
  };
}
function cold() {
  const w = warm();
  return { ...w, environment: { ...w.environment, mode: "cold" }, protocol: { ...w.protocol, seeds: [11] }, groups: w.groups.filter(g => g.seed === 11).map(g => ({
    size: g.size, shape: g.shape, seed: g.seed, errors: [], starts: Array.from({ length: 10 }, (_, i) => ({ i, flow: { questionToReviewMs: 100 }, native: { rosterMs: 1, contextMs: 1 } })),
    summary: { firstContextReadUpperBound: { ...metric(100), n: 10 }, firstQuestionToReview: { ...metric(100), n: 10 } },
  })) };
}

describe("M5 retained performance evidence gates", () => {
  it("accepts the complete approved warm and fresh-start protocols", () => { expect(grade(warm()).pass).toBe(true); expect(grade(cold()).pass).toBe(true); });
  it.each([null, {}, { environment: { mode: "other" } }])("rejects malformed or unknown-mode evidence %j", evidence => expect(grade(evidence).pass).toBe(false));
  it("rejects missing and duplicate shape/seed groups even when their count is unchanged", () => { const e = warm(); e.groups[0] = e.groups[1]; expect(grade(e).pass).toBe(false); });
  it("rejects a missing group", () => { const e = warm(); e.groups.pop(); expect(grade(e).pass).toBe(false); });
  it("rejects unexpected row counts rather than just checking three sizes", () => { const e = warm(); e.protocol.sizes[0] = 999; expect(grade(e).pass).toBe(false); });
  it("rejects a retained error even if all reported timings pass", () => { const e = warm(); e.groups[0].errors.push({ timeout: true }); expect(grade(e).pass).toBe(false); });
  it("rejects missing, unrecorded and unavailable metadata", () => { for (const power of ["", "not recorded", "unavailable"]) { const e = warm(); e.environment.power = power; expect(grade(e).pass).toBe(false); } });
  it("requires actual file and executable identity including untracked source", () => { const e = warm(); e.environment.source.filesHash = ""; expect(grade(e).pass).toBe(false); });
  it("rejects fewer warmups, samples or fresh starts", () => { const e = warm(); e.protocol.warmups = 4; expect(grade(e).pass).toBe(false); });
  it("rejects absent timing summaries and null/NaN/Infinity rather than coercing them to pass", () => {
    for (const bad of [null, NaN, Infinity, undefined]) { const e = warm(); Object.assign(e.groups[0].summary.nativeRoundTrip, { p95: bad }); expect(grade(e).pass).toBe(false); }
    const e = warm(); Reflect.deleteProperty(e.groups[0], "summary"); expect(grade(e).pass).toBe(false);
  });
  it("requires all 30 advanced samples and the actual active result checkpoint", () => { const e = warm(); e.groups[0].advanced.pop(); expect(grade(e).pass).toBe(false); e.groups[0].advanced.push({}); e.groups[0].activeResultVisible = false; expect(grade(e).pass).toBe(false); });
  it("keeps inclusive 300/500/100 limits and the strictly-over-50 long task policy", () => {
    const e = warm(), s = e.groups[0].summary;
    s.nativeRoundTrip = metric(300); s.resultPainted = metric(500); s.inputAck = metric(100); expect(grade(e).pass).toBe(true);
    s.longTasksOver50 = 1; expect(grade(e).pass).toBe(false); s.longTasksOver50 = 0;
    s.nativeRoundTrip = metric(300.001); expect(grade(e).pass).toBe(false);
  });
  it("also gates largest-horizon and advanced painted time", () => { const e = warm(); e.groups[0].summary.advanced.painted = metric(501); expect(grade(e).pass).toBe(false); });
  it("requires ten distinct fresh launches per shape", () => { const e = cold(); e.groups[0].starts[1].i = 0; expect(grade(e).pass).toBe(false); });
  it("uses first-flow context upper bound, not a subsequently warm native probe", () => {
    const e = cold(); e.groups[0].summary.firstContextReadUpperBound.max = 2001; expect(grade(e).pass).toBe(false);
    e.groups[0].summary.firstContextReadUpperBound.max = 2000; e.groups[0].summary.firstContextReadUpperBound.p95 = 2000; expect(grade(e).pass).toBe(true);
  });
});
