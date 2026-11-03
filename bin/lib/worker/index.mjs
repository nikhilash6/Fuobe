// `fuobe worker <setup | run | pause | resume | status | bench | install>` (docs/gpu-workers.md).
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { portFree } from "./comfy.mjs";
import { DEFAULTS, loadConfig, parseFor, readControl, readStatus, saveConfig, syncedFolder, workerHome, writeControl } from "./config.mjs";
import { installScript } from "./install.mjs";

const here = path.dirname(fileURLToPath(import.meta.url));

export const WORKER_USAGE = "fuobe worker <setup | run | pause [--now] [--for 2h] | resume | status | bench | install [--yes]>";

const flag = (args, name) => args.includes(`--${name}`);
const value = (args, name) => {
  const i = args.indexOf(`--${name}`);
  return i >= 0 ? args[i + 1] : undefined;
};

/** The worker command. Returns the exit code. */
export async function worker(args, io) {
  const [sub = "status", ...rest] = args;
  const home = workerHome(io.env, io.home);
  const say = (line) => io.stdout.write(`${line}\n`);
  switch (sub) {
    case "setup":
      return setup(home, io, say);
    case "run": {
      const cfg = loadConfig(home, io.env);
      if (!cfg.site || !cfg.token || !cfg.workDir) {
        io.stderr.write("This worker isn't set up yet. Run: fuobe worker setup\n");
        return 2;
      }
      if (!["computer-runner.mjs", "allowed-nodes.json", "input-rules.json"].every((f) => fs.existsSync(path.join(here, "dist", f)))) {
        io.stderr.write("The worker's shared parts aren't built. Run: node scripts/build-worker.mjs\n");
        return 2;
      }
      const { runWorker } = await import("./run.mjs");
      const ctrl = new AbortController();
      const off = io.onInterrupt?.(() => ctrl.abort());
      say(`Fuobe worker for ${cfg.site}. Its own ComfyUI uses port ${cfg.port}. Ctrl+C stops it.`);
      try {
        await runWorker(cfg, { home, signal: ctrl.signal });
      } finally {
        off?.();
      }
      return 0;
    }
    case "pause": {
      const forMs = value(rest, "for") ? parseFor(value(rest, "for")) : null;
      if (value(rest, "for") && !forMs) {
        io.stderr.write("Say how long, like --for 2h or --for 30m.\n");
        return 2;
      }
      writeControl(home, { paused: true, now: flag(rest, "now"), until: forMs ? Date.now() + forMs : null });
      say(flag(rest, "now") ? "Paused now: its job goes back in line, and its ComfyUI stops." : "Paused: it finishes its job, then stops its ComfyUI.");
      if (forMs) say(`It resumes by itself at ${new Date(Date.now() + forMs).toLocaleTimeString()}.`);
      return 0;
    }
    case "resume":
      writeControl(home, { paused: false, resumedAt: Date.now() });
      say("Resumed on this PC. (A pause on the website stays until it's resumed there.)");
      return 0;
    case "status": {
      const s = readStatus(home);
      const c = readControl(home);
      say(s ? `${s.state}${Date.now() - s.at > 30_000 ? " (the worker isn't running)" : ""}` : "The worker hasn't run yet.");
      if (c.paused) say(c.until ? `Paused here until ${new Date(c.until).toLocaleTimeString()}.` : "Paused here.");
      return 0;
    }
    case "bench": {
      const cfg = loadConfig(home, io.env);
      const res = await io.fetch(`${cfg.site.replace(/\/+$/, "")}/api/gpu/computer/bench`, { method: "POST", headers: { Authorization: `Bearer ${cfg.token}`, "Content-Type": "application/json" }, body: "{}" });
      const body = await res.json().catch(() => ({}));
      if (!res.ok) {
        io.stderr.write(`${body.error ?? `The studio answered HTTP ${res.status}`}\n`);
        return 1;
      }
      say(body.tasks ? `${body.tasks} bench jobs are waiting for this worker. Keep it running.` : "No bench jobs for its lanes yet. Its times come from the jobs it runs.");
      return 0;
    }
    case "install": {
      const script = installScript({ node: process.execPath, bin: path.resolve(here, "../../fuobe.mjs"), home });
      if (!flag(rest, "yes")) {
        say("This adds a task that starts the worker when you sign in (and again if it stops), and two desktop shortcuts:");
        say('"Pause Fuobe worker" (Ctrl+Alt+P) and "Resume Fuobe worker". To do it, run: fuobe worker install --yes');
        say("");
        say(script.text);
        return 0;
      }
      if (process.platform !== "win32") {
        io.stderr.write("worker install is for Windows. Elsewhere, run `fuobe worker run` from systemd or a login item.\n");
        return 2;
      }
      fs.mkdirSync(home, { recursive: true });
      const file = path.join(home, "install.ps1");
      fs.writeFileSync(file, script.text);
      const { spawnSync } = await import("node:child_process");
      const r = spawnSync("powershell", ["-NoProfile", "-ExecutionPolicy", "Bypass", "-File", file], { stdio: "inherit" });
      return r.status ?? 1;
    }
    default:
      io.stderr.write(`Unknown worker command "${sub}". Usage: ${WORKER_USAGE}\n`);
      return 2;
  }
}

