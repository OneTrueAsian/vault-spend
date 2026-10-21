// The OS-focus spec needs another visible window to take foreground. That window must be one the test owns, found by its own
// process id, so closing it can never touch a window the person opened. (notepad.exe on Windows 11 is only a launcher for
// the Store app: killing the pid it returns leaves the real Notepad window open.)
import { execFileSync } from "node:child_process";
import { describe, expect, it } from "vitest";
import { openFocusWindow } from "./focusWindow.mjs";

const alive = pid => execFileSync("tasklist", ["/fi", `PID eq ${pid}`, "/fo", "csv", "/nh"], { encoding: "utf8" }).includes(`"${pid}"`);
const waitFor = async (check, ms = 10000) => { const end = Date.now() + ms; while (Date.now() < end) { if (await check()) return true; await new Promise(r => setTimeout(r, 100)); } return false; };
const windowTitle = pid => execFileSync("powershell", ["-NoProfile", "-Command", `(Get-Process -Id ${pid} -ErrorAction SilentlyContinue).MainWindowTitle`], { encoding: "utf8" }).trim();
const notepads = () => execFileSync("powershell", ["-NoProfile", "-Command", "(Get-Process notepad -ErrorAction SilentlyContinue | Measure-Object).Count"], { encoding: "utf8" }).trim();

describe.skipIf(process.platform !== "win32")("focus window owned by the test", () => {
  it("shows a visible window of its own and removes exactly that process when closed", async () => {
    const notepadsBefore = notepads();
    const win = openFocusWindow();
    try {
      expect(await waitFor(() => windowTitle(win.pid) === "Vault Spend focus test window")).toBe(true);
      expect(alive(win.pid)).toBe(true);
    } finally { win.close(); }
    expect(await waitFor(() => !alive(win.pid))).toBe(true);
    expect(notepads()).toBe(notepadsBefore); // never touches or adds to anyone's Notepad windows
  }, 60000);
  it("closing twice is harmless", async () => {
    const win = openFocusWindow();
    win.close(); win.close();
    expect(await waitFor(() => !alive(win.pid))).toBe(true);
  }, 60000);
});
