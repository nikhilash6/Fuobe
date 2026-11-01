// The worker's own ComfyUI (docs/gpu-workers.md): it always starts and stops its own process, on its own port, with its
// own folders, and it never uses a ComfyUI it didn't start.
//
// The port guard: before each start the worker binds the port itself and lets it go at once. If that fails, something
// else listens there: the worker refuses to start, pauses itself ("port-busy"), and never connects to that port. So it
// can never take over, or even talk to, another ComfyUI (the one on 8188 included).
import { spawn } from "node:child_process";
import fs from "node:fs";
import net from "node:net";
import path from "node:path";

export class PortBusy extends Error {}

/** Can this worker have the port? (A bind test: nothing is sent to whatever listens there.) */
export function portFree(port, host = "127.0.0.1") {
  return new Promise((resolve) => {
    const s = net.createServer();
    s.once("error", () => resolve(false));
    s.listen({ port, host, exclusive: true }, () => s.close(() => resolve(true)));
  });
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

/** ComfyUI's start arguments (3.3): localhost only, its own folders, no metadata, no browser, only the packs it needs. */
export function comfyArgs(cfg, packs = []) {
  const f = folders(cfg.workDir);
  return [
    "--listen", "127.0.0.1",
    "--port", String(cfg.port),
    "--disable-auto-launch",
    "--disable-metadata",
    "--user-directory", f.user,
    "--input-directory", f.input,
    "--output-directory", f.output,
    "--temp-directory", f.temp,
    "--extra-model-paths-config", path.join(cfg.workDir, "extra_model_paths.yaml"),
    "--disable-all-custom-nodes",
    ...(packs.length ? ["--whitelist-custom-nodes", ...packs] : []),
  ];
}

/** At most this many restarts an hour; then the worker pauses itself ("comfy-crashes"). */
export const MAX_RESTARTS_AN_HOUR = 3;

export class OwnComfy {
  /**
   * @param cfg the worker's settings (comfyDir, workDir, port, modelDirs; `comfyCommand` replaces the whole command, for tests)
   * @param o { now, log, fetch, folderNames }
   */
  constructor(cfg, o = {}) {
    this.cfg = cfg;
    this.o = o;
    this.child = null;
    this.ready = false;
    this.starts = [];
    this.expectExit = false;
    this.onCrash = null;
  }

  get base() {
    return `http://127.0.0.1:${this.cfg.port}`;
  }

  get pid() {
    return this.child?.pid ?? null;
  }

  alive() {
    return !!this.child && this.child.exitCode === null && !this.child.killed;
  }

  /** Restarts in the last hour have used up the allowance. */
  crashedTooOften(now = Date.now()) {
    return this.starts.filter((t) => now - t < 3_600_000).length > MAX_RESTARTS_AN_HOUR;
  }

  /** Start its own ComfyUI and wait until it answers. Throws PortBusy when the port is taken. */
  async start(packs = []) {
    if (this.alive()) return;
    if (!(await portFree(this.cfg.port))) throw new PortBusy(`Port ${this.cfg.port} is in use by another program`);
    const f = folders(this.cfg.workDir);
    for (const dir of Object.values(f)) fs.mkdirSync(dir, { recursive: true });
    fs.writeFileSync(path.join(this.cfg.workDir, "extra_model_paths.yaml"), modelPathsYaml(this.cfg.modelDirs ?? [], this.o.folderNames ?? []));
    const cmd = this.cfg.comfyCommand
      ? this.cfg.comfyCommand.map((a) => String(a).replaceAll("{port}", String(this.cfg.port)))
      : [this.cfg.python || pythonFor(this.cfg.comfyDir), path.join(this.cfg.comfyDir, "main.py"), ...comfyArgs(this.cfg, packs)];
    this.starts.push((this.o.now ?? Date.now)());
    this.expectExit = false;
    this.ready = false;
    const child = spawn(cmd[0], cmd.slice(1), { cwd: this.cfg.comfyDir || this.cfg.workDir, stdio: ["ignore", "pipe", "pipe"], windowsHide: true });
    this.child = child;
    const log = fs.createWriteStream(path.join(this.cfg.workDir, "comfyui.log"), { flags: "a" });
    child.stdout.pipe(log);
    child.stderr.pipe(log);
    child.once("exit", (code) => {
      this.ready = false;
      if (!this.expectExit) this.onCrash?.(code);
    });
    // Only now, with its own process up, does the worker talk to the port.
    const fetchFn = this.o.fetch ?? fetch;
    for (let i = 0; i < 360; i++) {
      if (!this.alive()) throw new Error("ComfyUI stopped while starting (see comfyui.log in the worker folder)");
      try {
        const r = await fetchFn(`${this.base}/system_stats`);
        if (r.ok) {
          this.ready = true;
          return;
        }
      } catch {}
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
    if (child.exitCode === null) {
      if (process.platform === "win32" && child.pid) {
        await new Promise((r) => spawn("taskkill", ["/pid", String(child.pid), "/T", "/F"], { windowsHide: true, stdio: "ignore" }).once("exit", r).once("error", r));
      } else child.kill("SIGTERM");
      await new Promise((r) => {
        if (child.exitCode !== null) return r();
        const t = setTimeout(() => (child.kill("SIGKILL"), r()), 10_000);
        child.once("exit", () => (clearTimeout(t), r()));
      });
    }
    this.child = null;
  }

  /** Its own VRAM, from its own /system_stats (MB), or null. */
  async vramMb() {
    if (!this.ready) return null;
    try {
      const s = await (await (this.o.fetch ?? fetch)(`${this.base}/system_stats`)).json();
      const d = s?.devices?.[0];
      const bytes = d?.torch_vram_total ?? null;
      return typeof bytes === "number" ? Math.round(bytes / 2 ** 20) : null;
    } catch {
      return null;
    }
  }
}
