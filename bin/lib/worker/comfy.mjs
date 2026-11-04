// The worker's own ComfyUI (docs/gpu-workers.md): it always starts and stops its own process, on its own port, with its
// own folders, and it never uses a ComfyUI it didn't start.
//
// The port guard: each start takes a free port at random (or the one worker.json pins, never 8188). Before the start the
// worker binds the port itself and lets it go at once. If that fails, something else listens there: the worker refuses
// to start, pauses itself ("port-busy"), and never connects to that port. So it can never take over, or even talk to,
// another ComfyUI (the one on 8188 included).
//
// The guard (comfy_guard.py): ComfyUI starts through it, with a key made for that start. It refuses every request whose
// Host isn't 127.0.0.1:<port> or that lacks the key, so a web page in a browser on this PC reaches nothing. Before the
// worker sends the key anywhere, the process on the port proves it has it (it signs a random challenge) and that it is
// the process the worker started.
import { execFile, spawn } from "node:child_process";
import crypto from "node:crypto";
import fs from "node:fs";
import net from "node:net";
import path from "node:path";
import { fileURLToPath } from "node:url";

const here = path.dirname(fileURLToPath(import.meta.url));

export class PortBusy extends Error {}
/** Its ComfyUI answered without the guard: the worker won't use it. */
export class GuardMissing extends Error {}

/** The guard's names (comfy_guard.py says the same). */
export const GUARD = { env: "FUOBE_WORKER_GUARD_KEY", key: "X-Fuobe-Worker-Key", challenge: "X-Fuobe-Worker-Challenge", hello: "/fuobe-worker/hello" };

/** The port of the PC owner's own ComfyUI: never the worker's. */
export const OWNER_PORT = 8188;

/** Can this worker have the port? (A bind test: nothing is sent to whatever listens there.) */
export function portFree(port, host = "127.0.0.1") {
  return new Promise((resolve) => {
    const s = net.createServer();
    s.once("error", () => resolve(false));
    s.listen({ port, host, exclusive: true }, () => s.close(() => resolve(true)));
  });
}

/** The port for one start: the one worker.json pins, else a random free one from 20000 to 59999. */
export async function pickPort(pinned, random = () => 20_000 + crypto.randomInt(40_000)) {
  if (pinned) {
    if (Number(pinned) === OWNER_PORT) throw new PortBusy(`Port ${OWNER_PORT} is your own ComfyUI's`);
    return Number(pinned);
  }
  for (let i = 0; i < 40; i++) {
    const p = random();
    if (p !== OWNER_PORT && (await portFree(p))) return p;
  }
  throw new PortBusy("No free port for its ComfyUI");
}

/** The Python that runs ComfyUI: the portable one beside it, its venv, else python on the PATH. */
export function pythonFor(comfyDir) {
  const win = process.platform === "win32";
  const tries = win
    ? [path.join(comfyDir, "..", "python_embeded", "python.exe"), path.join(comfyDir, "venv", "Scripts", "python.exe"), path.join(comfyDir, ".venv", "Scripts", "python.exe")]
    : [path.join(comfyDir, "venv", "bin", "python"), path.join(comfyDir, ".venv", "bin", "python")];
  return tries.find((p) => fs.existsSync(p)) ?? (win ? "python" : "python3");
}

/** The worker's folders under its worker folder: ComfyUI's user, input, output and temp folders, its own. */
export const folders = (workDir) => ({
  user: path.join(workDir, "user"),
  input: path.join(workDir, "input"),
  output: path.join(workDir, "output"),
  temp: path.join(workDir, "temp"),
});

/** extra_model_paths.yaml: the model folders, for reading. */
export function modelPathsYaml(modelDirs, folderNames) {
  const lines = [];
  modelDirs.forEach((dir, i) => {
    lines.push(`fuobe_worker_${i}:`, `  base_path: ${JSON.stringify(dir)}`);
    for (const f of folderNames) lines.push(`  ${f}: ${f}`);
  });
  return `${lines.join("\n")}\n`;
}

/** This ComfyUI can leave out its partner nodes (the paid API nodes): its own argument list names the flag. */
export function partnerFlag(comfyDir) {
  try {
    return fs.readFileSync(path.join(comfyDir, "comfy", "cli_args.py"), "utf8").includes('"--disable-partner-nodes"');
  } catch {
    return false;
  }
}

/**
 * ComfyUI's start arguments (3.3): localhost only, its own folders, no metadata, no browser, only the packs it needs,
 * and no partner nodes where this ComfyUI has the flag. `o.port`: this start's port (else worker.json's).
 */
