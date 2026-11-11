export type StageCommand = "get_ask_vault_retirement_accounts" | "get_ask_vault_retirement_context";
export type StageCall = { ordinal: number; command: StageCommand; dispatchMs: number | null; invokeMs: number | null; validationMs: number | null; ok: boolean };
export type StageMark = { stage: "parse" | "publish" | "commit" | "frame"; ms: number };
type IncidentalCall = { kind: "source-context" | "other"; invokeMs: number | null; ok: boolean };
export type StageSnapshot = { sample: number; calls: StageCall[]; incidental: IncidentalCall[]; marks: StageMark[]; errors: string[] };
export type NativeStageSnapshot = { sample: number; rows: { ordinal: number; command: StageCommand; handlerMs: number; lockMs: number; readMs: number | null; ok: boolean }[]; overflow: boolean };
export class StageRecorder {
  private calls: StageCall[] = [];
  private marks: StageMark[] = [];
  private incidental: IncidentalCall[] = [];
  private errors = new Set<string>();
  private closed: StageSnapshot | null = null;
  private pending = 0;
  private operations = 0;
  private publicationStart: number | null = null;
  constructor(public readonly sample: number, private clock = () => performance.now(), private limit = 256) {
    if (!Number.isSafeInteger(sample) || sample <= 0 || !Number.isSafeInteger(limit) || limit < 1) throw new Error("Invalid diagnostic sample");
  }
  private duration(start: number): number { const n = this.clock() - start; if (!Number.isFinite(n) || n < 0) this.errors.add("invalid-clock"); return n; }
  private mark(stage: StageMark["stage"], ms: number) {
    if (this.closed) return;
    if (this.calls.length + this.marks.length + this.incidental.length >= this.limit) { this.errors.add("overflow"); return; }
    if (!Number.isFinite(ms) || ms < 0) this.errors.add("invalid-clock");
    this.marks.push({ stage, ms });
  }
  claimStart(): () => void { const start = this.clock(); return () => this.mark("parse", this.duration(start)); }
  claim<T>(fn: () => T): T { const end = this.claimStart(); try { return fn(); } finally { end(); } }
  async invoke<T>(command: StageCommand, fn: () => Promise<T>): Promise<T> {
    if (this.closed) return fn();
    if (!targeted(command)) { this.errors.add("invalid-command"); return fn(); }
    if (this.calls.length + this.marks.length + this.incidental.length >= this.limit) { this.errors.add("overflow"); return fn(); }
    if (this.pending) this.errors.add("overlap");
    const row: StageCall = { ordinal: this.calls.length + 1, command, dispatchMs: null, invokeMs: null, validationMs: null, ok: false };
    this.calls.push(row); this.pending++;
    const start = this.clock();
    try {
      let promise: Promise<T>;
      try { promise = fn(); } finally { row.dispatchMs = this.duration(start); }
      const result = await promise; row.ok = true; return result;
    } finally { row.invokeMs = this.duration(start); this.pending--; }
  }
  async incidentalInvoke<T>(kind: IncidentalCall["kind"], fn: () => Promise<T>): Promise<T> {
    if (this.closed) return fn();
    if (this.calls.length + this.marks.length + this.incidental.length >= this.limit) { this.errors.add("overflow"); return fn(); }
    const row: IncidentalCall = { kind, invokeMs: null, ok: false }, start = this.clock();
    this.incidental.push(row); this.pending++;
    try { const value = await fn(); row.ok = true; return value; }
    finally { row.invokeMs = this.duration(start); this.pending--; }
  }
  validate<T>(command: StageCommand, fn: () => T): T {
    if (this.closed) return fn();
    if (!targeted(command)) { this.errors.add("invalid-command"); return fn(); }
    const row = this.calls.find(c => c.command === command && c.invokeMs !== null && c.validationMs === null && c.ok);
    if (!row) this.errors.add("validation-without-invoke");
    const start = this.clock();
    try { return fn(); } catch (error) { this.errors.add("validation-error"); throw error; }
    finally { if (row) row.validationMs = this.duration(start); }
  }
  publish() { this.publicationStart = this.clock(); this.mark("publish", 0); }
  commit() { if (this.publicationStart === null) this.errors.add("commit-without-publish"); else this.mark("commit", this.duration(this.publicationStart)); }
  frame() { if (this.publicationStart === null) this.errors.add("frame-without-publish"); else this.mark("frame", this.duration(this.publicationStart)); }
  cancel() { if (!this.closed) this.errors.add("cancelled"); }
  workStart(): () => void { this.operations++; let done = false; return () => { if (!done) { done = true; this.operations--; } }; }
  busy() { return this.pending > 0 || this.operations > 0; }
  finish(): StageSnapshot {
    if (!this.closed) {
      if (this.busy()) this.errors.add("pending");
      if (this.calls.some(c => c.validationMs === null || !c.ok)) this.errors.add("incomplete-call");
      this.closed = structuredClone({ sample: this.sample, calls: this.calls, incidental: this.incidental, marks: this.marks, errors: [...this.errors] });
    }
    return structuredClone(this.closed);
  }
}
export function stageProblems(js: StageSnapshot, native: NativeStageSnapshot, kind: "flow" | "native"): string[] {
  const errors: string[] = [], finite = (n: unknown) => typeof n === "number" && Number.isFinite(n) && n >= 0;
  if (js.sample !== native.sample || js.errors.length || native.overflow) errors.push("sample-invalid");
  if (!js.calls.length || native.rows.length !== js.calls.length) errors.push("missing-calls");
  for (const [i, call] of js.calls.entries()) {
    const row = native.rows[i];
    if (!row || call.ordinal !== i + 1 || row.ordinal !== call.ordinal || row.command !== call.command || !call.ok || !row.ok ||
        ![call.dispatchMs, call.invokeMs, call.validationMs, row.handlerMs, row.lockMs, row.readMs].every(finite) || row.handlerMs < (row.readMs ?? 0)) errors.push("call-invalid");
  }
  if (js.marks.some(m => !finite(m.ms))) errors.push("mark-invalid");
  if (js.incidental.some(c => !c.ok || !finite(c.invokeMs))) errors.push("incidental-invalid");
  if (kind === "flow") {
    const stages = js.marks.map(m => m.stage);
    if (stages.filter(s => s === "parse").length !== 1 || stages.filter(s => s === "publish").length !== 1 || stages.filter(s => s === "commit").length !== 1 || stages.filter(s => s === "frame").length !== 1 ||
        stages.indexOf("publish") > stages.indexOf("commit") || stages.indexOf("commit") > stages.indexOf("frame")) errors.push("missing-ui-stages");
  }
  return errors;
}

