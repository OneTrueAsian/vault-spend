// @vitest-environment node
import { describe, expect, it, vi } from "vitest";
import { StageRecorder, stageProblems, beginStageSample, finishStageSample, traceInvoke, traceReadStart, traceReviewPublisher, traceReviewCommit, traceValidator, type StageCommand, type NativeStageSnapshot } from "./retirementStageTrace";
const command: StageCommand = "get_ask_vault_retirement_context";
async function complete() {
  let time = 0; const r = new StageRecorder(17, () => time);
  r.claim(() => { time += 2; });
  const raw = await r.invoke(command, async () => { time += 3; return "private amount and account"; });
  expect(r.validate(command, () => { time++; return raw; })).toBe(raw);
  r.publish(); time++; r.commit(); time++; r.frame();
  const js = r.finish();
  const native: NativeStageSnapshot = { sample: 17, overflow: false, rows: [{ ordinal: 1, command, handlerMs: 2, lockMs: 0, readMs: 1, ok: true }] };
  return { js, native };
}
describe("debug retirement stage evidence integrity", () => {
  it("captures the six-stage flow with safe metadata, preserving app values", async () => {
    const { js, native } = await complete();
    expect(js.calls).toHaveLength(1); expect(js.calls[0]).toMatchObject({ ordinal: 1, command, dispatchMs: 3, invokeMs: 3, validationMs: 1, ok: true });
    expect(js.marks.map(m => m.stage)).toEqual(["parse", "publish", "commit", "frame"]);
    expect(stageProblems(js, native, "flow")).toEqual([]);
    expect(JSON.stringify(js)).not.toContain("private");
  });
  it.each([0, -1, 1.2, NaN, Infinity, Number.MAX_SAFE_INTEGER + 1])("refuses invalid generated sample %s", sample => {
    expect(() => new StageRecorder(sample)).toThrow();
  });
  it("rejects mismatched native sample, command, ordinal and missing/duplicate rows", async () => {
    const { js, native } = await complete();
    for (const broken of [{ ...native, sample: 18 }, { ...native, rows: [] }, { ...native, rows: [...native.rows, ...native.rows] }, { ...native, rows: [{ ...native.rows[0], ordinal: 2 }] }, { ...native, rows: [{ ...native.rows[0], command: "get_ask_vault_retirement_accounts" as const }] }]) expect(stageProblems(js, broken, "flow").length).toBeGreaterThan(0);
  });
  it("does not confuse native-only samples with an NLP/UI flow", async () => {
    const { js, native } = await complete();
    const noUi = { ...js, marks: [] };
    expect(stageProblems(noUi, native, "native")).toEqual([]);
    expect(stageProblems(noUi, native, "flow").length).toBeGreaterThan(0);
  });
  it("rejects missing validators, nonfinite/negative timing, native errors and overflow", async () => {
    const { js, native } = await complete();
    for (const call of [{ ...js.calls[0], validationMs: null }, { ...js.calls[0], invokeMs: NaN }, { ...js.calls[0], dispatchMs: -1 }, { ...js.calls[0], ok: false }]) expect(stageProblems({ ...js, calls: [call] }, native, "flow").length).toBeGreaterThan(0);
    expect(stageProblems(js, { ...native, overflow: true }, "flow").length).toBeGreaterThan(0);
    expect(stageProblems(js, { ...native, rows: [{ ...native.rows[0], readMs: null, ok: false }] }, "flow").length).toBeGreaterThan(0);
  });
  it("keeps native and JS clock domains separate", async () => {
    const { js, native } = await complete();
    expect(stageProblems(js, { ...native, rows: [{ ...native.rows[0], handlerMs: 1000, readMs: 999 }] }, "flow")).toEqual([]);
  });
  it("preserves thrown application exceptions and records failure without their contents", async () => {
    const r = new StageRecorder(1); const error = new Error("financial secret");
    await expect(r.invoke(command, async () => { throw error; })).rejects.toBe(error);
    const out = r.finish(); expect(out.calls).toHaveLength(1); expect(out.calls[0].ok).toBe(false); expect(JSON.stringify(out)).not.toContain(error.message);
    const validator = new StageRecorder(2); await validator.invoke(command, async () => 1);
    expect(() => validator.validate(command, () => { throw error; })).toThrow(error);
    expect(validator.finish().errors.length).toBeGreaterThan(0);
  });
  it("marks overlapping calls and pending/late replies invalid without changing app execution", async () => {
    const r = new StageRecorder(1); let resolve!: (v: number) => void;
    const pending = r.invoke(command, () => new Promise<number>(done => { resolve = done; }));
    await r.invoke(command, async () => 2);
    const out = r.finish(); expect(out.errors.length).toBeGreaterThan(0);
    resolve(3); expect(await pending).toBe(3); expect(JSON.stringify(out)).toBe(JSON.stringify(r.finish()));
  });
  it("invalidates cancelled/unmounted and overflowed spans; cannot contaminate a new sample", async () => {
    const old = new StageRecorder(1, () => 0, 1); old.publish(); old.commit(); old.frame(); old.cancel();
    expect(old.finish().errors.length).toBeGreaterThan(0);
    const next = new StageRecorder(2); expect(next.finish().sample).toBe(2);
    expect(old.finish().sample).toBe(1);
  });
  it("never records an arbitrary command string", async () => {
    const r = new StageRecorder(1);
    await r.invoke("private financial payload" as StageCommand, async () => 42);
    const out = r.finish(); expect(JSON.stringify(out)).not.toContain("private financial payload");
    expect(out.errors.length).toBeGreaterThan(0);
  });
  it("rejects duplicated review and frame marks instead of hiding an extra render", async () => {
    const { js, native } = await complete();
    for (const stage of ["parse", "publish", "commit", "frame"] as const) {
      expect(stageProblems({ ...js, marks: [...js.marks, { stage, ms: 1 }] }, native, "flow")).toContain("missing-ui-stages");
    }
  });
  it("does not hand off a sample during the full async read, including source checks", () => {
    beginStageSample(101);
    const end = traceReadStart(command);
    expect(() => finishStageSample()).toThrow("in flight");
    expect(() => beginStageSample(102)).toThrow("already active");
    end(); end(); // cleanup is idempotent
    expect(finishStageSample().sample).toBe(101);
  });
  it("keeps late validators and review callbacks attached to the old sample", async () => {
    beginStageSample(201);
    const validate = traceValidator(command, value => value);
    const publish = traceReviewPublisher();
    await traceInvoke(command, async () => 7);
    const old = finishStageSample();
    beginStageSample(202);
    const screen = {};
    publish(screen); expect(validate(7)).toBe(7);
    vi.stubGlobal("requestAnimationFrame", (fn: () => void) => { fn(); return 1; });
    vi.stubGlobal("cancelAnimationFrame", () => {});
    try { traceReviewCommit(screen)(); } finally { vi.unstubAllGlobals(); }
    const next = finishStageSample();
    expect(next).toMatchObject({ sample: 202, calls: [], marks: [], errors: [] });
    expect(old.errors).toContain("incomplete-call");
    expect(old.marks).toEqual([]);
  });
  it("classifies incidental native work without retaining arbitrary command text", async () => {
    beginStageSample(301);
    expect(await traceInvoke("get_transaction_context", async () => 1)).toBe(1);
    expect(await traceInvoke("private arbitrary command", async () => 2)).toBe(2);
    const out = finishStageSample();
    expect(out).toMatchObject({ incidental: [{ kind: "source-context", ok: true }, { kind: "other", ok: true }] });
    expect(JSON.stringify(out)).not.toContain("private arbitrary command");
  });
});
