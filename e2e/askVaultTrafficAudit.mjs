// Task-6 spec-local evidence assertions. Does not change the common E2E harness or production code.
export function installTrafficRecorder() {
  if (window.__task6Traffic) throw new Error("Task 6 recorder already installed");
  const state = window.__task6Traffic = { installed: [], requests: [], commands: [] };
  const note = url => state.requests.push(String(url));
  const fetch = window.fetch;
  window.fetch = function(input, ...rest) { note(typeof input === "string" || input instanceof URL ? input : input.url); return fetch.call(this, input, ...rest); };
  state.installed.push("fetch");
  const open = XMLHttpRequest.prototype.open;
  XMLHttpRequest.prototype.open = function(method, url, ...rest) { note(url); return open.call(this, method, url, ...rest); };
  state.installed.push("xhr");
  const beacon = navigator.sendBeacon;
  if (beacon) { navigator.sendBeacon = function(url, ...rest) { note(url); return beacon.call(this, url, ...rest); }; state.installed.push("beacon"); }
  for (const [name, tag] of [["WebSocket", "socket"], ["EventSource", "eventsource"]]) {
    const Real = window[name];
    if (Real) { window[name] = new Proxy(Real, { construct(target, args, newTarget) { note(args[0]); return Reflect.construct(target, args, newTarget); } }); state.installed.push(tag); }
  }
  if (window.__TAURI_INTERNALS__?.invoke) {
    const invoke = window.__TAURI_INTERNALS__.invoke;
    window.__TAURI_INTERNALS__.invoke = function(command, ...rest) { state.commands.push(String(command)); return invoke.call(this, command, ...rest); };
    state.installed.push("invoke");
  }
}

export function assertTrafficAudit(audit, allowed) {
  if (!audit || !["fetch", "xhr", "beacon", "socket", "eventsource", "invoke"].every(x => audit.installed.includes(x))) throw new Error("Incomplete request instrumentation");
  if (!audit.before || !audit.after || JSON.stringify(audit.before) !== JSON.stringify(audit.after)) throw new Error("Revision changed during read-only flow");
  const commands = new Set(audit.commands);
  for (const raw of audit.requests) {
    let url; try { url = new URL(raw, "http://tauri.localhost/"); } catch { throw new Error(`Invalid request: ${raw}`); }
    if (url.protocol === "ipc:" && url.hostname === "localhost" || url.origin === "http://ipc.localhost") commands.add(decodeURIComponent(url.pathname.replace(/^\//, "")));
    else if (url.origin !== "http://tauri.localhost" && !(url.protocol === "tauri:" && url.hostname === "localhost")) throw new Error(`Unexpected request: ${raw}`);
  }
  if (!commands.size) throw new Error("No native commands observed");
  for (const command of commands) if (!allowed.includes(command)) throw new Error(`Unexpected command: ${command}`);
  for (const required of allowed) if (!commands.has(required)) throw new Error(`Missing expected command: ${required}`);
}

export function nearestRank(values, quantile) {
  if (!values.length || values.some(x => !Number.isFinite(x) || x < 0) || !(quantile > 0 && quantile <= 1)) throw new Error("Invalid timing samples");
  return [...values].sort((a,b) => a-b)[Math.ceil(quantile * values.length)-1];
}

export function classifyDifferential(before, after) {
  const violations=[], clarificationChanges=[], otherChanges=[];
  const map = (rows, side) => { const result=new Map(); for (const [id, value] of rows) { if(result.has(id)) violations.push({id,kind:"duplicate",side}); result.set(id,value); } return result; };
  const old=map(before,"before"), current=map(after,"after");
  for(const id of new Set([...old.keys(),...current.keys()])) {
    const a=old.get(id), b=current.get(id);
    if(a===undefined || b===undefined) { violations.push({id,kind:"missing",before:a,after:b}); continue; }
    if(a===b)continue;
    let pa,pb;try{pa=JSON.parse(a);pb=JSON.parse(b);}catch{violations.push({id,kind:"invalid-json"});continue;}
    const change={id,before:pa,after:pb};
    if(pa.status==="query" || pb.status==="query") violations.push(change);
    else if(pa.status==="unsupported" && pb.status==="clarify") clarificationChanges.push(change);
    else otherChanges.push(change);
  }
  return {violations,clarificationChanges,otherChanges};
}