export function comfyArgs(cfg, packs = [], o = {}) {
  const f = folders(cfg.workDir);
  return [
    "--listen", "127.0.0.1",
    "--port", String(o.port ?? cfg.port),
    "--disable-auto-launch",
    "--disable-metadata",
    ...(o.partnerFlag ? ["--disable-partner-nodes"] : []),
    "--user-directory", f.user,
    "--input-directory", f.input,
    "--output-directory", f.output,
    "--temp-directory", f.temp,
    "--extra-model-paths-config", path.join(cfg.workDir, "extra_model_paths.yaml"),
    "--disable-all-custom-nodes",
    ...(packs.length ? ["--whitelist-custom-nodes", ...packs] : []),
  ];
}

/**
 * What ComfyUI's process needs from this PC's environment, by name: the system's own variables, where things are
 * (PATH, the temp folder, the user's folders for model caches) and the graphics card's settings. Nothing else reaches
 * it: no keys, no tokens, no other program's settings.
 */
const PASS = new Set([
  "SYSTEMROOT", "WINDIR", "SYSTEMDRIVE", "COMSPEC", "PATHEXT", "PATH", "TEMP", "TMP", "TMPDIR", "OS",
  "NUMBER_OF_PROCESSORS", "PROCESSOR_ARCHITECTURE", "PROCESSOR_IDENTIFIER", "PROCESSOR_LEVEL", "PROCESSOR_REVISION",
  "USERPROFILE", "HOMEDRIVE", "HOMEPATH", "HOME", "APPDATA", "LOCALAPPDATA", "PROGRAMDATA", "ALLUSERSPROFILE",
  "PROGRAMFILES", "PROGRAMFILES(X86)", "PROGRAMW6432", "COMMONPROGRAMFILES", "COMMONPROGRAMFILES(X86)", "COMMONPROGRAMW6432",
  "LANG", "LANGUAGE", "LC_ALL", "LC_CTYPE", "TZ", "XDG_CACHE_HOME", "XDG_RUNTIME_DIR", "LD_LIBRARY_PATH",
  "PYTHONIOENCODING", "PYTHONUTF8", "OMP_NUM_THREADS", "MKL_NUM_THREADS",
  "HF_HOME", "HF_HUB_CACHE", "HUGGINGFACE_HUB_CACHE", "TRANSFORMERS_CACHE", "TORCH_HOME",
]);
/** The graphics card's and its libraries' settings. */
const PASS_PREFIX = /^(CUDA_|CUDNN_|NVIDIA_|PYTORCH_CUDA_)/;

/** Set for every start: models load only from what is on this PC, and nothing installs or downloads at run time. */
export const OFFLINE_ENV = { HF_HUB_OFFLINE: "1", TRANSFORMERS_OFFLINE: "1", HF_DATASETS_OFFLINE: "1", PIP_NO_INDEX: "1" };

/**
 * ComfyUI's environment: the variables it needs from this PC's (`env`), then the PC owner's own `comfyEnv` from
 * worker.json (never a FUOBE_ variable), then the offline settings, which nothing overrides.
 * @param {Record<string, string | undefined>} [env]
 * @param {Record<string, unknown>} [extra]
 * @returns {Record<string, string>}
 */
export function comfyEnv(env = process.env, extra = {}) {
  const out = {};
  for (const [k, v] of Object.entries(env)) {
    if (typeof v !== "string") continue;
    const name = k.toUpperCase();
    if (PASS.has(name) || PASS_PREFIX.test(name)) out[k] = v;
  }
  for (const [k, v] of Object.entries(extra && typeof extra === "object" ? extra : {})) {
    if (/^FUOBE_/i.test(k) || typeof v !== "string") continue;
    out[k] = v;
  }
  return { ...out, ...OFFLINE_ENV };
}

/** At most this many times an hour its ComfyUI may stop by itself with no job running; then the worker pauses itself. */
export const MAX_RESTARTS_AN_HOUR = 3;
/** The wait before a start after its ComfyUI stopped: 5 s, then twice as long each time in a row, at most 2 minutes. */
export const restartDelayMs = (inARow) => (inARow <= 0 ? 0 : Math.min(120_000, 5_000 * 2 ** (inARow - 1)));
/** A ComfyUI up this long counts as steady: the next stop waits 5 s again. */
const STEADY_MS = 10 * 60_000;

