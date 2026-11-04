// Telling local ComfyUI work apart from other programs (docs/gpu-workers.md, "Studio jobs first"). The worker never
// connects to another ComfyUI. It reads three things only:
//
// - Windows' table of listening ports (Get-NetTCPConnection -State Listen). Reading the table never connects to a port.
//   A python process that listens on a port in the local range (worker.json) is local ComfyUI work. The worker's own
//   ComfyUI (by its pid and its port) and the ports and pids worker.json excludes never count.
// - Windows' GPU counters, per process (\GPU Process Memory(pid_<n>_*)\Dedicated Usage), the same numbers Task Manager
//   shows. nvidia-smi reads [N/A] per process on Windows, so it gives the total only.
// - A GPU lock file, only when the counters can't be read: an owner it names as ComfyUI work counts as ComfyUI work,
//   and anything else as another program.
//
// Others = the GPU's total used memory, minus the worker's own ComfyUI, minus local ComfyUI work, minus the desktop's
// usual share (measured at setup).
import { execFile } from "node:child_process";
import fs from "node:fs";
import { CONTEXT_ALLOWANCE_MB } from "./gpu.mjs";

/** ComfyUI's own default port and the next few: where local ComfyUIs listen unless worker.json says otherwise. */
export const DEFAULT_PORTS = [8188, 8199];

/** The listening ports and their processes, and every process's name, as one JSON line. */
export const LISTEN_SCRIPT = [
  "$ErrorActionPreference = 'Stop'",
  "$l = @(Get-NetTCPConnection -State Listen | ForEach-Object { @{ port = [int]$_.LocalPort; pid = [int]$_.OwningProcess } })",
  "$n = @{}",
  "foreach ($p in Get-Process -ErrorAction SilentlyContinue) { $n[[string]$p.Id] = $p.ProcessName }",
  "@{ listeners = $l; names = $n } | ConvertTo-Json -Compress -Depth 4",
].join("; ");

/** typeperf, one sample of every process's dedicated GPU memory (bytes). */
export const COUNTERS_COMMAND = ["typeperf", "\\GPU Process Memory(*)\\Dedicated Usage", "-sc", "1"];

const MB = 2 ** 20;
const int = (v) => (Number.isInteger(Number(v)) && Number(v) > 0 ? Number(v) : null);

const run = (cmd, args, timeout) =>
  new Promise((resolve) => {
    execFile(cmd, args, { timeout, windowsHide: true, maxBuffer: 8 * MB }, (err, stdout) => resolve(err ? null : String(stdout)));
  });

const command = (cmd, fallback) => {
  const list = Array.isArray(cmd) ? cmd : cmd ? [cmd] : fallback;
  return [String(list[0]), list.slice(1).map(String)];
};

/** The port table's JSON → { listeners: [{ port, pid }], names: { pid: name } }, or null when it isn't one. */
export function parseListeners(text) {
  let o;
  try {
    o = JSON.parse(String(text ?? "").trim());
  } catch {
    return null;
  }
  if (!o || typeof o !== "object") return null;
  // ConvertTo-Json writes one listener as an object, not a list.
  const list = Array.isArray(o.listeners) ? o.listeners : o.listeners && typeof o.listeners === "object" ? [o.listeners] : [];
  const listeners = list.flatMap((l) => {
    const port = int(l?.port);
    const pid = int(l?.pid);
    return port && pid ? [{ port, pid }] : [];
  });
  const names = {};
  if (o.names && typeof o.names === "object") for (const [pid, name] of Object.entries(o.names)) if (int(pid) && typeof name === "string") names[pid] = name.slice(0, 64);
  return { listeners, names };
}

/** One look at the port table, or null when it can't be read (not Windows, or PowerShell refused). */
export async function readListeners(powershell = "powershell") {
  if (process.platform !== "win32" && !Array.isArray(powershell)) return null;
  const [bin, pre] = command(powershell, ["powershell"]);
  return parseListeners(await run(bin, [...pre, "-NoProfile", "-NonInteractive", "-Command", LISTEN_SCRIPT], 10_000));
}

