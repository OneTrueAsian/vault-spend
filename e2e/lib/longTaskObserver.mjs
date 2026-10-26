// Task 7 E: test-side evidence validity. No production instrumentation or timing exception.
const finite = n => typeof n === "number" && Number.isFinite(n);
const taskValid = e => e && finite(e.startTime) && finite(e.duration) && e.duration >= 0 && e.entryType === "longtask";
export function observationVerdict(s, controls) {
  const problems = [];
  if (!s || s.supported !== true || !s.completed || !s.pendingFlushed) problems.push("unsupported or incomplete observation");
  if (!s || ![s.observerInstalled,s.start,s.submitted,s.acknowledged,s.end,s.flushedAt].every(finite)
      || !(s.observerInstalled <= s.start && s.start <= s.submitted && s.submitted <= s.acknowledged && s.acknowledged <= s.end && s.end <= s.flushedAt)) problems.push("invalid observer/submit/render/flush timestamps");
  if (!Array.isArray(s?.entries) || !s.entries.every(taskValid)) problems.push("invalid long-task entries");
  if (!Array.isArray(controls) || controls.length !== 2 || controls.some(c => !finite(c.start) || !finite(c.end) || c.end-c.start<60 || !Array.isArray(c.entries) || !c.entries.some(e=>taskValid(e)&&e.duration>=60&&e.startTime<=c.start+1&&e.startTime+e.duration>=c.end-1))) problems.push("missing 60ms positive controls");
  else if (!(controls[0].end < s.start && controls[1].start > s.end)) problems.push("controls overlap or do not bracket the measured interval");
  const tasks=(s?.entries??[]).filter(e=>taskValid(e)&&e.startTime < s.end && e.startTime+e.duration > s.start);
  const violations=tasks.filter(e=>e.duration>50);
  return {status:problems.length?"INCOMPLETE":violations.length?"VIOLATION":"VERIFIED",problems,entryCount:tasks.length,violations,ackMs:finite(s?.acknowledged)&&finite(s?.submitted)?s.acknowledged-s.submitted:null};
}
export function catalogueVerdict(rows) {
  const expected=["ordinary","m3","m4"].flatMap(flow=>["concentrated","spread"].flatMap(shape=>Array.from({length:10},(_,i)=>`${flow}/${shape}/${i}`)));
  const keys=rows.map(r=>`${r.flow}/${r.shape}/${r.index}`),problems=[];
  if(rows.length!==60||new Set(keys).size!==60||expected.some(k=>!keys.includes(k)))problems.push("catalogue is not the approved 60 unique launches");
  const groups={"first-load":[],"post-reload":[]};
  for(const r of rows){
    if(r.error||r.observations?.length!==2||r.observations[0]?.phase!=="first-load"||r.observations[1]?.phase!=="post-reload")problems.push(`${r.flow}/${r.shape}/${r.index}: incomplete phases`);
    const first=r.observations?.[0],last=r.observations?.[1];
    if(r.controls?.length!==2||!(r.controls[0].end<first?.start&&r.controls[1].start>last?.end))problems.push(`${r.flow}/${r.shape}/${r.index}: controls do not bracket both intervals`);
    for(const s of r.observations??[]) if(groups[s.phase])groups[s.phase].push(observationVerdict(s,r.controls));
  }
  const summarize=xs=>({count:xs.length,incomplete:xs.filter(x=>x.status==="INCOMPLETE").length,violations:xs.filter(x=>x.status==="VIOLATION").length,samples:xs});
  const firstLoad=summarize(groups["first-load"]),postReload=summarize(groups["post-reload"]);
  return {status:problems.length||firstLoad.incomplete||postReload.incomplete||firstLoad.count!==60||postReload.count!==60?"INCOMPLETE":firstLoad.violations||postReload.violations?"VIOLATION":"VERIFIED",problems,firstLoad,postReload};
}