async function setup(home, io, say) {
  const old = loadConfig(home, io.env);
  const ask = async (q, def, o = {}) => ((await io.ask(`${q}${def ? ` [${def}]` : ""}: `, o)) || def || "").trim();
  say("Set up this PC as a Fuobe worker. It takes the studio's jobs over HTTPS and runs them on its own ComfyUI.");
  const site = await ask("The studio's address", old.site ?? "https://");
  const token = await ask("The worker's token (Settings → Workers → Add a worker)", "", { hidden: true });
  if (!/^fuobe_wkr_/.test(token) && !old.token) {
    io.stderr.write("That isn't a worker token (they start with fuobe_wkr_).\n");
    return 2;
  }
  const comfyDir = await ask("ComfyUI's folder (where its main.py is)", old.comfyDir);
  if (!fs.existsSync(path.join(comfyDir, "main.py"))) {
    io.stderr.write("There's no main.py in that folder.\n");
    return 2;
  }
  const modelDirs = (await ask("Model folders, separated by ; (each holds checkpoints, loras…)", (old.modelDirs ?? [path.join(comfyDir, "models")]).join(";")))
    .split(";")
    .map((s) => s.trim())
    .filter(Boolean);
  const workDir = await ask("A worker folder for jobs' files", old.workDir ?? (process.platform === "win32" ? "D:\\FuobeWorker" : path.join(io.home, "fuobe-worker")));
  if (syncedFolder(workDir)) {
    io.stderr.write("That folder is synced to a cloud drive. Pick one outside OneDrive, Dropbox and the like: people's files must stay on this PC.\n");
    return 2;
  }
  const port = Number(await ask("The port for the worker's own ComfyUI", String(old.port ?? DEFAULTS.port)));
  if (!Number.isInteger(port) || port < 1024 || port > 65535 || port === 8188) {
    io.stderr.write("Pick a free port above 1024 other than 8188 (your own ComfyUI's).\n");
    return 2;
  }
  if (!(await portFree(port))) {
    io.stderr.write(`Something already listens on port ${port}. The worker only uses a ComfyUI it starts itself: pick another port.\n`);
    return 2;
  }
  const autoResume = /^y/i.test(await ask("Resume by itself when the GPU has been free for 10 minutes? (y/N)", old.autoResume ? "y" : "n"));
  fs.mkdirSync(workDir, { recursive: true });
  if (process.platform === "win32") {
    // Not content indexed: jobs' files stay out of Windows Search.
    const { spawnSync } = await import("node:child_process");
    spawnSync("attrib", ["+I", workDir], { windowsHide: true });
  }
  saveConfig(home, { ...old, site: site.replace(/\/+$/, ""), token: token || old.token, comfyDir, modelDirs, workDir, port, autoResume });
  writeControl(home, { paused: true, now: false, until: null });
  say(`Saved in ${path.join(home, "worker.json")} (readable by you only). The worker starts paused here.`);
  say("Next: fuobe worker run. Resume it here with fuobe worker resume, and on the website in Settings → Workers.");
  return 0;
}