const INSTANCE = /\(pid_(\d+)_luid_(0x[0-9a-f]+_0x[0-9a-f]+)_phys_(\d+)\)/i;
const cells = (line) => [...line.matchAll(/"((?:[^"]|"")*)"/g)].map((m) => m[1].replaceAll('""', '"'));

/** typeperf's CSV → [{ pid, gpu, mb }] (gpu: the adapter's luid and phys), or null when it holds no sample. */
export function parseCounters(text) {
  const lines = String(text ?? "").split(/\r?\n/);
  const at = lines.findIndex((l) => l.startsWith('"(PDH-CSV'));
  if (at < 0) return null;
  const head = cells(lines[at]);
  const row = lines.slice(at + 1).find((l) => l.startsWith('"'));
  if (!row) return null;
  const values = cells(row);
  const out = [];
  head.forEach((h, i) => {
    const m = INSTANCE.exec(h);
    const v = Number(values[i]);
    if (m && values[i]?.trim() && Number.isFinite(v) && v >= 0) out.push({ pid: Number(m[1]), gpu: `${m[2].toLowerCase()}_${m[3]}`, mb: v / MB });
  });
  return out;
}

/** One reading of the GPU counters, or null when they can't be read. */
export async function readCounters(cmd) {
  if (process.platform !== "win32" && !cmd) return null;
  const [bin, args] = command(cmd, COUNTERS_COMMAND);
  return parseCounters(await run(bin, args, 15_000));
}

/** The lock file's first word: who holds the GPU now ("" for a lock with no name), or null when there is no lock. */
export function readLock(file) {
  if (!file) return null;
  try {
    const p = fs.statSync(file).isDirectory() ? `${file.replace(/[\\/]+$/, "")}/owner.txt` : file;
    const fd = fs.openSync(p, "r");
    try {
      const buf = Buffer.alloc(512);
      const n = fs.readSync(fd, buf, 0, buf.length, 0);
      return buf.subarray(0, n).toString("utf8").trim().split(/\s+/)[0] ?? "";
    } finally {
      fs.closeSync(fd);
    }
  } catch (e) {
    // A lock folder whose owner file isn't written yet still holds the GPU.
    return e?.code === "ENOENT" && fs.existsSync(file) ? "" : null;
  }
}

const isPython = (name) => /^python(w|3(\.\d+)?)?(\.exe)?$/i.test(String(name ?? ""));

/**
 * The pids of local ComfyUI work: python processes that listen on a port in `ports` ([low, high]), not the worker's own
 * ComfyUI (its pid, or its port) and not an excluded port or pid. Also the worker's own pids, and the first work port.
 */
export function workPids(listing, o) {
  const [lo, hi] = Array.isArray(o.ports) && o.ports.length === 2 ? o.ports.map(Number) : DEFAULT_PORTS;
  const own = new Set([o.ownPid].filter(Boolean));
  for (const l of listing?.listeners ?? []) if (o.ownPort && l.port === o.ownPort) own.add(l.pid);
  const excludePorts = new Set((o.excludePorts ?? []).map(Number));
  const excludePids = new Set((o.excludePids ?? []).map(Number));
  const work = new Map();
  for (const l of listing?.listeners ?? []) {
    if (l.port < lo || l.port > hi || own.has(l.pid) || excludePorts.has(l.port) || excludePids.has(l.pid)) continue;
    if (!isPython(listing.names?.[l.pid])) continue;
    if (!work.has(l.pid)) work.set(l.pid, l.port);
  }
  return { own, work };
}

/** The adapter the counters are read for: the one worker.json names, else the one whose processes hold the most. */
export function pickGpu(counters, prefer) {
  const sums = new Map();
  for (const c of counters) sums.set(c.gpu, (sums.get(c.gpu) ?? 0) + c.mb);
  if (prefer && sums.has(String(prefer).toLowerCase())) return String(prefer).toLowerCase();
  let best = null;
  for (const [gpu, mb] of sums) if (best === null || mb > sums.get(best)) best = gpu;
  return best;
}

/** Does the reading show a process holding real memory that the last port table doesn't know? (Then look again.) */
export function unknownHolder(counters, listing, ownPid, minMb) {
  if (!counters) return false;
  if (!listing) return true;
  const known = new Set(listing.listeners.map((l) => l.pid));
  return counters.some((c) => c.mb > minMb && c.pid !== ownPid && !known.has(c.pid) && isPython(listing.names?.[c.pid] ?? "python"));
}

