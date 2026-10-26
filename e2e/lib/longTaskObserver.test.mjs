import { describe, expect, it, vi } from "vitest";
import { observationVerdict, catalogueVerdict, positiveLongTaskControl } from "./longTaskObserver.mjs";

// Task 7 E / PF-06: Open-Items-and-Proposed-Checks.md:98-102 and owner continuation.
const entry = (startTime, duration) => ({ startTime, duration, entryType: "longtask", name: "self" });
const sample = (over = {}) => ({ supported: true, observerInstalled: 1, start: 100, submitted: 101, acknowledged: 120, end: 125, flushedAt: 200, pendingFlushed: true, completed: true, entries: [], ...over });
const launch = (over = {}) => ({ controls: [{ start: 10, end: 71, entries: [entry(10, 61)] }, { start: 500, end: 561, entries: [entry(500, 61)] }], observations: [sample({ phase: "first-load" }), sample({ phase: "post-reload", start: 300, submitted: 301, acknowledged: 320, end: 325, flushedAt: 400 })], ...over });
describe("long-task observation validity fails closed", () => {
  it("runs the deliberate busy control in a scheduled browser task, rather than blocking the injected WebDriver evaluation", async()=>{
    vi.useFakeTimers();let clock=100;const now=vi.spyOn(performance,"now").mockImplementation(()=>clock++);
    vi.stubGlobal("window",{__task7LongTask:{entries:[],observer:{takeRecords:()=>[]}}});const done=vi.fn();
    try{positiveLongTaskControl(done);expect(now).not.toHaveBeenCalled();expect(done).not.toHaveBeenCalled();await vi.runAllTimersAsync();expect(done).toHaveBeenCalledOnce();expect(done.mock.calls[0][0].end-done.mock.calls[0][0].start).toBeGreaterThanOrEqual(60);}
    finally{vi.restoreAllMocks();vi.unstubAllGlobals();vi.useRealTimers();}
  });
  it("requires supported longtask, observer before submit, rendering acknowledgement and flushed pending entries", () => {
    for (const patch of [{ supported: false }, { observerInstalled: 102 }, { acknowledged: null }, { end: 110 }, { pendingFlushed: false }, { completed: false }, { flushedAt: 110 }, { start: NaN }]) {
      expect(observationVerdict(sample(patch), launch().controls).status, JSON.stringify(patch)).toBe("INCOMPLETE");
    }
  });
  it("accepts an empty interval only with recorded positive controls before first and after last observation", () => {
    expect(observationVerdict(sample(), launch().controls).status).toBe("VERIFIED");
    for (const controls of [[], [{ start: 10, end: 71, entries: [] }], [{ start: 105, end: 166, entries: [entry(105, 61)] }]]) expect(observationVerdict(sample(), controls).status).toBe("INCOMPLETE");
  });
  it("requires two controls, and a 60ms control cannot masquerade as a short task", () => {
    const controls=launch().controls;
    expect(observationVerdict(sample(), controls.slice(0,1)).status).toBe("INCOMPLETE");
    expect(observationVerdict(sample(), [{...controls[0],entries:[entry(10,49)]},controls[1]]).status).toBe("INCOMPLETE");
  });
  it("recognizes the whole browser task containing the deliberate control, even when it began before the function timestamp", () => {
    const controls=launch().controls;controls[0]={start:12,end:73,entries:[entry(10,65)]};
    expect(observationVerdict(sample(),controls).status).toBe("VERIFIED");
    controls[0]={start:12,end:73,entries:[entry(14,61)]};
    expect(observationVerdict(sample(),controls).status).toBe("INCOMPLETE");
  });
  it("applies strict >50ms and includes tasks crossing the start boundary; controls stay outside", () => {
    expect(observationVerdict(sample({ entries: [entry(101, 50)] }), launch().controls).status).toBe("VERIFIED");
    expect(observationVerdict(sample({ entries: [entry(99, 51)] }), launch().controls).status).toBe("VIOLATION");
    expect(observationVerdict(sample({ entries: [entry(101, 60)] }), launch().controls).status).toBe("VIOLATION");
    expect(observationVerdict(sample({ entries: [entry(10, 61), entry(500, 61)] }), launch().controls).status).toBe("VERIFIED");
  });
  it("never turns malformed task data into no long tasks", () => {
    for(const entries of [[entry(101,NaN)],[entry(101,-1)],[{duration:60}]]) expect(observationVerdict(sample({entries}), launch().controls).status).toBe("INCOMPLETE");
  });
});
describe("the approved launch catalogue", () => {
  const complete=()=>["ordinary","m3","m4"].flatMap(flow=>["concentrated","spread"].flatMap(shape=>Array.from({length:10},(_,index)=>({...launch(),flow,shape,index}))));
  it("requires exactly 60 unique launches and separates 60 first-load and 60 post-reload observations", () => {
    const verdict=catalogueVerdict(complete());expect(verdict.status).toBe("VERIFIED");expect(verdict.firstLoad.count).toBe(60);expect(verdict.postReload.count).toBe(60);
    expect(catalogueVerdict(complete().slice(1)).status).toBe("INCOMPLETE");
    expect(catalogueVerdict([...complete(),complete()[0]]).status).toBe("INCOMPLETE");
  });
  it("does not pool away a first-load violation or incomplete post-reload evidence", () => {
    const rows=complete(); rows[0].observations[0].entries=[entry(101,51)];expect(catalogueVerdict(rows).status).toBe("VIOLATION");
    rows[0].observations[1].pendingFlushed=false;expect(catalogueVerdict(rows).status).toBe("INCOMPLETE");
  });
});
