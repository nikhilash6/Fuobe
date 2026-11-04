// The worker's own files (docs/gpu-workers.md): its settings (worker.json, readable by this user only), the pause
// switch the `pause` and `resume` commands flip (control.json), and what the running worker last said (status.json).
import fs from "node:fs";
import os from "node:os";
import path from "node:path";

export const PROTOCOL = 1;

/** Where the worker keeps its settings: %LOCALAPPDATA%\FuobeWorker on Windows, ~/.config/fuobe-worker elsewhere. */
export function workerHome(env = process.env, home = os.homedir()) {
  if (env.FUOBE_WORKER_HOME) return env.FUOBE_WORKER_HOME;
  if (process.platform === "win32") return path.join(env.LOCALAPPDATA || path.join(home, "AppData", "Local"), "FuobeWorker");
  return path.join(env.XDG_CONFIG_HOME || path.join(home, ".config"), "fuobe-worker");
}

export const DEFAULTS = {
  /** Its ComfyUI's port: none set takes a free one at random at each start (`port` in worker.json pins one). */
  port: null,
  /** A job that makes no progress for this many minutes goes back to the line, and a stuck ComfyUI is started again. */
  stallMin: 10,
  /** Its ComfyUI answering nothing for this many minutes is stuck: the worker stops it and starts it again. */
  hungMin: 3,
  /** ffmpeg, which makes every clip and sound again before its ComfyUI reads them. None: the worker takes pictures only. */
  ffmpeg: null,
  /** Another program's VRAM above this pauses the worker. */
  busyVramMb: 1024,
  /** The automatic resume: off unless switched on for this PC (here, or on the studio's Workers page). */
  autoResume: false,
  /** The GPU must stay free this long before an automatic resume, and be cooler than this. */
  resumeAfterMin: 10,
  resumeBelowC: 75,
  nvidiaSmi: "nvidia-smi",
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
