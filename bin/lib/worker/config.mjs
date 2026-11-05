// The worker's own files (docs/gpu-workers.md): its settings (worker.json, readable by this user only), the pause
// switch the `pause` and `resume` commands flip (control.json), and what the running worker last said (status.json).
import fs from "node:fs";
import os from "node:os";
import path from "node:path";

/**
 * 2: it says which inputs it takes, makes every clip and sound again, and keeps its ComfyUI behind the guard. 3: it makes
 * every picture of a job ticket again from its pixels too, and may have a CPU slot.
 */
export const PROTOCOL = 3;

/** Where the worker keeps its settings: %LOCALAPPDATA%\FuobeWorker on Windows, ~/.config/fuobe-worker elsewhere. */
export function workerHome(env = process.env, home = os.homedir()) {
  if (env.FUOBE_WORKER_HOME) return env.FUOBE_WORKER_HOME;
  if (process.platform === "win32") return path.join(env.LOCALAPPDATA || path.join(home, "AppData", "Local"), "FuobeWorker");
  return path.join(env.XDG_CONFIG_HOME || path.join(home, ".config"), "fuobe-worker");
}

export const DEFAULTS = {
  /** Its ComfyUI's port: none set takes a free one at random at each start (`port` in worker.json pins one). */
  port: null,
  // stallMin (no default): a job that makes no progress for this many minutes goes back to the line. The studio gives
  // its limit with each job; a stallMin in worker.json wins over it on this PC.
  /** Its ComfyUI answering nothing for this many minutes is stuck: the worker stops it and starts it again. */
  hungMin: 3,
  // ffmpeg (no default): the ffmpeg that makes every clip and sound again before its ComfyUI reads them. Not in
  // worker.json: the ffmpeg on the PATH, when there is one. null or "-": none, and the worker takes pictures only.
  /** A studio address with http:// on a private network (10.x, 172.16-31.x, 192.168.x, fd00::/8): allowed only when true. */
  allowHttpSite: false,
  /** Another program's VRAM above this pauses the worker. */
  busyVramMb: 1024,
  /** The automatic resume: off unless switched on for this PC (here, or on the studio's Workers page). */
  autoResume: false,
  /** The GPU must stay free this long before an automatic resume, and be cooler than this. */
  resumeAfterMin: 10,
  resumeBelowC: 75,
  nvidiaSmi: "nvidia-smi",
  /**
   * Studio jobs first: a folder for the two turn files (site.json, yielded.json). None: every program that uses the GPU
   * pauses the worker, as before. The PC's setup makes the folder; the worker never makes it.
   */
  yieldFolder: null,
  /** Local ComfyUI work: python processes that listen on a port in this range, [low, high]. */
  localComfyPorts: [8188, 8199],
  /** Ports and process ids in that range that never count as local ComfyUI work. */
  localComfyExcludePorts: [],
  localComfyExcludePids: [],
  /** The desktop's usual share of the GPU's memory, measured at setup (`fuobe worker baseline`). */
  desktopBaselineMb: 0,
  /** Only when the GPU counters can't be read: a lock file, and the owners it may name that count as ComfyUI work. */
  gpuLockFile: null,
  gpuLockComfyOwners: [],
  /** Local caps the studio can't change: hours of turns a day, minutes between two interrupts, and never interrupt. */
  yieldMaxHoursPerDay: 20,
  interruptGapMin: 30,
  neverInterrupt: false,
};

const file = (home, name) => path.join(home, name);

function readJson(p, fallback) {
  try {
    return JSON.parse(fs.readFileSync(p, "utf8"));
  } catch {
    return fallback;
  }
}

function writePrivate(p, data) {
  fs.mkdirSync(path.dirname(p), { recursive: true });
  const tmp = `${p}.tmp`;
  fs.writeFileSync(tmp, `${JSON.stringify(data, null, 2)}\n`, { mode: 0o600 });
  fs.renameSync(tmp, p);
  try {
    fs.chmodSync(p, 0o600);
  } catch {}
}

/** The settings, with defaults; the token from FUOBE_WORKER_TOKEN when set (a rented machine keeps it out of files). */
export function loadConfig(home, env = process.env) {
  const c = { ...DEFAULTS, ...readJson(file(home, "worker.json"), {}) };
  if (env.FUOBE_WORKER_TOKEN) c.token = env.FUOBE_WORKER_TOKEN;
  if (env.FUOBE_WORKER_SITE) c.site = env.FUOBE_WORKER_SITE;
  return c;
}

export const saveConfig = (home, c) => writePrivate(file(home, "worker.json"), c);

/** worker.json as saved: no defaults, no token or address from the environment. */
export const savedConfig = (home) => {
  const c = readJson(file(home, "worker.json"), {});
  return c && typeof c === "object" && !Array.isArray(c) ? c : {};
};

/** The ffmpeg to use: worker.json's, else the PATH's when worker.json doesn't name one; null for none ("-" or null). */
export const ffmpegOf = (cfg) => (cfg.ffmpeg === undefined ? "ffmpeg" : cfg.ffmpeg && cfg.ffmpeg !== "-" ? String(cfg.ffmpeg) : null);

/** The pause switch on this PC: { paused, now, until, at }. */
export const readControl = (home) => readJson(file(home, "control.json"), { paused: false });
export const writeControl = (home, c) => writePrivate(file(home, "control.json"), { ...c, at: Date.now() });
export const readStatus = (home) => readJson(file(home, "status.json"), null);
export const writeStatus = (home, s) => writePrivate(file(home, "status.json"), s);

/** "2h", "90m", "45s" → ms (null when it isn't one). */
export function parseFor(text) {
  const m = /^(\d+(?:\.\d+)?)\s*(h|m|s)$/i.exec(String(text ?? "").trim());
  if (!m) return null;
  return Math.round(Number(m[1]) * { h: 3_600_000, m: 60_000, s: 1000 }[m[2].toLowerCase()]);
}

/** A folder a cloud drive syncs (its files would leave this PC) or the search index reads. */
export function syncedFolder(dir) {
  return /[\\/](OneDrive|Dropbox|Google Drive|GoogleDrive|iCloudDrive|iCloud Drive|Box|MEGA)([\\/ -]|$)/i.test(path.resolve(dir));
}