let active: StageRecorder | null = null;
const reviews = new WeakMap<object, StageRecorder>();
const targeted = (command: string): command is StageCommand => command === "get_ask_vault_retirement_accounts" || command === "get_ask_vault_retirement_context";
export function beginStageSample(sample: number) { if (active) throw new Error("Diagnostic sample already active"); active = new StageRecorder(sample); }
export function finishStageSample() { const held = active; if (!held) throw new Error("No diagnostic sample"); if (held.busy()) throw new Error("Diagnostic work in flight"); active = null; return held.finish(); }
export function traceClaimStart(): () => void {
  return active?.claimStart() ?? (() => {});
}
export function traceInvoke<T>(command: string, fn: () => Promise<T>): Promise<T> {
  const held = active;
  return !held ? fn() : targeted(command) ? held.invoke(command, fn) : held.incidentalInvoke(command === "get_transaction_context" ? "source-context" : "other", fn);
}
export function traceValidate<T>(command: string, fn: () => T): T { const held = active; return held && targeted(command) ? held.validate(command, fn) : fn(); }
export function traceValidator<T>(command: string, fn: (value: unknown) => T): (value: unknown) => T {
  const held = active;
  return held && targeted(command) ? value => held.validate(command, () => fn(value)) : fn;
}
export function traceReadStart(command: string): () => void { return active && targeted(command) ? active.workStart() : () => {}; }
export function traceReviewPublisher(): (screen: object) => void { const held = active; return screen => { if (held) { held.publish(); reviews.set(screen, held); } }; }
export function traceRetire() { active?.cancel(); }
export function traceReviewCommit(screen: object): () => void {
  const held = reviews.get(screen); if (!held) return () => {};
  held.commit(); let done = false;
  const id = requestAnimationFrame(() => { done = true; held.frame(); });
  return () => { cancelAnimationFrame(id); if (!done) held.cancel(); };
}