/**
 * Split the GPU's used memory: { ownMb, workMb, othersMb, who, work: { pids, port }, source }.
 * `who` names the biggest other program (for the busy pause). `source`: "counters", "lock" (the counters failed, the
 * lock decided) or "total" (neither: everything that isn't the worker's own counts as another program, which fails
 * safe). `o`: { usedMb, apps (nvidia-smi's, for names), counters, listing, own: { pid, port, running, mb }, ports,
 * excludePorts, excludePids, baselineMb, lock (readLock's), lockOwners, gpu }.
 */
export function splitMemory(o) {
  const base = Math.max(0, Number(o.baselineMb) || 0);
  const torchOwn = o.own.running ? (o.own.mb ?? 0) + CONTEXT_ALLOWANCE_MB : 0;
  if (o.counters && o.listing) {
    const { own, work } = workPids(o.listing, { ports: o.ports, ownPid: o.own.pid, ownPort: o.own.port, excludePorts: o.excludePorts, excludePids: o.excludePids });
    const gpu = pickGpu(o.counters, o.gpu);
    const mine = o.counters.filter((c) => c.gpu === gpu);
    const sum = (pids) => mine.filter((c) => pids.has(c.pid)).reduce((n, c) => n + c.mb, 0);
    const counted = sum(own);
    // Its own ComfyUI before the counters list it: what torch says, as before.
    const ownMb = counted > 0 ? counted : torchOwn;
    const workMb = sum(new Set(work.keys()));
    const othersMb = Math.max(0, o.usedMb - ownMb - workMb - base);
    const others = mine.filter((c) => !own.has(c.pid) && !work.has(c.pid) && c.mb > 0).sort((a, b) => b.mb - a.mb);
    const top = others[0];
    const who = top ? (o.listing.names?.[top.pid] ?? o.apps?.find((a) => a.pid === top.pid)?.name ?? "another program") : "another program";
    const firstPort = [...work.values()][0] ?? null;
    return { ownMb, workMb, othersMb, who, work: { pids: [...work.keys()], port: firstPort }, source: "counters" };
  }
  const rest = Math.max(0, o.usedMb - torchOwn - base);
  const owners = (o.lockOwners ?? []).map((s) => String(s).toLowerCase()).filter(Boolean);
  if (o.lock !== null && o.lock !== undefined && owners.some((w) => String(o.lock).toLowerCase().startsWith(w))) {
    return { ownMb: torchOwn, workMb: rest, othersMb: 0, who: null, work: { pids: [], port: null, lock: true }, source: "lock" };
  }
  const named = o.apps?.find((a) => a.pid !== o.own.pid && (a.usedMb === null || a.usedMb > 0))?.name;
  return { ownMb: torchOwn, workMb: 0, othersMb: rest, who: o.lock !== null && o.lock !== undefined ? "another program" : (named ?? "another program"), work: { pids: [], port: null }, source: o.lock !== null && o.lock !== undefined ? "lock" : "total" };
}

/**
 * The desktop's usual share of the GPU, measured once at setup with no game or other GPU program open: the used memory
 * minus local ComfyUI work, from the counters. Null when the counters or the port table can't be read.
 */
export async function measureBaseline(cfg, deps = {}) {
  const { readGpu } = await import("./gpu.mjs");
  const reading = await (deps.readGpu ?? readGpu)(cfg.nvidiaSmi);
  if (!reading) return null;
  const counters = await (deps.readCounters ?? readCounters)(cfg.gpuCounters);
  const listing = counters ? await (deps.readListeners ?? readListeners)(cfg.powershell) : null;
  if (!counters || !listing) return null;
  const split = splitMemory({ usedMb: reading.usedMb, apps: reading.apps, counters, listing, own: { pid: null, port: null, running: false, mb: null }, ports: cfg.localComfyPorts, excludePorts: cfg.localComfyExcludePorts, excludePids: cfg.localComfyExcludePids, baselineMb: 0, gpu: cfg.gpuLuid });
  return Math.round(split.othersMb);
}