/** The command line of a running process, or null (not running, or it can't be read). */
export function commandLineOf(pid) {
  const n = Number(pid);
  if (!Number.isInteger(n) || n <= 0) return Promise.resolve(null);
  if (process.platform === "linux") {
    try {
      return Promise.resolve(fs.readFileSync(`/proc/${n}/cmdline`, "utf8").replaceAll("\0", " ").trim() || null);
    } catch {
      return Promise.resolve(null);
    }
  }
  const [cmd, args] =
    process.platform === "win32"
      ? ["powershell", ["-NoProfile", "-NonInteractive", "-Command", `(Get-CimInstance Win32_Process -Filter "ProcessId=${n}").CommandLine`]]
      : ["ps", ["-o", "command=", "-p", String(n)]];
  return new Promise((resolve) => execFile(cmd, args, { timeout: 20_000, windowsHide: true }, (err, out) => resolve(err ? null : String(out).trim() || null)));
}

/** Stop a process and everything it started. */
export function killTree(pid) {
  return new Promise((resolve) => {
    if (process.platform === "win32") {
      spawn("taskkill", ["/pid", String(pid), "/T", "/F"], { windowsHide: true, stdio: "ignore" }).once("exit", resolve).once("error", resolve);
      return;
    }
    try {
      process.kill(pid, "SIGKILL");
    } catch {}
    resolve();
  });
}

/** comfyui.log and the two before it: a new one at each start, and a new one when it passes 20 MB. */
export class RotatingLog {
  constructor(file, o = {}) {
    this.file = file;
    this.max = o.maxBytes ?? 20 * 2 ** 20;
    this.keep = o.keep ?? 2;
    this.fd = null;
    this.bytes = 0;
    this.rotate();
  }

  rotate() {
    if (this.fd !== null) fs.closeSync(this.fd);
    const name = (i) => (i === 0 ? this.file : this.file.replace(/(\.log)?$/, `.${i}.log`));
    fs.rmSync(name(this.keep), { force: true });
    for (let i = this.keep - 1; i >= 0; i--) if (fs.existsSync(name(i))) fs.renameSync(name(i), name(i + 1));
    this.fd = fs.openSync(this.file, "a", 0o600);
    this.bytes = 0;
  }

  write(chunk) {
    if (this.fd === null) return;
    if (this.bytes + chunk.length > this.max) this.rotate();
    fs.writeSync(this.fd, chunk);
    this.bytes += chunk.length;
  }

  close() {
    if (this.fd !== null) fs.closeSync(this.fd);
    this.fd = null;
  }
}

export class OwnComfy {
  /**
   * @param cfg the worker's settings (comfyDir, workDir, port (pins one), modelDirs, comfyEnv, python; `comfyCommand`
   *   replaces the whole command, for tests, with {port} in it, and `comfyGuard` says that command keeps the guard)
   * @param o { now, log, fetch, folderNames, env (this PC's environment), commandLineOf, killTree, randomPort (tests) }
   */
  constructor(cfg, o = {}) {
    this.cfg = cfg;
    this.o = o;
    this.child = null;
    this.ready = false;
    this.port = null;
    this.key = null;
    this.crashes = [];
    this.inARow = 0;
    this.startedAt = 0;
    this.expectExit = false;
    this.onCrash = null;
    /** The task its ComfyUI runs now (the worker says), so a crash counts against it. */
    this.task = null;
    /** When it last answered anything (a ComfyUI that stops answering is stuck). */
    this.answeredAt = 0;
    this.log = null;
  }

  get base() {
    return `http://127.0.0.1:${this.port ?? this.cfg.port ?? 0}`;
  }

  get pid() {
    return this.child?.pid ?? null;
  }

  /** It keeps the guard: the real start always does; a test's command only when it says so. */
  get guarded() {
    return !this.cfg.comfyCommand || this.cfg.comfyGuard === true;
  }

  get pidFile() {
    return path.join(this.cfg.workDir, "comfyui.pid");
  }

  alive() {
    return !!this.child?.pid && this.child.exitCode === null && this.child.signalCode === null && !this.child.killed;
  }

  /** Stops with no job running in the last hour have used up the allowance. */
  crashedTooOften(now = Date.now()) {
    return this.crashes.filter((c) => !c.task && now - c.at < 3_600_000).length > MAX_RESTARTS_AN_HOUR;
  }

  /** When it may start again after stopping by itself (the short backoff). */
  get restartAt() {
    const last = this.crashes.at(-1);
    return last ? last.at + restartDelayMs(this.inARow) : 0;
  }

