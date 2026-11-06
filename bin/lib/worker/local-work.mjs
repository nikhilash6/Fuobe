// Telling local ComfyUI work apart from other programs (docs/gpu-workers.md, "Studio jobs first"). To tell them apart,
// the worker never connects to another ComfyUI. It reads three things only:
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
//
// One exception, for the owner's own jobs, which ask local ComfyUI work for no turn: local ComfyUI work that holds the
// GPU's memory is asked whether it runs anything (its /queue, read only). When it runs nothing and has nothing queued,
// it is asked to free its memory (its /free: models unloaded, caches emptied; nothing stops, and it loads them again
// for its next job). Never anything else, and never while it works.
import { execFile } from "node:child_process";
import fs from "node:fs";
import path from "node:path";
import { isDesktop, ownOf } from "./gpu.mjs";

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
  const own = new Set([o.ownPid, ...(o.extraPids ?? [])].filter(Boolean));
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
 * Split the GPU's used memory: { ownMb, ownSure, workMb, othersMb, who, work: { pids, port (the first), ports (all of them) }, source }.
 * `ownSure`: its own ComfyUI's share was read per process (ownOf), not only as torch's lower bound.
 * `who` names the biggest other program (for the busy pause). `source`: "counters", "lock" (the counters failed, the
 * lock decided) or "total" (neither: everything that isn't the worker's own counts as another program, which fails
 * safe). `o`: { usedMb, apps (nvidia-smi's, for names), counters, listing, own: { pid, port, running, mb }, ports,
 * excludePorts, excludePids, baselineMb, lock (readLock's), lockOwners, gpu }.
 */
export function splitMemory(o) {
  const base = Math.max(0, Number(o.baselineMb) || 0);
  const fallback = ownOf(o.own, o.apps);
  const fallbackMb = fallback.mb;
  if (o.counters && o.listing) {
    const { own, work } = workPids(o.listing, { ports: o.ports, ownPid: o.own.pid, ownPort: o.own.port, extraPids: o.own.extraPids, excludePorts: o.excludePorts, excludePids: o.excludePids });
    const gpu = pickGpu(o.counters, o.gpu);
    const mine = o.counters.filter((c) => c.gpu === gpu);
    const sum = (pids) => mine.filter((c) => pids.has(c.pid)).reduce((n, c) => n + c.mb, 0);
    const counted = sum(own);
    // Its own ComfyUI before the counters list it: what torch says, as before.
    const ownMb = counted > 0 ? counted : fallbackMb;
    const workMb = sum(new Set(work.keys()));
    const othersMb = Math.max(0, o.usedMb - ownMb - workMb - base);
    const nameOf = (pid) => o.listing.names?.[pid] ?? o.apps?.find((a) => a.pid === pid)?.name ?? null;
    const top = mine.filter((c) => !own.has(c.pid) && !work.has(c.pid) && c.mb > 0 && !isDesktop(nameOf(c.pid))).sort((a, b) => b.mb - a.mb)[0];
    const who = (top && nameOf(top.pid)) ?? "another program";
    const firstPort = [...work.values()][0] ?? null;
    return { ownMb, ownSure: counted > 0 || fallback.sure, workMb, othersMb, who, work: { pids: [...work.keys()], port: firstPort, ports: [...new Set(work.values())] }, source: "counters" };
  }
  const rest = Math.max(0, o.usedMb - fallbackMb - base);
  const owners = (o.lockOwners ?? []).map((s) => String(s).toLowerCase()).filter(Boolean);
  if (o.lock !== null && o.lock !== undefined && owners.some((w) => String(o.lock).toLowerCase().startsWith(w))) {
    return { ownMb: fallbackMb, ownSure: fallback.sure, workMb: rest, othersMb: 0, who: null, work: { pids: [], port: null, lock: true }, source: "lock" };
  }
  const named = o.apps?.find((a) => a.pid !== o.own.pid && !(o.own.extraPids ?? []).includes(a.pid) && (a.usedMb === null || a.usedMb > 0) && !isDesktop(a.name))?.name;
  return { ownMb: fallbackMb, ownSure: fallback.sure, workMb: 0, othersMb: rest, who: o.lock !== null && o.lock !== undefined ? "another program" : (named ?? "another program"), work: { pids: [], port: null }, source: o.lock !== null && o.lock !== undefined ? "lock" : "total" };
}

/** How long a look at local ComfyUI work's /queue or a /free waits for its answer. */
export const LOCAL_ASK_MS = 2000;

/**
 * Local ComfyUI work on these ports runs nothing and has nothing queued: each one's /queue (read only) answers with
 * empty queue_running and queue_pending lists. False when any of them answers anything else or doesn't answer in time.
 */
export async function localIdle(fetchFn, ports, ms = LOCAL_ASK_MS) {
  if (!ports?.length) return false;
  for (const port of ports) {
    try {
      const r = await fetchFn(`http://127.0.0.1:${port}/queue`, { signal: AbortSignal.timeout(ms) });
      if (!r.ok) return false;
      const q = await r.json();
      if (!Array.isArray(q?.queue_running) || !Array.isArray(q?.queue_pending) || q.queue_running.length || q.queue_pending.length) return false;
    } catch {
      return false;
    }
  }
  return true;
}

/** Ask local ComfyUI work on these ports to free its memory (/free: models unloaded, caches emptied). */
export async function freeLocal(fetchFn, ports, ms = LOCAL_ASK_MS) {
  for (const port of ports ?? []) {
    await fetchFn(`http://127.0.0.1:${port}/free`, { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ unload_models: true, free_memory: true }), signal: AbortSignal.timeout(ms) }).catch(() => null);
  }
}

/** The most `fuobe worker baseline` saves: a desktop alone uses less, so more means another program was open. */
export const BASELINE_CAP_MB = 4096;

/** The worker's own ComfyUI as its pid file in the worker folder says ({ pid, port }), or null when it has none. */
export function ownComfyOf(workDir) {
  try {
    const rec = JSON.parse(fs.readFileSync(path.join(workDir, "comfyui.pid"), "utf8"));
    const pid = Number.isInteger(rec?.pid) && rec.pid > 0 ? rec.pid : null;
    const port = Number.isInteger(rec?.port) && rec.port > 0 ? rec.port : null;
    return pid || port ? { pid, port } : null;
  } catch {
    return null;
  }
}

/**
 * The desktop's usual share of the GPU, measured once at setup with no game or other GPU program open: the used memory
 * minus local ComfyUI work and minus the worker's own ComfyUI (by its pid file: its process, and the one on its port),
 * from the counters. Null when the counters or the port table can't be read. Otherwise { mb (what to save: at most
 * BASELINE_CAP_MB), measuredMb, capped, usedMb, ownMb, workMb, top (the biggest of the rest: [{ name, pid, mb }]) }.
 */
export async function measureBaseline(cfg, deps = {}) {
  const { readGpu } = await import("./gpu.mjs");
  const reading = await (deps.readGpu ?? readGpu)(cfg.nvidiaSmi);
  if (!reading) return null;
  const counters = await (deps.readCounters ?? readCounters)(cfg.gpuCounters);
  const listing = counters ? await (deps.readListeners ?? readListeners)(cfg.powershell) : null;
  if (!counters || !listing) return null;
  const mine = cfg.workDir ? ownComfyOf(cfg.workDir) : null;
  const own = { pid: mine?.pid ?? null, port: mine?.port ?? null, running: false, mb: null };
  const o = { ports: cfg.localComfyPorts, excludePorts: cfg.localComfyExcludePorts, excludePids: cfg.localComfyExcludePids };
  const split = splitMemory({ usedMb: reading.usedMb, apps: reading.apps, counters, listing, own, ...o, baselineMb: 0, gpu: cfg.gpuLuid });
  // The rest, by process, for the owner to see what was counted.
  const pids = workPids(listing, { ...o, ownPid: own.pid, ownPort: own.port });
  const gpu = pickGpu(counters, cfg.gpuLuid);
  const top = counters
    .filter((c) => c.gpu === gpu && c.mb > 0 && !pids.own.has(c.pid) && !pids.work.has(c.pid))
    .sort((a, b) => b.mb - a.mb)
    .slice(0, 5)
    .map((c) => ({ pid: c.pid, mb: Math.round(c.mb), name: listing.names?.[c.pid] ?? reading.apps?.find((a) => a.pid === c.pid)?.name ?? "a program" }));
  const measuredMb = Math.round(split.othersMb);
  return { mb: Math.min(measuredMb, BASELINE_CAP_MB), measuredMb, capped: measuredMb > BASELINE_CAP_MB, usedMb: Math.round(reading.usedMb), ownMb: Math.round(split.ownMb), workMb: Math.round(split.workMb), top };
}
