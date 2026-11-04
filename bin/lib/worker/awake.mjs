// Keeps the PC from sleeping while the worker holds a job or waits for one (docs/gpu-workers.md). A sleeping PC stops its
// jobs halfway. A small helper process asks the system to stay awake for as long as it runs: on Windows it calls
// SetThreadExecutionState (ES_CONTINUOUS | ES_SYSTEM_REQUIRED) and waits; on macOS it is `caffeinate -i`; on Linux
// `systemd-inhibit`. Each one ends when the worker closes its input, or when the worker itself stops, and the PC may
// sleep again. The screen may still turn off. While the worker is paused or outside its hours, the PC sleeps as usual.
import { spawn } from "node:child_process";

/** ES_CONTINUOUS (0x80000000) | ES_SYSTEM_REQUIRED (0x1), written in decimal for Windows PowerShell 5.1. */
const WINDOWS_SCRIPT = `$ErrorActionPreference = "Stop"
$k = Add-Type -Name Power -Namespace FuobeWorker -PassThru -MemberDefinition '[DllImport("kernel32.dll")] public static extern uint SetThreadExecutionState(uint flags);'
if ($k::SetThreadExecutionState([uint32]2147483649) -eq 0) { exit 3 }
[void][Console]::In.ReadLine()
`;

/** The helper's command for this system, or null (none: the PC's own power settings decide). */
export function helperCommand(platform = process.platform, pid = process.pid) {
  if (platform === "win32") return ["powershell", ["-NoProfile", "-NonInteractive", "-EncodedCommand", Buffer.from(WINDOWS_SCRIPT, "utf16le").toString("base64")]];
  if (platform === "darwin") return ["caffeinate", ["-i", "-w", String(pid)]];
  if (platform === "linux") return ["systemd-inhibit", ["--what=sleep:idle", "--who=Fuobe worker", "--why=Running a job", "--mode=block", "cat"]];
  return null;
}

/** A helper that stopped by itself is started again at most this often. */
const RETRY_MS = 10 * 60_000;

export class StayAwake {
  /** `o`: { spawn, platform, now, log } (tests give their own). */
  constructor(o = {}) {
    this.o = o;
    this.child = null;
    this.failedAt = -Infinity;
  }

  get on() {
    return !!this.child;
  }

  /** Awake (true) or free to sleep (false). */
  set(on) {
    if (on && !this.child) this.start();
    else if (!on && this.child) this.stop();
  }

  start() {
    const now = (this.o.now ?? Date.now)();
    if (now - this.failedAt < RETRY_MS) return;
    const cmd = helperCommand(this.o.platform ?? process.platform);
    if (!cmd) return;
    let child;
    try {
      child = (this.o.spawn ?? spawn)(cmd[0], cmd[1], { stdio: ["pipe", "ignore", "ignore"], windowsHide: true });
    } catch {
      this.failedAt = now;
      return;
    }
    this.child = child;
    const gone = () => {
      if (this.child !== child) return;
      this.child = null;
      this.failedAt = (this.o.now ?? Date.now)();
      this.o.log?.("The PC may sleep while the worker runs: its keep-awake helper stopped.");
    };
    child.once("error", gone);
    child.once("exit", gone);
    child.stdin?.on?.("error", () => {});
  }

  stop() {
    const child = this.child;
    this.child = null;
    if (!child) return;
    try {
      child.stdin?.end();
    } catch {}
    try {
      child.kill();
    } catch {}
  }
}
