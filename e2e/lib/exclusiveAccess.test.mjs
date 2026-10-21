// R1a/R1b: exclusive access to the shared executable and target\ directory. Builds, desktop runs and Cargo work on the shared
// target directory take this lock; unit tests, lint and tsc do not. The lock never signals or kills another process: a holder
// is waited for, refused, or (only when it is provably gone) its abandoned lock is replaced.
import { spawn, spawnSync, execFileSync } from "node:child_process";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { pathToFileURL } from "node:url";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { AccessHeldError, AccessTimeoutError, acquireAccess } from "./exclusiveAccess.mjs";

let root, dir;
beforeEach(() => { root = fs.mkdtempSync(path.join(os.tmpdir(), "vs-access-")); dir = path.join(root, "lock"); });
afterEach(() => { vi.restoreAllMocks(); fs.rmSync(root, { recursive: true, force: true }); });
const sleep = ms => new Promise(r => setTimeout(r, ms));
const ownerFile = () => path.join(dir, "owner.json");
const writeOwner = owner => { fs.mkdirSync(dir, { recursive: true }); fs.writeFileSync(ownerFile(), JSON.stringify(owner)); };
const foreignOwner = (over = {}) => ({ operation: "tauri-build", pid: 424242, token: "foreign-token", startedAt: new Date().toISOString(), heartbeatAt: new Date().toISOString(), ...over });
const alive = pid => execFileSync("tasklist", ["/fi", `PID eq ${pid}`, "/fo", "csv", "/nh"], { encoding: "utf8" }).includes(`"${pid}"`);

describe("acquire and release", () => {
  it("records who holds the lock and what for, and release removes it", async () => {
    const lock = await acquireAccess({ dir, operation: "desktop-run" });
    const owner = JSON.parse(fs.readFileSync(ownerFile(), "utf8"));
    expect(owner).toMatchObject({ operation: "desktop-run", pid: process.pid, token: lock.owner.token });
    lock.release();
    expect(fs.existsSync(dir)).toBe(false);
  });
  it("releasing twice is harmless", async () => {
    const lock = await acquireAccess({ dir, operation: "tauri-build" });
    lock.release(); lock.release();
    expect(fs.existsSync(dir)).toBe(false);
  });
  it("release never removes a lock that a different holder now owns", async () => {
    const lock = await acquireAccess({ dir, operation: "tauri-build" });
    writeOwner(foreignOwner({ token: "someone-else" }));
    lock.release();
    expect(JSON.parse(fs.readFileSync(ownerFile(), "utf8")).token).toBe("someone-else");
  });
});

describe("a held lock", () => {
  it("is refused immediately with the holder's identity, and the holder keeps it", async () => {
    const first = await acquireAccess({ dir, operation: "desktop-run" });
    const err = await acquireAccess({ dir, operation: "tauri-build" }).then(() => null, e => e);
    expect(err).toBeInstanceOf(AccessHeldError);
    expect(err.owner).toMatchObject({ operation: "desktop-run", pid: process.pid });
    expect(err.message).toMatch(/desktop-run/);
    expect(JSON.parse(fs.readFileSync(ownerFile(), "utf8")).token).toBe(first.owner.token);
    first.release();
  });
  it("lets exactly one of many simultaneous attempts win", async () => {
    const attempts = await Promise.allSettled(Array.from({ length: 25 }, (_, i) => acquireAccess({ dir, operation: `attempt-${i}` })));
    const winners = attempts.filter(a => a.status === "fulfilled");
    expect(winners).toHaveLength(1);
    expect(attempts.filter(a => a.status === "rejected").every(a => a.reason instanceof AccessHeldError)).toBe(true);
    winners[0].value.release();
  });
  it("never signals or kills the holder, whatever the outcome", async () => {
    const kill = vi.spyOn(process, "kill");
    await acquireAccess({ dir, operation: "desktop-run" });
    await acquireAccess({ dir, operation: "tauri-build" }).catch(() => {});
    await acquireAccess({ dir, operation: "tauri-build", wait: true, timeoutMs: 150, pollMs: 20 }).catch(() => {});
    const signals = kill.mock.calls.filter(([, signal]) => signal !== 0 && signal !== undefined);
    expect(signals).toEqual([]);
  });
});