  /** The address made this start's, for a URL the runner built (http or ws, 127.0.0.1, any port). */
  rebase(url) {
    return String(url).replace(/^(http|ws)(s?):\/\/127\.0\.0\.1:\d+/, (_, p, s) => `${p}${s}://127.0.0.1:${this.port}`);
  }

  /** The key's header, for every request to it. */
  headers() {
    return this.guarded && this.key ? { [GUARD.key]: this.key } : {};
  }

  /** A request to its own ComfyUI (its address and key are this start's). */
  fetch(url, init = {}) {
    const headers = new Headers(init.headers);
    for (const [k, v] of Object.entries(this.headers())) headers.set(k, v);
    return (this.o.fetch ?? fetch)(this.rebase(url), { ...init, headers }).then((res) => {
      this.answeredAt = (this.o.now ?? Date.now)();
      return res;
    });
  }

  /** A ComfyUI left running by a worker that stopped without stopping it (its pid file says): stop it. True when it did. */
  async stopLeftover() {
    let rec;
    try {
      rec = JSON.parse(fs.readFileSync(this.pidFile, "utf8"));
    } catch {
      return false;
    }
    let stopped = false;
    if (Number.isInteger(rec?.pid) && rec.pid > 0 && typeof rec.marker === "string" && rec.marker) {
      // Only that process: its command line still names what this worker started (a reused pid doesn't).
      const line = await (this.o.commandLineOf ?? commandLineOf)(rec.pid);
      if (line && line.includes(rec.marker)) {
        await (this.o.killTree ?? killTree)(rec.pid);
        stopped = true;
        this.o.log?.("Stopped a ComfyUI that a stopped worker left running.");
      }
    }
    fs.rmSync(this.pidFile, { force: true });
    return stopped;
  }

  /** The process on the port proves it is the one the worker started, and has this start's key. */
  async proven(pid) {
    const challenge = crypto.randomBytes(16).toString("hex");
    const r = await (this.o.fetch ?? fetch)(`${this.base}${GUARD.hello}`, { headers: { [GUARD.challenge]: challenge } });
    if (!r.ok) return false;
    const a = await r.json().catch(() => ({}));
    const want = crypto.createHmac("sha256", this.key).update(challenge).digest("hex");
    if (typeof a.proof !== "string" || a.proof.length !== want.length || !crypto.timingSafeEqual(Buffer.from(a.proof), Buffer.from(want)) || a.pid !== pid) {
      throw new PortBusy(`Another program answered on port ${this.port}`);
    }
    return true;
  }

