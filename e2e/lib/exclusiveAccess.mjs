// Exclusive access to the shared executable and target\ directory (R1). A Tauri build, a desktop run and any Cargo command that
// uses the shared target directory take it; unit tests, lint and tsc do not need it.
//
// The lock is a directory created atomically (mkdir fails if it exists) holding owner.json. The rules that keep it safe:
//   - A holder is only ever waited for or refused. Nothing here signals or kills a process. process.kill(pid, 0) is an existence
//     check, not a signal.
//   - A lock is replaced only when it is provably abandoned: its process is gone, its heartbeat stopped long ago (a reused pid),
//     or its directory never got an owner and has sat unfinished well past the time a creator needs to write it.
//   - Release removes the lock only while it still carries this holder's token.
import crypto from "node:crypto";
import fs from "node:fs";
import path from "node:path";

export class AccessHeldError extends Error {
  constructor(owner, dir) {
    super(owner
      ? `Exclusive access is held by "${owner.operation}" (pid ${owner.pid}, since ${owner.startedAt}). Wait for it to finish; nothing was stopped. Lock: ${dir}`
      : `Exclusive access is being taken by another process right now. Lock: ${dir}`);
    this.name = "AccessHeldError"; this.owner = owner; this.dir = dir;
  }
}
export class AccessTimeoutError extends AccessHeldError {
  constructor(owner, dir, timeoutMs) { super(owner, dir); this.name = "AccessTimeoutError"; this.message = `Timed out after ${timeoutMs} ms. ${this.message}`; }
}
const abortError = () => Object.assign(new Error("Waiting for exclusive access was cancelled."), { name: "AbortError" });

function processAlive(pid) {
  try { process.kill(pid, 0); return true; } catch (error) { return error?.code === "EPERM"; }
}
const ownerPath = dir => path.join(dir, "owner.json");
function readOwner(dir) {
  try {
    const owner = JSON.parse(fs.readFileSync(ownerPath(dir), "utf8"));
    return owner && typeof owner === "object" && typeof owner.token === "string" && Number.isInteger(owner.pid) ? owner : null;
  } catch { return null; }
}
const sleep = (ms, signal) => new Promise((resolve, reject) => {
  const timer = setTimeout(() => { signal?.removeEventListener("abort", onAbort); resolve(); }, ms);
  const onAbort = () => { clearTimeout(timer); reject(abortError()); };
  signal?.addEventListener("abort", onAbort, { once: true });
});
function ageMs(dir, now) {
  let newest = 0;
  for (const target of [dir, ownerPath(dir)]) { try { newest = Math.max(newest, fs.statSync(target).mtimeMs); } catch { /* absent */ } }
  return newest === 0 ? Infinity : now - newest;
}

/** Whether the lock in `dir` may be replaced, and the owner it had. */
function judge(dir, { isAlive, now, staleMs, graceMs }) {
  const owner = readOwner(dir);
  if (!owner) return { abandoned: ageMs(dir, now) > graceMs, owner: null };
  const silentFor = now - Date.parse(owner.heartbeatAt ?? owner.startedAt ?? 0);
  return { abandoned: !isAlive(owner.pid) || (Number.isFinite(silentFor) && silentFor > staleMs), owner };
}

/** Replace an abandoned lock. A short mutex keeps two recoverers from removing each other's fresh lock. */
function recover(dir, seen, options) {
  const mutex = `${dir}.recovering`;
  try { fs.mkdirSync(mutex); } catch (error) {
    if (error.code === "EEXIST" && ageMs(mutex, options.now) > 30000) { fs.rmSync(mutex, { recursive: true, force: true }); }
    return false;
  }
  try {
    const again = judge(dir, options);
    if (!again.abandoned || (again.owner?.token ?? null) !== (seen?.token ?? null)) return false; // changed hands meanwhile
    fs.rmSync(dir, { recursive: true, force: true });
    return true;
  } finally { fs.rmSync(mutex, { recursive: true, force: true }); }
}

export async function acquireAccess({
  dir, operation, wait = false, timeoutMs = 0, pollMs = 250, signal, isAlive = processAlive, staleMs = 10 * 60 * 1000, graceMs = 10000, heartbeatMs = 5000,
}) {
  if (signal?.aborted) throw abortError();
  fs.mkdirSync(path.dirname(dir), { recursive: true });
  const deadline = Date.now() + timeoutMs;
  let recovered = null, contendedSince;
  for (;;) {
    try {
      fs.mkdirSync(dir);
      const now = new Date().toISOString();
      const owner = { operation, pid: process.pid, token: crypto.randomUUID(), startedAt: now, heartbeatAt: now };
      fs.writeFileSync(ownerPath(dir), JSON.stringify(owner));
      return hold(dir, owner, recovered, heartbeatMs);
    } catch (error) {
      if (error.code !== "EEXIST") throw error;
    }
    const options = { isAlive, now: Date.now(), staleMs, graceMs };
    const seen = judge(dir, options);
    if (seen.abandoned) {
      if (recover(dir, seen.owner, options)) { recovered = seen.owner ?? { operation: "unknown", pid: 0, token: "ownerless" }; continue; }
      // Another process is replacing it right now (or died doing so; its mutex goes stale after 30 s). Yield and look again rather than spin.
      // A caller that will not wait gives up after about a second, naming the lock as held.
      contendedSince ??= Date.now();
      if (!wait && Date.now() - contendedSince > 1000) throw new AccessHeldError(seen.owner, dir);
      if (wait && Date.now() >= deadline) throw new AccessTimeoutError(seen.owner, dir, timeoutMs);
      await sleep(Math.min(pollMs, 25), signal);
      if (signal?.aborted) throw abortError();
      continue;
    }
    if (!wait) throw new AccessHeldError(seen.owner, dir);
    if (Date.now() >= deadline) throw new AccessTimeoutError(seen.owner, dir, timeoutMs);
    await sleep(Math.min(pollMs, Math.max(1, deadline - Date.now())), signal);
    if (signal?.aborted) throw abortError();
  }
}

function hold(dir, owner, recovered, heartbeatMs) {
  let released = false;
  const mine = () => readOwner(dir)?.token === owner.token;
  const beat = setInterval(() => {
    if (!mine()) return;
    try { fs.writeFileSync(ownerPath(dir), JSON.stringify({ ...owner, heartbeatAt: new Date().toISOString() })); } catch { /* the next beat retries */ }
  }, heartbeatMs);
  beat.unref();
  const release = () => {
    if (released) return;
    released = true; clearInterval(beat); process.off("exit", release);
    if (mine()) fs.rmSync(dir, { recursive: true, force: true });
  };
  process.on("exit", release); // a holder that exits without releasing still frees the lock; a hard kill is recovered by the next acquirer
  return { owner, recovered, release };
}