/** Serialized by WebDriver. Install once in each document before any question submission. */
export function installLongTaskObserver() {
  const state={supported:typeof PerformanceObserver!=="undefined"&&PerformanceObserver.supportedEntryTypes.includes("longtask"),observerInstalled:performance.now(),entries:[],pendingFlushed:false};
  window.__task7LongTask=state;
  state.reloads=[];
  const fetchOriginal=window.fetch.bind(window);
  window.fetch=async(input,init)=>{const url=String(input instanceof Request?input.url:input);const result=await fetchOriginal(input,init);if(url.includes("get_transaction_snapshot_compact"))state.reloads.push({at:performance.now(),status:result.status});return result;};
  if(state.supported){state.observer=new PerformanceObserver(list=>state.entries.push(...list.getEntries().map(e=>({name:e.name,entryType:e.entryType,startTime:e.startTime,duration:e.duration}))));state.observer.observe({type:"longtask"});}
  return {supported:state.supported,observerInstalled:state.observerInstalled,timeOrigin:performance.timeOrigin,date:new Date().toISOString(),timezone:Intl.DateTimeFormat().resolvedOptions().timeZone};
}
/** Serialized by WebDriver. Deliberate control occurs outside every question interval. */
export function positiveLongTaskControl(done) {
  // Browser Long Tasks observes event-loop tasks; an injected WebDriver evaluation itself is not a valid deliberate task.
  setTimeout(()=>{
    const s=window.__task7LongTask,start=performance.now();
    while(performance.now()-start<61) { /* deliberate positive control */ }
    const end=performance.now();
    setTimeout(()=>{
      if(s.observer)s.entries.push(...s.observer.takeRecords().map(e=>({name:e.name,entryType:e.entryType,startTime:e.startTime,duration:e.duration})));
      done({start,end,flushedAt:performance.now(),entries:s.entries.filter(e=>e.startTime<=start+1&&e.startTime+e.duration>=end-1)});
    },80);
  },0);
}
/** Serialized by WebDriver; first frame observing the requested result/review, then a further frame, acknowledges rendering. */
export function observeFirstQuestion(question, flow, phase, done) {
  (async()=>{
    const s=window.__task7LongTask,frame=()=>new Promise(r=>requestAnimationFrame(r)),input=document.querySelector(".ledger-qa-card input");
    const set=Object.getOwnPropertyDescriptor(HTMLInputElement.prototype,"value").set;set.call(input,question);input.dispatchEvent(new Event("input",{bubbles:true}));await frame();
    const sample={phase,question,flow,supported:s.supported,observerInstalled:s.observerInstalled,start:performance.now(),entries:[],pendingFlushed:false,completed:false};
    try{
      sample.submitted=performance.now();document.querySelector('.ledger-qa-card button[type="submit"]').click();sample.handlerReturned=performance.now();sample.inputAckMs=sample.handlerReturned-sample.submitted;
      const deadline=performance.now()+15000;
      while(true){await frame();const dialog=document.querySelector('[role="dialog"]'),answer=document.querySelector('.ledger-qa-answer');
        const ordinary=answer??document.querySelector('.ledger-qa-clarify');
        const text=flow==="ordinary"?ordinary?.textContent:dialog?.textContent;
        const ready=flow==="ordinary"?!!ordinary:flow==="m3"?text?.includes("Check these details"):text?.includes("Where would you like to cut back?");
        if(ready){sample.acknowledged=performance.now();sample.renderedText=text;await frame();sample.end=performance.now();sample.completed=true;break;}
        if(performance.now()>deadline)throw Error("render acknowledgement timed out");
      }
    }catch(e){sample.error=String(e);sample.end=performance.now();}
    // Flush after delivery has had a task turn, keeping the closed interval's original end.
    await new Promise(r=>setTimeout(r,80));
    if(s.observer){s.entries.push(...s.observer.takeRecords().map(e=>({name:e.name,entryType:e.entryType,startTime:e.startTime,duration:e.duration})));sample.pendingFlushed=true;}
    sample.entries=[...s.entries];sample.flushedAt=performance.now();sample.entryCount=sample.entries.length;done(sample);
  })().catch(e=>done({phase,error:String(e),completed:false}));
}
