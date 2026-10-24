// Wait until something accepts connections on a local port. Retries every `intervalMs` (50 ms) until `timeoutMs` (20 s, as before) has passed.
// The first attempt always runs before the freshly started driver is listening, so the retry interval is paid on every launch: with the old
// fixed one-second retry that was a full second per spec even when the driver was ready in a fraction of that.
import { Socket } from "node:net";

export function waitForPort(port, { timeoutMs = 20000, intervalMs = 50, host = "127.0.0.1" } = {}) {
  return new Promise((resolve, reject) => {
    const start = Date.now();
    let finished = false;
    const finish = (settle, value) => { finished = true; settle(value); };
    const attempt = () => {
      if (finished) return;
      const socket = new Socket();
      socket.once("connect", () => { socket.destroy(); finish(resolve); });
      socket.once("error", () => {
        socket.destroy();
        if (finished) return;
        const remaining = timeoutMs - (Date.now() - start);
        if (remaining <= 0) finish(reject, new Error(`tauri-driver never opened port ${port}`));
        else setTimeout(attempt, Math.min(intervalMs, remaining));
      });
      socket.connect(port, host);
    };
    attempt();
  });
}