  /** Start its own ComfyUI and wait until it answers. Throws PortBusy when the port is taken, GuardMissing without the guard. */
  async start(packs = []) {
    if (this.alive()) return;
    await this.stopLeftover();
    this.port = await pickPort(this.cfg.port, this.o.randomPort);
    if (!(await portFree(this.port))) throw new PortBusy(`Port ${this.port} is in use by another program`);
    const f = folders(this.cfg.workDir);
    for (const dir of Object.values(f)) fs.mkdirSync(dir, { recursive: true });
    fs.writeFileSync(path.join(this.cfg.workDir, "extra_model_paths.yaml"), modelPathsYaml(this.cfg.modelDirs ?? [], this.o.folderNames ?? []));
    this.key = crypto.randomBytes(32).toString("hex");
    let cmd;
    let marker;
    if (this.cfg.comfyCommand) {
      cmd = this.cfg.comfyCommand.map((a) => String(a).replaceAll("{port}", String(this.port)));
      marker = cmd.slice(1).find((a) => /[\\/]/.test(a)) ?? cmd.join(" ");
    } else {
      // The guard is written fresh into the worker folder at each start, and ComfyUI starts through it.
      const guard = path.join(this.cfg.workDir, "guard", "comfy_guard.py");
      fs.mkdirSync(path.dirname(guard), { recursive: true });
      fs.copyFileSync(path.join(here, "comfy_guard.py"), guard);
      cmd = [this.cfg.python || pythonFor(this.cfg.comfyDir), "-s", guard, path.join(this.cfg.comfyDir, "main.py"), ...comfyArgs(this.cfg, packs, { port: this.port, partnerFlag: partnerFlag(this.cfg.comfyDir) })];
      marker = guard;
    }
    this.crashes = this.crashes.filter((c) => (this.o.now ?? Date.now)() - c.at < 3_600_000);
    this.expectExit = false;
    this.ready = false;
    const env = { ...comfyEnv(this.o.env ?? process.env, this.cfg.comfyEnv), ...(this.guarded && { [GUARD.env]: this.key }) };
    // Its working folder is the worker folder: a node that writes a relative path writes there, not into ComfyUI's.
    const child = spawn(cmd[0], cmd.slice(1), { cwd: this.cfg.workDir, env, stdio: ["ignore", "pipe", "pipe"], windowsHide: true });
    this.child = child;
    this.startedAt = (this.o.now ?? Date.now)();
    if (child.pid) fs.writeFileSync(this.pidFile, JSON.stringify({ pid: child.pid, port: this.port, marker, at: this.startedAt }), { mode: 0o600 });
    this.log?.close();
    const log = (this.log = new RotatingLog(path.join(this.cfg.workDir, "comfyui.log")));
    child.stdout.on("data", (d) => log.write(d));
    child.stderr.on("data", (d) => log.write(d));
    child.once("error", () => {});
    child.once("exit", (code) => {
      this.ready = false;
      if (this.expectExit) return;
      const at = (this.o.now ?? Date.now)();
      this.inARow = at - this.startedAt >= STEADY_MS ? 1 : this.inARow + 1;
      this.crashes.push({ at, task: this.task });
      this.onCrash?.(code, this.task);
    });
    // Only now, with its own process up, does the worker talk to the port: first the proof, then with the key.
    let proof = !this.guarded;
    for (let i = 0; i < 360; i++) {
      if (!this.alive()) throw new Error("ComfyUI stopped while starting (see comfyui.log in the worker folder)");
      try {
        if (!proof) proof = await this.proven(child.pid);
        if (proof) {
          const r = await this.fetch(`${this.base}/system_stats`);
          if (r.ok) {
            if (this.guarded) {
              // Without the key it must refuse: else the guard isn't there, and the worker won't use this ComfyUI.
              const open = await (this.o.fetch ?? fetch)(`${this.base}/system_stats`).catch(() => null);
              if (open?.status !== 403) {
                await this.stop();
                throw new GuardMissing("Its ComfyUI answered without the worker's guard");
              }
            }
            this.ready = true;
            this.answeredAt = (this.o.now ?? Date.now)();
            return;
          }
        }
      } catch (e) {
        if (e instanceof PortBusy || e instanceof GuardMissing) {
          await this.stop();
          throw e;
        }
      }
      await new Promise((r) => setTimeout(r, 500));
    }
    await this.stop();
    throw new Error("ComfyUI didn't answer within 3 minutes");
  }

  /** Stop its ComfyUI (the whole process tree), so its VRAM and RAM go back. */
  async stop() {
    const child = this.child;
    if (!child) return;
    this.expectExit = true;
    this.ready = false;
    if (child.exitCode === null && child.signalCode === null) {
      if (process.platform === "win32" && child.pid) await (this.o.killTree ?? killTree)(child.pid);
      else child.kill("SIGTERM");
      await new Promise((r) => {
        if (child.exitCode !== null || child.signalCode !== null) return r();
        const t = setTimeout(() => (child.kill("SIGKILL"), r()), 10_000);
        child.once("exit", () => (clearTimeout(t), r()));
      });
    }
    this.child = null;
    this.key = null;
    fs.rmSync(this.pidFile, { force: true });
    this.log?.close();
    this.log = null;
  }

  /** Its own VRAM, from its own /system_stats (MB), or null. */
  async vramMb() {
    if (!this.ready) return null;
    try {
      const s = await (await this.fetch(`${this.base}/system_stats`)).json();
      const d = s?.devices?.[0];
      const bytes = d?.torch_vram_total ?? null;
      return typeof bytes === "number" ? Math.round(bytes / 2 ** 20) : null;
    } catch {
      return null;
    }
  }

  /** Free its memory: models unloaded, caches emptied (before a retry after running out of memory). */
  async free() {
    if (!this.ready) return;
    await this.fetch(`${this.base}/free`, { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ unload_models: true, free_memory: true }) }).catch(() => null);
  }

  /** Nothing of a job stays in it: the running prompt stopped, the queue and the whole history emptied. */
  async clear() {
    if (!this.ready) return;
    const post = (p, body) => this.fetch(`${this.base}${p}`, { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(body) }).catch(() => null);
    await post("/queue", { clear: true });
    await post("/interrupt", {});
    await post("/history", { clear: true });
  }
}