describe("waiting", () => {
  it("waits for the holder to release, then acquires", async () => {
    const first = await acquireAccess({ dir, operation: "tauri-build" });
    const second = acquireAccess({ dir, operation: "desktop-run", wait: true, timeoutMs: 5000, pollMs: 20 });
    await sleep(100); first.release();
    const lock = await second;
    expect(lock.owner.operation).toBe("desktop-run");
    lock.release();
  });
  it("times out with the holder named, and leaves the holder's lock alone", async () => {
    const first = await acquireAccess({ dir, operation: "tauri-build" });
    const err = await acquireAccess({ dir, operation: "desktop-run", wait: true, timeoutMs: 120, pollMs: 20 }).then(() => null, e => e);
    expect(err).toBeInstanceOf(AccessTimeoutError);
    expect(err.owner.operation).toBe("tauri-build");
    expect(JSON.parse(fs.readFileSync(ownerFile(), "utf8")).token).toBe(first.owner.token);
    first.release();
  });
  it("cancelling while waiting rejects, and takes nothing", async () => {
    const first = await acquireAccess({ dir, operation: "tauri-build" });
    const controller = new AbortController();
    const waiting = acquireAccess({ dir, operation: "desktop-run", wait: true, timeoutMs: 5000, pollMs: 20, signal: controller.signal }).then(() => null, e => e);
    await sleep(60); controller.abort();
    const err = await waiting;
    expect(err?.name).toBe("AbortError");
    first.release();
    expect(fs.existsSync(dir)).toBe(false);
  });
  it("an already-cancelled signal never touches the lock", async () => {
    const controller = new AbortController(); controller.abort();
    const err = await acquireAccess({ dir, operation: "desktop-run", wait: true, signal: controller.signal }).then(() => null, e => e);
    expect(err?.name).toBe("AbortError");
    expect(fs.existsSync(dir)).toBe(false);
  });
});

describe("abandoned locks", () => {
  it("replaces a lock whose holder process is gone, and says whose it was", async () => {
    writeOwner(foreignOwner({ pid: 777001 }));
    const lock = await acquireAccess({ dir, operation: "desktop-run", isAlive: () => false });
    expect(lock.recovered).toMatchObject({ operation: "tauri-build", pid: 777001 });
    expect(lock.owner.pid).toBe(process.pid);
    lock.release();
  });
  it("keeps a lock whose holder is alive and recently active", async () => {
    writeOwner(foreignOwner());
    const err = await acquireAccess({ dir, operation: "desktop-run", isAlive: () => true }).then(() => null, e => e);
    expect(err).toBeInstanceOf(AccessHeldError);
    expect(JSON.parse(fs.readFileSync(ownerFile(), "utf8")).token).toBe("foreign-token");
  });
  it("replaces a lock whose pid was reused: alive but silent far beyond the heartbeat limit", async () => {
    const old = new Date(Date.now() - 60 * 60 * 1000).toISOString();
    writeOwner(foreignOwner({ heartbeatAt: old, startedAt: old }));
    const lock = await acquireAccess({ dir, operation: "desktop-run", isAlive: () => true, staleMs: 10 * 60 * 1000 });
    expect(lock.recovered).toMatchObject({ token: "foreign-token" });
    lock.release();
  });
  it("treats a just-created lock with no owner file as held (its creator is still writing it)", async () => {
    fs.mkdirSync(dir, { recursive: true });
    const err = await acquireAccess({ dir, operation: "desktop-run" }).then(() => null, e => e);
    expect(err).toBeInstanceOf(AccessHeldError);
  });
  it("replaces a lock directory that stayed ownerless or unreadable long after creation (a crash between create and write)", async () => {
    fs.mkdirSync(dir, { recursive: true }); fs.writeFileSync(ownerFile(), "{ not json");
    const past = new Date(Date.now() - 60 * 1000); fs.utimesSync(dir, past, past); fs.utimesSync(ownerFile(), past, past);
    const lock = await acquireAccess({ dir, operation: "desktop-run", graceMs: 5000 });
    expect(lock.owner.pid).toBe(process.pid);
    lock.release();
  });
  it("keeps the heartbeat fresh while held, so a long build is never mistaken for an abandoned one", async () => {
    const lock = await acquireAccess({ dir, operation: "tauri-build", heartbeatMs: 30 });
    const first = JSON.parse(fs.readFileSync(ownerFile(), "utf8")).heartbeatAt;
    await sleep(150);
    expect(JSON.parse(fs.readFileSync(ownerFile(), "utf8")).heartbeatAt > first).toBe(true);
    lock.release();
  });
});

