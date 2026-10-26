// A visible window the test owns, for specs that need another application to take OS foreground (real blur/focus events).
// It is a small form hosted by a PowerShell process we start ourselves, so its process id is exact: closing it ends that
// process tree and nothing else. notepad.exe is deliberately not used: on Windows 11 it is a launcher for the Store app,
// so the pid it returns is not the window's, and a kill by that pid would leave a Notepad window open for the person to close.
import { spawn, execFileSync } from "node:child_process";

export const FOCUS_WINDOW_TITLE = "Vault Spend focus test window";
const SCRIPT = [
  "Add-Type -AssemblyName System.Windows.Forms",
  "$f = New-Object System.Windows.Forms.Form",
  `$f.Text = '${FOCUS_WINDOW_TITLE}'; $f.Width = 320; $f.Height = 140; $f.StartPosition = 'CenterScreen'; $f.TopMost = $true`,
  // Safety net: if this test is killed in a way that skips its own cleanup, the window still closes itself.
  "$t = New-Object System.Windows.Forms.Timer; $t.Interval = 90000; $t.Add_Tick({ $f.Close() }); $t.Start()",
  "[void]$f.ShowDialog()",
].join("; ");

export function openFocusWindow() {
  const child = spawn("powershell.exe", ["-NoProfile", "-NonInteractive", "-STA", "-Command", SCRIPT], { stdio: "ignore", detached: false });
  child.on("error", () => { /* reported by the caller's wait for the window */ });
  let closed = false;
  return {
    pid: child.pid,
    close() {
      if (closed) return;
      closed = true;
      try { execFileSync("taskkill", ["/pid", String(child.pid), "/t", "/f"], { stdio: "ignore" }); } catch { /* already gone */ }
    },
  };
}
