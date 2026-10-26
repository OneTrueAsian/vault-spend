// waitForPort: wait until something accepts connections on a local port. The harness's old version retried only once a second, so even a
// driver that was ready in 100 ms cost every launch a full second (about 0.9 s x 230 specs of waiting). The overall limit is unchanged.
import net from "node:net";
import { afterEach, describe, expect, it } from "vitest";
import { waitForPort } from "./waitForPort.mjs";

const servers = [];
afterEach(() => { while (servers.length) servers.pop().close(); });
const freePort = () => new Promise(resolve => { const s = net.createServer(); s.listen(0, "127.0.0.1", () => { const { port } = s.address(); s.close(() => resolve(port)); }); });
const listenOn = port => new Promise(resolve => { const s = net.createServer(socket => socket.destroy()); servers.push(s); s.listen(port, "127.0.0.1", () => resolve(s)); });

describe("waitForPort", () => {
  it("returns at once when the port is already open", async () => {
    const port = await freePort(); await listenOn(port);
    const started = Date.now();
    await waitForPort(port);
    expect(Date.now() - started).toBeLessThan(300);
  });
  it("notices a port that opens shortly after the first attempt, without waiting out a long retry interval", async () => {
    const port = await freePort();
    setTimeout(() => { void listenOn(port); }, 250);
    const started = Date.now();
    await waitForPort(port);
    const waited = Date.now() - started;
    expect(waited).toBeGreaterThanOrEqual(200);
    expect(waited).toBeLessThan(700); // the old fixed one-second retry could not finish before ~1000 ms
  });
  it("gives up with a message naming the port once the overall limit passes", async () => {
    const port = await freePort();
    const started = Date.now();
    await expect(waitForPort(port, { timeoutMs: 300 })).rejects.toThrow(new RegExp(`never opened port ${port}`));
    expect(Date.now() - started).toBeLessThan(1500);
  });
  it("keeps the overall limit when the retry interval is longer than it", async () => {
    const port = await freePort();
    const started = Date.now();
    await expect(waitForPort(port, { timeoutMs: 100, intervalMs: 500 })).rejects.toThrow(/never opened port/);
    expect(Date.now() - started).toBeLessThan(1500);
  });
  it("stops trying once it has rejected (no further connection attempts after the limit)", async () => {
    const port = await freePort();
    await expect(waitForPort(port, { timeoutMs: 150 })).rejects.toThrow();
    let late = 0;
    const server = net.createServer(socket => { late++; socket.destroy(); }); servers.push(server);
    await new Promise(resolve => server.listen(port, "127.0.0.1", resolve));
    await new Promise(resolve => setTimeout(resolve, 300));
    expect(late).toBe(0);
  });
});