describe("a recovery that another process left half-done", () => {
  it("does not busy-loop (and still honours cancellation) while the recovery mutex of a crashed recoverer is in place", () => {
    // An abandoned lock plus a fresh `<lock>.recovering` folder: the abandoned lock cannot be replaced until that mutex is stale (30 s).
    // A loop that retries without yielding freezes the process, so this runs in a child that is killed if it hangs.
    writeOwner(foreignOwner({ pid: 777002 })); fs.mkdirSync(`${dir}.recovering`);
    const file = path.join(root, "spin.mjs");
    fs.writeFileSync(file, `import { acquireAccess } from ${JSON.stringify(pathToFileURL(path.resolve("e2e/lib/exclusiveAccess.mjs")).href)};
let calls = 0; const controller = new AbortController(); setTimeout(() => controller.abort(), 300);
const result = await acquireAccess({ dir: ${JSON.stringify(dir)}, operation: "desktop-run", wait: true, timeoutMs: 20000, pollMs: 20, signal: controller.signal, isAlive: () => { calls++; return false; } }).then(() => "acquired", e => e.name);
console.log(JSON.stringify({ result, calls }));`);
    const child = spawnSync(process.execPath, [file], { encoding: "utf8", timeout: 5000 });
    expect(child.status, `hung or crashed: ${child.error ?? child.stderr}`).toBe(0);
    const { result, calls } = JSON.parse(child.stdout);
    expect(result).toBe("AbortError");
    expect(calls).toBeLessThan(200); // a yielding retry loop at ~20 ms makes about 15 checks in 300 ms; a spin makes hundreds of thousands
  }, 15000);
});

describe("recovery contention without waiting", () => {
  it("a caller that will not wait is refused (lock named as held) after about a second, not left looping for the mutex's 30 s", async () => {
    writeOwner(foreignOwner({ pid: 777003 })); fs.mkdirSync(`${dir}.recovering`);
    const started = Date.now();
    const err = await acquireAccess({ dir, operation: "desktop-run", isAlive: () => false }).then(() => null, e => e);
    expect(err).toBeInstanceOf(AccessHeldError);
    expect(Date.now() - started).toBeLessThan(3000);
  });
  it("a waiting caller times out at its own limit, naming the holder", async () => {
    writeOwner(foreignOwner({ pid: 777004 })); fs.mkdirSync(`${dir}.recovering`);
    const err = await acquireAccess({ dir, operation: "desktop-run", wait: true, timeoutMs: 200, pollMs: 20, isAlive: () => false }).then(() => null, e => e);
    expect(err).toBeInstanceOf(AccessTimeoutError);
  });
});

describe("real processes", () => {
  const script = (body) => {
    const file = path.join(root, `child-${Math.random().toString(36).slice(2)}.mjs`);
    fs.writeFileSync(file, `import { acquireAccess } from ${JSON.stringify(pathToFileURL(path.resolve("e2e/lib/exclusiveAccess.mjs")).href)};\n${body}`);
    return file;
  };
  const start = file => new Promise((resolve, reject) => {
    const child = spawn(process.execPath, [file], { stdio: ["ignore", "pipe", "inherit"] });
    child.stdout.on("data", d => { if (String(d).includes("HELD")) resolve(child); });
    child.on("error", reject); child.on("exit", code => reject(new Error(`child exited early (${code})`)));
  });
  it("a holder that crashes (killed without cleanup) leaves a lock the next run recovers", async () => {
    const child = await start(script(`await acquireAccess({ dir: ${JSON.stringify(dir)}, operation: "tauri-build" }); console.log("HELD"); setInterval(() => {}, 1000);`));
    const crashedPid = child.pid;
    const refused = await acquireAccess({ dir, operation: "desktop-run" }).then(() => null, e => e);
    expect(refused).toBeInstanceOf(AccessHeldError); // alive: refused, and not killed
    expect(alive(crashedPid)).toBe(true);
    execFileSync("taskkill", ["/pid", String(crashedPid), "/f"], { stdio: "ignore" }); // the test's own child, standing in for a crash
    await sleep(300);
    const lock = await acquireAccess({ dir, operation: "desktop-run" });
    expect(lock.recovered).toMatchObject({ pid: crashedPid });
    lock.release();
  }, 30000);
  it("a holder that exits normally without releasing still frees the lock", async () => {
    const child = await start(script(`await acquireAccess({ dir: ${JSON.stringify(dir)}, operation: "tauri-build" }); console.log("HELD"); setTimeout(() => process.exit(1), 200);`));
    expect(fs.existsSync(dir)).toBe(true); // it really held the lock before exiting
    await sleep(800);
    expect(fs.existsSync(dir)).toBe(false);
    expect(alive(child.pid)).toBe(false);
  }, 30000);
});
