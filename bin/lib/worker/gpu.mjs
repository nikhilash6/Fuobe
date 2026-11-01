// "Your GPU is busy": the worker pauses itself the moment another program uses the GPU, and (only when its automatic
// resume is on) resumes by itself once the GPU stayed free for the whole cool-down. It reads nvidia-smi and nothing else:
// it never contacts another program's port (not a ComfyUI on 8188, not any ComfyUI it didn't start). A pause by hand
// always wins: the automatic resume never ends it.
import { execFile } from "node:child_process";

/** Memory a ComfyUI's CUDA context takes beyond what torch reports. */
export const CONTEXT_ALLOWANCE_MB = 600;

const num = (s) => {
  const v = Number(String(s ?? "").trim());
  return Number.isFinite(v) ? v : null;
};

/** `nvidia-smi --query-gpu=memory.used,temperature.gpu --format=csv,noheader,nounits` → the first GPU. */
export function parseGpu(text) {
  const line = String(text ?? "").split(/\r?\n/).find((l) => l.trim());
  if (!line) return null;
  const [used, temp] = line.split(",");
  const usedMb = num(used);
  return usedMb === null ? null : { usedMb, tempC: num(temp) };
}

/** `--query-compute-apps=pid,process_name,used_memory --format=csv,noheader,nounits`; used_memory is often [N/A] on Windows. */
export function parseApps(text) {
  return String(text ?? "")
    .split(/\r?\n/)
    .map((l) => l.trim())
    .filter(Boolean)
    .map((l) => {
      const parts = l.split(",").map((p) => p.trim());
      const used = parts.at(-1);
      return { pid: num(parts[0]) ?? 0, name: (parts.slice(1, -1).join(",").split(/[\\/]/).pop() || "?").slice(0, 64), usedMb: num(used) };
    })
    .filter((a) => a.pid > 0);
}

const run = (cmd, args) =>
  new Promise((resolve) => {
    execFile(cmd, args, { timeout: 5000, windowsHide: true }, (err, stdout) => resolve(err ? null : String(stdout)));
  });

/**
 * One reading of the GPU, or null when nvidia-smi isn't there (no NVIDIA GPU: nothing to watch). `cmd`: its path, or a
 * command and its first arguments (["node", "fake-smi.mjs"] in the tests).
 */
export async function readGpu(cmd = "nvidia-smi") {
  const [bin, ...pre] = Array.isArray(cmd) ? cmd : [cmd];
  const call = (args) => run(bin, [...pre, ...args]);
  const gpu = await call(["--query-gpu=memory.used,temperature.gpu", "--format=csv,noheader,nounits"]);
  if (gpu === null) return null;
  const g = parseGpu(gpu);
  if (!g) return null;
  const apps = parseApps((await call(["--query-compute-apps=pid,process_name,used_memory", "--format=csv,noheader,nounits"])) ?? "");
  return { ...g, apps };
}

/**
 * Is another program using the GPU? Others' VRAM is the GPU's used memory minus what the worker's own ComfyUI holds
 * (`ownMb`, with an allowance for its CUDA context while it runs). Busy above `busyVramMb`, or when another process
 * shows its own use above it. The total rule always works, also when per-process memory reads [N/A].
 */
export function othersOf(reading, own, busyVramMb) {
  const ownMb = own.running ? (own.mb ?? 0) + CONTEXT_ALLOWANCE_MB : 0;
  const othersMb = Math.max(0, reading.usedMb - ownMb);
  const others = reading.apps.filter((a) => a.pid !== own.pid);
  const loud = others.find((a) => a.usedMb !== null && a.usedMb > busyVramMb);
  const busy = othersMb > busyVramMb || !!loud;
  const who = loud?.name ?? others.find((a) => a.usedMb === null || a.usedMb > 0)?.name ?? (busy ? "another program" : null);
  return { busy, othersMb, who };
}

/**
 * The automatic pause and resume. `update` takes each reading's verdict; `paused` says whether the GPU keeps the worker
 * paused now. Busy pauses at once; with `autoResume`, it resumes once the GPU stayed free for `resumeAfterMs` in a row
 * and is cooler than `resumeBelowC`. Any busy reading starts the cool-down again. Without autoResume, only `clear()` (a
 * resume by hand) ends it.
 */
export class GpuWatch {
  constructor(o) {
    this.o = o;
    this.paused = false;
    this.who = null;
    this.freeSince = null;
  }

  update(verdict, tempC, now) {
    if (verdict.busy) {
      this.paused = true;
      this.who = verdict.who;
      this.freeSince = null;
      return;
    }
    this.freeSince ??= now;
    if (this.paused && this.o.autoResume && now - this.freeSince >= this.o.resumeAfterMs && (tempC === null || tempC === undefined || tempC < this.o.resumeBelowC)) {
      this.paused = false;
      this.who = null;
    }
  }

  /** A resume by hand clears a GPU pause too. */
  clear() {
    this.paused = false;
    this.who = null;
  }
}
